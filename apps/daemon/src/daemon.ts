import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type DefinitionBundle,
  DefinitionError,
  loadDefinition,
} from "@frogie/core/definitions";
import type {
  DaemonDirectory,
  DaemonProject,
  ProjectBinding,
  RuntimeError,
  RuntimeScope,
} from "@frogie/core/protocol";
import { parseDocument } from "yaml";
import { HarnessProcess, runtimeFailure } from "./harnessProcess.js";
import type { LocalModelConfig } from "./server/localRuntime.js";

const identifier = /^[a-z][a-z0-9-]*$/u;
const scopeMatches = (a: RuntimeScope, b: RuntimeScope): boolean =>
  a.projectId === b.projectId &&
  a.environmentId === b.environmentId &&
  a.squadId === b.squadId &&
  a.harnessId === b.harnessId;

interface StoredProject {
  project: DaemonProject;
  binding: ProjectBinding;
}

function errorDTO(error: unknown, scope?: RuntimeScope): RuntimeError {
  const code =
    error instanceof DefinitionError
      ? "invalid_definition"
      : typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string" &&
          [
            "invalid_definition",
            "capability_missing",
            "binding_mismatch",
            "conflict",
            "not_found",
            "storage_in_use",
            "runtime_unavailable",
          ].includes(error.code)
        ? error.code
        : "runtime_unavailable";
  return {
    code,
    message:
      code === "invalid_definition"
        ? "Squad definition is invalid"
        : code === "capability_missing"
          ? "A required model, tool, or extension is unavailable"
          : code === "binding_mismatch"
            ? "Stored runtime binding does not match"
            : "Harness startup or storage operation failed",
    retryable: false,
    ...(scope ? { scope } : {}),
  };
}

async function realDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw runtimeFailure("invalid_directory", "A real directory is required");
}

async function ownedWorkspace(
  directory: string,
  definitionsDirectory: string,
): Promise<boolean> {
  try {
    const path = join(directory, "owner.json");
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const owner: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      typeof owner !== "object" ||
      !owner ||
      !("runId" in owner) ||
      typeof owner.runId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        owner.runId,
      ) ||
      !("root" in owner) ||
      owner.root !== directory ||
      (await realpath(directory)) !== (await realpath(owner.root))
    )
      return false;
    await realDirectory(join(directory, "workspace"));
    await realDirectory(join(directory, "workspace", "squads"));
    return (
      definitionsDirectory === join(directory, "workspace", "squads") &&
      (await realpath(definitionsDirectory)) ===
        join(await realpath(directory), "workspace", "squads")
    );
  } catch {
    return false;
  }
}

async function squadMetadata(
  root: string,
  squadId: string,
): Promise<{ projectId: string; title: string }> {
  if (!identifier.test(squadId))
    throw runtimeFailure("invalid_definition", "Invalid Squad ID");
  await realDirectory(root);
  const directory = join(root, squadId);
  await realDirectory(directory);
  const path = join(directory, "SQUAD.md");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw runtimeFailure(
      "invalid_definition",
      "Squad metadata must be a regular file",
    );
  const source = await readFile(path, "utf8");
  const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1];
  if (!header)
    throw runtimeFailure("invalid_definition", "Squad metadata is missing");
  const document = parseDocument(header, { uniqueKeys: true });
  const data = document.toJS();
  if (
    document.errors.length ||
    typeof data !== "object" ||
    !data ||
    !("id" in data) ||
    data.id !== squadId ||
    !("projectId" in data) ||
    typeof data.projectId !== "string" ||
    !identifier.test(data.projectId) ||
    !("title" in data) ||
    typeof data.title !== "string" ||
    !data.title.trim()
  )
    throw runtimeFailure("invalid_definition", "Squad metadata is invalid");
  return { projectId: data.projectId, title: data.title };
}

async function atomicJSON(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function freezeDefinition(
  directory: string,
  definition: DefinitionBundle,
): Promise<void> {
  const temporary = join(directory, `.definition.${randomUUID()}`);
  await mkdir(temporary);
  for (const file of definition.files) {
    const path = join(temporary, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(file.content, file.encoding), {
      flag: "wx",
      mode: file.mode,
    });
    await chmod(path, file.mode);
  }
  if (loadDefinition(temporary).contentHash !== definition.contentHash)
    throw runtimeFailure(
      "binding_mismatch",
      "Frozen definition does not match source",
    );
  await rename(temporary, join(directory, "definition"));
}

export async function startDaemon(options: {
  directory: string;
  definitionsDirectory: string;
  mode: "local" | "e2e";
  model?: LocalModelConfig;
}): Promise<DaemonDirectory & { close(): Promise<void> }> {
  const directory = resolve(options.directory);
  const definitionsDirectory = resolve(options.definitionsDirectory);
  await mkdir(directory, { recursive: true });
  await realDirectory(directory);
  const files = await readdir(directory);
  const ownedE2E =
    options.mode === "e2e" &&
    files.every((file) => ["owner.json", "workspace"].includes(file)) &&
    (await ownedWorkspace(directory, definitionsDirectory));
  if (files.length && !files.includes("daemon.sqlite") && !ownedE2E)
    throw runtimeFailure(
      "binding_mismatch",
      "Existing data is not a daemon directory",
    );
  const databasePath = join(directory, "daemon.sqlite");
  if (files.includes("daemon.sqlite")) {
    const stat = await lstat(databasePath);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw runtimeFailure(
        "binding_mismatch",
        "Daemon database must be a regular file",
      );
  }
  const database = new DatabaseSync(databasePath);
  try {
    if (
      files.includes("daemon.sqlite") &&
      !database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'installation'",
        )
        .get()
    )
      throw runtimeFailure(
        "binding_mismatch",
        "Existing SQLite data is not a daemon installation",
      );
    database.exec(
      "PRAGMA busy_timeout = 0; PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS installation (id INTEGER PRIMARY KEY CHECK (id = 1), instance_id TEXT NOT NULL, mode TEXT NOT NULL); CREATE TABLE IF NOT EXISTS projects (project_id TEXT PRIMARY KEY, value TEXT NOT NULL); COMMIT;",
    );
    await chmod(databasePath, 0o600);
  } catch (error) {
    database.close();
    if (error instanceof Error && /locked|busy/iu.test(error.message))
      throw runtimeFailure(
        "storage_in_use",
        "Daemon directory is already owned",
      );
    throw error;
  }
  const stored = new Map<string, StoredProject>();
  const workers = new Map<string, HarnessProcess>();
  let closing: Promise<void> | undefined;
  let sealed = false;
  let queue = Promise.resolve();
  const persist = (entry: StoredProject): void => {
    database
      .prepare(
        "INSERT INTO projects (project_id, value) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET value = excluded.value",
      )
      .run(entry.project.projectId, JSON.stringify(entry));
  };
  const harnessDirectory = (scope: RuntimeScope): string =>
    join(
      directory,
      "projects",
      scope.projectId,
      "environments",
      scope.environmentId,
      "harnesses",
      scope.harnessId,
    );
  const environment =
    options.mode === "e2e"
      ? {
          model: { provider: "fixture", modelId: "test" },
          thinkingLevel: "low" as const,
        }
      : options.model
        ? {
            model: { provider: "local-model", modelId: options.model.modelId },
            thinkingLevel: options.model.thinkingLevel,
          }
        : {};
  const launch = async (entry: StoredProject): Promise<void> => {
    if (!entry.project.enabled) {
      entry.project = { ...entry.project, state: "stopped" };
      return;
    }
    if (!entry.project.definitionHash) {
      entry.project = { ...entry.project, state: "error" };
      persist(entry);
      return;
    }
    const { error: _error, ...previous } = entry.project;
    entry.project = { ...previous, state: "starting" };
    let worker: HarnessProcess | undefined;
    let startupFailure: RuntimeError | undefined;
    try {
      worker = new HarnessProcess(
        {
          directory: harnessDirectory(entry.project.scope),
          binding: entry.binding,
          mode: options.mode,
          ...(options.model ? { model: options.model } : {}),
        },
        (error) => {
          if (sealed) return;
          if (!worker) {
            startupFailure = error;
            return;
          }
          if (workers.get(entry.project.projectId) !== worker) return;
          startupFailure = error;
          entry.project = {
            ...entry.project,
            state: "error",
            error: errorDTO(error, entry.project.scope),
          };
          persist(entry);
        },
      );
      workers.set(entry.project.projectId, worker);
      const rootConversationId = await worker.ready;
      if (startupFailure) throw startupFailure;
      entry.project = {
        ...entry.project,
        state: "running",
        rootConversationId,
      };
    } catch (error) {
      const cleanup = await Promise.allSettled(worker ? [worker.close()] : []);
      workers.delete(entry.project.projectId);
      entry.project = {
        ...entry.project,
        state: "error",
        error: errorDTO(error, entry.project.scope),
      };
      if (cleanup[0]?.status === "rejected")
        entry.project = {
          ...entry.project,
          error: errorDTO(cleanup[0].reason, entry.project.scope),
        };
    }
    persist(entry);
  };
  const create = async (squadId: string): Promise<StoredProject> => {
    const metadata = await squadMetadata(definitionsDirectory, squadId);
    if (stored.has(metadata.projectId))
      throw runtimeFailure("conflict", "Project ID is already registered");
    const scope = {
      projectId: metadata.projectId,
      environmentId: options.mode,
      squadId,
      harnessId: randomUUID(),
    };
    let definition: DefinitionBundle | undefined;
    let error: RuntimeError | undefined;
    try {
      definition = loadDefinition(join(definitionsDirectory, squadId));
    } catch (failure) {
      error = errorDTO(failure, scope);
    }
    const binding: ProjectBinding = {
      projectId: metadata.projectId,
      scope,
      definition: { contentHash: definition?.contentHash ?? "" },
      environment,
    };
    const entry: StoredProject = {
      project: {
        ...metadata,
        scope,
        enabled: true,
        state: error ? "error" : "starting",
        definitionHash: binding.definition.contentHash,
        ...(environment.model
          ? {
              model: {
                ...environment.model,
                thinkingLevel: environment.thinkingLevel,
              },
            }
          : {}),
        ...(error ? { error } : {}),
      },
      binding,
    };
    const target = harnessDirectory(scope);
    await mkdir(target, { recursive: true });
    await atomicJSON(join(dirname(dirname(target)), "environment.json"), {
      environmentId: scope.environmentId,
      mode: options.mode,
      ...environment,
    });
    await atomicJSON(join(target, "binding.json"), binding);
    if (definition) await freezeDefinition(target, definition);
    stored.set(metadata.projectId, entry);
    persist(entry);
    return entry;
  };
  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    if (sealed)
      return Promise.reject(
        runtimeFailure("runtime_unavailable", "Daemon is closing"),
      );
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const close = (): Promise<void> => {
    sealed = true;
    closing ??= (async () => {
      await queue;
      const results = await Promise.allSettled(
        [...workers.values()].map((worker) => worker.close()),
      );
      workers.clear();
      database.close();
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length)
        throw new AggregateError(failures, "Harness cleanup failed");
    })();
    return closing;
  };
  try {
    const installation = database
      .prepare("SELECT instance_id, mode FROM installation WHERE id = 1")
      .get();
    const instanceId = installation
      ? String(installation.instance_id)
      : randomUUID();
    if (installation && installation.mode !== options.mode)
      throw runtimeFailure(
        "binding_mismatch",
        "Daemon mode does not match its directory",
      );
    if (!installation)
      database
        .prepare(
          "INSERT INTO installation (id, instance_id, mode) VALUES (1, ?, ?)",
        )
        .run(instanceId, options.mode);
    for (const row of database
      .prepare("SELECT value FROM projects ORDER BY project_id")
      .all()) {
      const entry: StoredProject = JSON.parse(String(row.value));
      const scope = entry.project.scope;
      if (
        !identifier.test(entry.project.projectId) ||
        scope.projectId !== entry.project.projectId ||
        !identifier.test(scope.squadId) ||
        scope.environmentId !== options.mode ||
        !/^[0-9a-f-]{36}$/u.test(scope.harnessId) ||
        !scopeMatches(scope, entry.binding.scope)
      )
        throw runtimeFailure(
          "binding_mismatch",
          "Stored project identity is invalid",
        );
      stored.set(entry.project.projectId, entry);
    }
    await realDirectory(definitionsDirectory);
    for (const entry of (
      await readdir(definitionsDirectory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !identifier.test(entry.name)) continue;
      if (
        [...stored.values()].some(
          (value) => value.project.scope.squadId === entry.name,
        )
      )
        continue;
      await create(entry.name);
    }
    await Promise.all([...stored.values()].map(launch));
    return {
      instanceId,
      mode: options.mode,
      listProjects: async () =>
        [...stored.values()].map((entry) => structuredClone(entry.project)),
      runtime: (scope) => {
        const entry = stored.get(scope.projectId);
        if (!entry || !scopeMatches(scope, entry.project.scope))
          throw runtimeFailure(
            "binding_mismatch",
            "No matching runtime scope is registered",
          );
        const worker = workers.get(scope.projectId);
        if (sealed || entry.project.state !== "running" || !worker)
          throw runtimeFailure(
            "runtime_unavailable",
            "Project runtime is not available",
          );
        return worker.service;
      },
      setProjectEnabled: (projectId, enabled) =>
        exclusive(async () => {
          const entry = stored.get(projectId);
          if (!entry)
            throw runtimeFailure("not_found", "Project was not found");
          entry.project = { ...entry.project, enabled };
          persist(entry);
          if (!enabled) {
            await workers.get(projectId)?.close();
            workers.delete(projectId);
            entry.project = { ...entry.project, state: "stopped" };
            persist(entry);
          } else if (entry.project.state !== "running") await launch(entry);
          return structuredClone(entry.project);
        }),
      registerProject: (squadId) =>
        exclusive(async () => {
          const entry = await create(squadId);
          await launch(entry);
          return structuredClone(entry.project);
        }),
      bindDefinition: (projectId) =>
        exclusive(async () => {
          const entry = stored.get(projectId);
          if (!entry)
            throw runtimeFailure("not_found", "Project was not found");
          const definition = loadDefinition(
            join(definitionsDirectory, entry.project.scope.squadId),
          );
          if (
            definition.projectId !== projectId ||
            definition.squadId !== entry.project.scope.squadId
          )
            throw runtimeFailure(
              "binding_mismatch",
              "Source definition changed its identity",
            );
          if (definition.contentHash === entry.project.definitionHash)
            return structuredClone(entry.project);
          const scope = { ...entry.project.scope, harnessId: randomUUID() };
          const binding: ProjectBinding = {
            ...entry.binding,
            scope,
            definition: { contentHash: definition.contentHash },
          };
          const target = harnessDirectory(scope);
          await mkdir(target, { recursive: true });
          await freezeDefinition(target, definition);
          await atomicJSON(join(target, "binding.json"), binding);
          await workers.get(projectId)?.close();
          workers.delete(projectId);
          const {
            error: _error,
            rootConversationId: _root,
            ...previous
          } = entry.project;
          entry.project = {
            ...previous,
            title: definition.title,
            scope,
            definitionHash: definition.contentHash,
            state: entry.project.enabled ? "starting" : "stopped",
          };
          entry.binding = binding;
          persist(entry);
          await launch(entry);
          return structuredClone(entry.project);
        }),
      close,
    };
  } catch (error) {
    await close();
    const diagnostic = errorDTO(error);
    throw Object.assign(new Error(diagnostic.message), diagnostic);
  }
}
