import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import type { Context, JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  type DefinitionBundle,
  loadDefinition,
} from "@frogie/core/definitions";
import type { ArtifactRef, RuntimeScope } from "@frogie/core/protocol";
import {
  type ArtifactStore,
  atomicLocalJSON,
  contentDigest,
  localFailure,
  objectId,
  ownLocalDirectory,
  readOwnedJSON,
  scopeIdentity,
  utf8Content,
} from "./artifacts.js";

const image =
  "node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5";
const outputLimit = 1024 * 1024;

interface ScriptInput {
  conversationId: number;
  taskId: number;
  roleId: string;
  workflowId?: string;
  skillId: string;
  scriptId: string;
  input: JsonValue;
}

export function canonicalJSON(value: JsonValue): string {
  const active = new Set<object>();
  const normalize = (input: JsonValue, depth = 0): JsonValue => {
    if (depth > 64)
      throw localFailure(
        "invalid_request",
        "JSON input nesting exceeds its limit",
      );
    if (
      input === null ||
      typeof input === "boolean" ||
      typeof input === "string"
    )
      return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input))
        throw localFailure("invalid_request", "JSON input is invalid");
      return input;
    }
    if (
      typeof input !== "object" ||
      (!Array.isArray(input) &&
        Object.getPrototypeOf(input) !== Object.prototype) ||
      active.has(input)
    )
      throw localFailure("invalid_request", "JSON input is invalid");
    active.add(input);
    const normalized = Array.isArray(input)
      ? Array.from(input, (item) => normalize(item, depth + 1))
      : Object.fromEntries(
          Object.entries(input)
            .sort(([a], [b]) => a.localeCompare(b, "en"))
            .map(([key, item]) => [key, normalize(item, depth + 1)]),
        );
    active.delete(input);
    return normalized;
  };
  return JSON.stringify(normalize(value));
}

async function docker(
  argv: readonly string[],
  input: Buffer,
  context: Context,
  milliseconds = 30_000,
  byteLimit = outputLimit,
): Promise<Buffer> {
  context.abortSignal?.throwIfAborted();
  if (milliseconds <= 0)
    throw localFailure("deadline_exceeded", "Local Docker deadline expired");
  return new Promise<Buffer>((accept, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("docker", [...argv], { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      reject(
        localFailure(
          "capability_missing",
          "Local Docker execution is unavailable",
        ),
      );
      return;
    }
    const output: Buffer[] = [];
    let bytes = 0;
    let stderrBytes = 0;
    let failure: unknown;
    let settled = false;
    let joining: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(joining);
      context.abortSignal?.removeEventListener("abort", abort);
      if (error !== undefined) reject(error);
      else accept(Buffer.concat(output));
    };
    const stop = (error: unknown) => {
      if (settled || failure !== undefined) return;
      failure = error;
      try {
        child.kill("SIGKILL");
      } catch {}
      // A killed create client is not proof that Docker has finished creating metadata.
      joining = setTimeout(
        () => finish(failure),
        Math.min(milliseconds, 1_000),
      );
    };
    const abort = () => stop(context.abortSignal?.reason);
    const timer = setTimeout(() => {
      stop(
        localFailure(
          "deadline_exceeded",
          "Local Docker execution exceeded its deadline",
        ),
      );
      finish(failure);
    }, milliseconds);
    context.abortSignal?.addEventListener("abort", abort, { once: true });
    child.on("error", () =>
      finish(
        failure ??
          localFailure(
            "capability_missing",
            "Local Docker execution is unavailable",
          ),
      ),
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled || failure !== undefined) return;
      bytes += chunk.length;
      if (bytes > byteLimit)
        stop(
          localFailure("output_limit", "Script output exceeds its byte limit"),
        );
      else output.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (settled || failure !== undefined) return;
      stderrBytes += chunk.length;
      if (stderrBytes > byteLimit)
        stop(
          localFailure(
            "output_limit",
            "Script diagnostics exceed their byte limit",
          ),
        );
    });
    child.stdin?.on("error", () =>
      stop(
        localFailure("script_failed", "Script input could not be delivered"),
      ),
    );
    child.once("close", (code) =>
      finish(
        failure ??
          (code === 0
            ? undefined
            : localFailure("script_failed", "Local Docker execution failed")),
      ),
    );
    try {
      child.stdin?.end(input);
    } catch {
      stop(
        localFailure("script_failed", "Script input could not be delivered"),
      );
    }
    if (context.abortSignal?.aborted) abort();
  });
}

function sandboxArguments(
  name: string,
  label: string,
  taskId?: number,
): string[] {
  return [
    "create",
    "--rm",
    "--pull=never",
    "--platform=linux/amd64",
    "--name",
    name,
    "--label",
    `ai.hexly.frogie.owner=${label}`,
    ...(taskId === undefined
      ? []
      : ["--label", `ai.hexly.frogie.task=${taskId}`]),
    "--network=none",
    "--user=65534:65534",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--cpus=1",
    "--memory=256m",
    "--memory-swap=256m",
    "--pids-limit=64",
    "--tmpfs=/work:rw,nosuid,nodev,noexec,size=16m,mode=1777",
    "--shm-size=1m",
    "--workdir=/work",
    "--env=HOME=/work",
    "--env=TMPDIR=/work",
    "--interactive",
  ];
}

async function cleanContainer(
  name: string,
  label: string,
  deadline = Date.now() + 5_000,
): Promise<void> {
  const query = async (argv: readonly string[]) =>
    (
      await docker(
        argv,
        Buffer.alloc(0),
        BACKGROUND_CONTEXT,
        deadline - Date.now(),
        4096,
      )
    )
      .toString("utf8")
      .trim();
  try {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const names = await query([
      "container",
      "ls",
      "--all",
      "--filter",
      `name=^/${escaped}$`,
      "--format",
      "{{.Names}}",
    ]);
    if (!names) return;
    if (names !== name)
      throw localFailure(
        "binding_mismatch",
        "Script container identity does not match",
      );
    const owner = await query([
      "container",
      "inspect",
      "--format",
      '{{index .Config.Labels "ai.hexly.frogie.owner"}}',
      name,
    ]);
    if (owner !== label)
      throw localFailure(
        "binding_mismatch",
        "Script container ownership does not match",
      );
    await query(["container", "rm", "--force", name]);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "binding_mismatch"
    )
      throw error;
    throw localFailure(
      "runtime_unavailable",
      "Script container cleanup could not be confirmed; recovery cleanup is required",
    );
  }
}

async function sandbox(options: {
  name: string;
  label: string;
  taskId?: number;
  mount?: string;
  command: readonly string[];
  input: Buffer;
  context: Context;
  deadline?: number;
  byteLimit?: number;
}): Promise<Buffer> {
  const { name, label, context } = options;
  context.abortSignal?.throwIfAborted();
  await cleanContainer(name, label, options.deadline);
  context.abortSignal?.throwIfAborted();
  let creating = true;
  let result: Buffer;
  try {
    const created = (
      await docker(
        [
          ...sandboxArguments(name, label, options.taskId),
          ...(options.mount === undefined
            ? []
            : [
                "--mount",
                `type=bind,src=${options.mount},dst=/skill,readonly`,
              ]),
          image,
          "node",
          ...options.command,
        ],
        Buffer.alloc(0),
        context,
        options.deadline === undefined ? 5_000 : options.deadline - Date.now(),
        4096,
      )
    )
      .toString("utf8")
      .trim();
    if (!/^[a-zA-Z0-9_-]+$/u.test(created))
      throw localFailure(
        "runtime_unavailable",
        "Container creation was not confirmed; recovery cleanup is required",
      );
    creating = false;
    context.abortSignal?.throwIfAborted();
    result = await docker(
      ["start", "--attach", "--interactive", created],
      options.input,
      context,
      options.deadline === undefined ? 30_000 : options.deadline - Date.now(),
      options.byteLimit,
    );
  } catch (error) {
    try {
      await cleanContainer(name, label);
    } catch (cleanupError) {
      if (!context.abortSignal?.aborted) throw cleanupError;
    }
    if (context.abortSignal?.aborted) throw context.abortSignal.reason;
    if (creating)
      throw localFailure(
        "runtime_unavailable",
        "Container creation could not be confirmed; recovery cleanup is required",
      );
    throw error;
  }
  await cleanContainer(name, label);
  context.abortSignal?.throwIfAborted();
  return result;
}

export async function checkScriptSandbox(context: Context): Promise<void> {
  context.abortSignal?.throwIfAborted();
  const deadline = Date.now() + 5_000;
  try {
    const platform = (
      await docker(
        ["info", "--format", "{{.OSType}}"],
        Buffer.alloc(0),
        context,
        deadline - Date.now(),
        4096,
      )
    )
      .toString("utf8")
      .trim();
    if (platform !== "linux")
      throw localFailure(
        "capability_missing",
        "Local Docker platform is unsupported",
      );
    const name = `frogie-probe-${randomUUID()}`;
    const label = contentDigest(name);
    const result = await sandbox({
      name,
      label,
      context,
      deadline,
      byteLimit: 4096,
      input: Buffer.alloc(0),
      command: [
        "--input-type=module",
        "--eval",
        'process.stdout.write(JSON.stringify({platform:process.platform,arch:process.arch,importMetaMain:typeof import.meta.main === "boolean"}))',
      ],
    });
    const proof: unknown = JSON.parse(result.toString("utf8"));
    if (
      !proof ||
      typeof proof !== "object" ||
      Array.isArray(proof) ||
      Object.keys(proof).length !== 3 ||
      !("platform" in proof) ||
      proof.platform !== "linux" ||
      !("arch" in proof) ||
      proof.arch !== "x64" ||
      !("importMetaMain" in proof) ||
      proof.importMetaMain !== true
    )
      throw localFailure(
        "capability_missing",
        "Pinned Node sandbox capabilities are unavailable",
      );
    context.abortSignal?.throwIfAborted();
  } catch {
    if (context.abortSignal?.aborted) throw context.abortSignal.reason;
    throw localFailure(
      "capability_missing",
      "Pinned Node sandbox preflight failed; unconfirmed containers require recovery cleanup",
    );
  }
}

export function createScriptRunner(options: {
  directory: string;
  definitionDirectory: string;
  definition: DefinitionBundle;
  scope: RuntimeScope;
  artifacts: ArtifactStore;
  approvedScripts: readonly string[];
}): {
  run(
    input: ScriptInput,
    context: Context,
  ): Promise<{ output: JsonValue; artifact: ArtifactRef }>;
} {
  const definition = options.definition;
  const approvedScripts = new Set(options.approvedScripts);
  let owned: ReturnType<typeof ownLocalDirectory> | undefined;
  const active = new Map<
    number,
    {
      digest: string;
      promise: Promise<{ output: JsonValue; artifact: ArtifactRef }>;
    }
  >();
  const run = async (
    input: ScriptInput,
    context: Context,
  ): Promise<{ output: JsonValue; artifact: ArtifactRef }> => {
    context.abortSignal?.throwIfAborted();
    objectId(input.conversationId);
    objectId(input.taskId);
    const role = definition.roles.find(({ id }) => id === input.roleId);
    const workflow =
      input.workflowId === undefined
        ? undefined
        : definition.workflows.find(({ id }) => id === input.workflowId);
    const skill = definition.skills.find(({ id }) => id === input.skillId);
    const script = skill?.scripts.find(({ id }) => id === input.scriptId);
    const selected = `${input.skillId}/${input.scriptId}`;
    if (
      !role?.tools.includes("run_script") ||
      !role.skills.includes(input.skillId) ||
      !role.scripts.includes(selected) ||
      (input.workflowId !== undefined &&
        (!workflow ||
          (workflow.tools !== undefined &&
            !workflow.tools.includes("run_script")) ||
          (workflow.scripts !== undefined &&
            !workflow.scripts.includes(selected))))
    )
      throw localFailure(
        "forbidden",
        "Script is not allowed for this role and workflow",
      );
    if (
      script?.replay !== "safe" ||
      script.runtime !== "node" ||
      !approvedScripts.has(`${definition.contentHash}:${selected}`)
    )
      throw localFailure(
        "capability_missing",
        "Script version has not been approved for safe execution",
      );
    if (
      definition.projectId !== options.scope.projectId ||
      definition.squadId !== options.scope.squadId
    )
      throw localFailure(
        "binding_mismatch",
        "Script definition scope does not match",
      );
    const definitionDirectory = resolve(options.definitionDirectory);
    const stat = await lstat(definitionDirectory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      loadDefinition(definitionDirectory).contentHash !== definition.contentHash
    )
      throw localFailure(
        "binding_mismatch",
        "Script definition snapshot does not match",
      );
    const skillDirectory = join(definitionDirectory, "skills", input.skillId);
    const skillStat = await lstat(skillDirectory);
    if (
      !skillStat.isDirectory() ||
      skillStat.isSymbolicLink() ||
      (await realpath(skillDirectory)) !==
        join(await realpath(definitionDirectory), "skills", input.skillId) ||
      posix.isAbsolute(script.entry) ||
      script.entry
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..") ||
      script.entry.includes("\\")
    )
      throw localFailure("binding_mismatch", "Script resource path is invalid");
    const text = canonicalJSON(input.input);
    const bytes = utf8Content(text);
    const fingerprint = contentDigest(
      JSON.stringify([
        scopeIdentity(options.scope),
        input.conversationId,
        input.taskId,
        input.roleId,
        input.workflowId,
        definition.contentHash,
        selected,
        script.entry,
        image,
        text,
      ]),
    );
    const prior = active.get(input.taskId);
    if (prior) {
      if (prior.digest !== fingerprint)
        throw localFailure(
          "conflict",
          "Script task identifies different input",
        );
      return prior.promise;
    }
    const promise = (async () => {
      owned ??= ownLocalDirectory(
        options.directory,
        options.scope,
        "frogie.scripts.v1",
      );
      const directory = await owned;
      await directory.check();
      const key = contentDigest(
        JSON.stringify([scopeIdentity(options.scope), input.taskId]),
      );
      const path = join(directory.path, `${key}.json`);
      try {
        const receipt = (await readOwnedJSON(
          path,
          outputLimit * 6 + 65536,
        )) as { digest: string; output: JsonValue; artifact: ArtifactRef };
        if (!receipt || receipt.digest !== fingerprint)
          throw localFailure(
            "conflict",
            "Script task receipt identifies different input",
          );
        const artifact = await options.artifacts.read(
          receipt.artifact.id,
          input.conversationId,
        );
        if (JSON.stringify(receipt.artifact) !== JSON.stringify(artifact.ref))
          throw localFailure(
            "binding_mismatch",
            "Script receipt artifact does not match",
          );
        if (
          canonicalJSON(receipt.output) !==
          canonicalJSON(JSON.parse(artifact.content) as JsonValue)
        )
          throw localFailure(
            "binding_mismatch",
            "Script result artifact does not match its receipt",
          );
        return { output: receipt.output, artifact: artifact.ref };
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
      }
      const name = `frogie-script-${key}`;
      const label = contentDigest(scopeIdentity(options.scope));
      const result = await sandbox({
        name,
        label,
        taskId: input.taskId,
        mount: await realpath(skillDirectory),
        command: [`/skill/${script.entry}`],
        input: bytes,
        context,
      });
      const content = result.toString("utf8");
      if (Buffer.from(content, "utf8").compare(result) !== 0)
        throw localFailure("script_failed", "Script output is not valid UTF-8");
      let output: JsonValue;
      try {
        output = JSON.parse(content) as JsonValue;
        canonicalJSON(output);
      } catch {
        throw localFailure(
          "script_failed",
          "Script output is not a valid JSON result",
        );
      }
      context.abortSignal?.throwIfAborted();
      const artifact = await options.artifacts.write({
        conversationId: input.conversationId,
        taskId: input.taskId,
        operationId: `script:${input.taskId}`,
        name: `${input.skillId}-${input.scriptId}.json`,
        mediaType: "application/json",
        content,
      });
      await directory.check();
      await atomicLocalJSON(path, { digest: fingerprint, output, artifact });
      return { output, artifact };
    })();
    active.set(input.taskId, { digest: fingerprint, promise });
    try {
      return await promise;
    } finally {
      active.delete(input.taskId);
    }
  };
  return {
    run: async (input, context) => {
      try {
        return await run(input, context);
      } catch (error) {
        if (context.abortSignal?.aborted) throw context.abortSignal.reason;
        if (
          error instanceof Error &&
          "retryable" in error &&
          error.retryable === false
        )
          throw error;
        throw localFailure(
          "runtime_unavailable",
          "Local script operation could not complete",
        );
      }
    },
  };
}
