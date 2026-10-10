import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import * as definitions from "@frogie/core/definitions";
import type { RuntimeError } from "@frogie/core/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workers = vi.hoisted(() => ({
  instances: [] as {
    ready: Promise<number>;
    close: ReturnType<typeof vi.fn>;
    service: object;
    onFailure: (error: RuntimeError) => void;
  }[],
  ready: [] as (() => Promise<number>)[],
  construct: [] as ((onFailure: (error: RuntimeError) => void) => void)[],
  closing: [] as (() => Promise<void>)[],
}));
vi.mock("./harnessProcess.js", async (original) => {
  const actual = await original<typeof import("./harnessProcess.js")>();
  return {
    ...actual,
    HarnessProcess: class {
      ready: Promise<number>;
      close: ReturnType<typeof vi.fn>;
      service = { marker: "scope-owned-service" };
      constructor(_config: unknown, onFailure: (error: RuntimeError) => void) {
        workers.construct.shift()?.(onFailure);
        this.ready = workers.ready.shift()?.() ?? Promise.resolve(17);
        this.close = vi.fn(workers.closing.shift() ?? (async () => undefined));
        workers.instances.push({ ...this, onFailure });
      }
    },
  };
});

import { startDaemon } from "./daemon.js";

const source = fileURLToPath(
  new URL("../../../tests/fixtures/minimal-squad", import.meta.url),
);
type Daemon = Awaited<ReturnType<typeof startDaemon>>;
let root: string;
let directory: string;
let definitionsDirectory: string;
const daemons: Daemon[] = [];

async function definition(squadId = "alpha-squad", projectId = "alpha") {
  const target = join(definitionsDirectory, squadId);
  await cp(source, target, { recursive: true });
  const path = join(target, "SQUAD.md");
  await writeFile(
    path,
    (await readFile(path, "utf8"))
      .replace("id: minimal-squad", `id: ${squadId}`)
      .replace("projectId: frogie", `projectId: ${projectId}`),
  );
  return target;
}
async function start(options: Partial<Parameters<typeof startDaemon>[0]> = {}) {
  const daemon = await startDaemon({
    directory,
    definitionsDirectory,
    mode: "e2e",
    ...options,
  });
  daemons.push(daemon);
  return daemon;
}
async function listed(daemon: Daemon, id = "alpha") {
  const project = (await daemon.listProjects()).find(
    (project) => project.projectId === id,
  );
  if (!project) throw new Error(`Missing fixture project ${id}`);
  return project;
}
function changeStored(
  update: (entry: {
    project: Record<string, unknown>;
    binding: Record<string, unknown>;
  }) => void,
) {
  const database = new DatabaseSync(join(directory, "daemon.sqlite"));
  try {
    const row = database
      .prepare("SELECT value FROM projects WHERE project_id = 'alpha'")
      .get();
    const value = JSON.parse(String(row?.value));
    update(value);
    database
      .prepare("UPDATE projects SET value = ? WHERE project_id = 'alpha'")
      .run(JSON.stringify(value));
  } finally {
    database.close();
  }
}

beforeEach(async () => {
  workers.instances.length = 0;
  workers.ready.length = 0;
  workers.construct.length = 0;
  workers.closing.length = 0;
  root = await mkdtemp(join(tmpdir(), "frogie-daemon-boundaries-"));
  directory = join(root, "runtime");
  definitionsDirectory = join(root, "definitions");
  await definition();
});
afterEach(async () => {
  await Promise.allSettled(daemons.splice(0).map((daemon) => daemon.close()));
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("daemon lifecycle and registration boundaries", () => {
  it("clones directory projections and does not restart already running projects or rebind identical source", async () => {
    const daemon = await start();
    const project = await listed(daemon);
    const projection = await listed(daemon);
    Reflect.set(projection.scope, "harnessId", "forged");
    expect((await listed(daemon)).scope).toEqual(project.scope);
    expect(await daemon.setProjectEnabled("alpha", true)).toEqual(project);
    expect(await daemon.bindDefinition("alpha")).toEqual(project);
    expect(workers.instances).toHaveLength(1);
    expect(daemon.runtime(project.scope)).toBe(workers.instances[0]?.service);
    await daemon.close();
    await expect(daemon.registerProject("other-squad")).rejects.toMatchObject({
      code: "runtime_unavailable",
    });
    await expect(daemon.bindDefinition("alpha")).rejects.toMatchObject({
      code: "runtime_unavailable",
    });
    await expect(
      daemon.setProjectEnabled("alpha", false),
    ).rejects.toMatchObject({ code: "runtime_unavailable" });
    expect(() => daemon.runtime(project.scope)).toThrow(
      expect.objectContaining({ code: "runtime_unavailable" }),
    );
  });

  it("rejects unknown projects, duplicate project IDs and invalid squad identifiers without replacing bindings", async () => {
    const daemon = await start();
    const before = await daemon.listProjects();
    await expect(
      daemon.setProjectEnabled("unknown", false),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(daemon.bindDefinition("unknown")).rejects.toMatchObject({
      code: "not_found",
    });
    await definition("duplicate-squad", "alpha");
    await expect(
      daemon.registerProject("duplicate-squad"),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(daemon.registerProject("../escape")).rejects.toMatchObject({
      code: "invalid_definition",
    });
    expect(await daemon.listProjects()).toEqual(before);
  });

  it("preserves the original binding if edited source changes its project identity", async () => {
    const daemon = await start();
    const before = await listed(daemon);
    const path = join(definitionsDirectory, before.scope.squadId, "SQUAD.md");
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace(
        "projectId: alpha",
        "projectId: other",
      ),
    );
    await expect(daemon.bindDefinition("alpha")).rejects.toMatchObject({
      code: "binding_mismatch",
    });
    expect(await listed(daemon)).toEqual(before);
    expect(workers.instances[0]?.close).not.toHaveBeenCalled();
  });

  it("creates a new stopped binding after source edits without launching a worker", async () => {
    const daemon = await start();
    await daemon.setProjectEnabled("alpha", false);
    const before = await listed(daemon);
    const oldDirectory = join(
      directory,
      "projects",
      "alpha",
      "environments",
      "e2e",
      "harnesses",
      before.scope.harnessId,
    );
    const oldBinding = await readFile(
      join(oldDirectory, "binding.json"),
      "utf8",
    );
    const role = join(
      definitionsDirectory,
      "alpha-squad",
      "roles",
      "command",
      "ROLE.md",
    );
    await writeFile(
      role,
      `${await readFile(role, "utf8")}\nRevised mission.\n`,
    );
    const changed = await daemon.bindDefinition("alpha");
    expect(changed).toMatchObject({ enabled: false, state: "stopped" });
    expect(changed.scope.harnessId).not.toBe(before.scope.harnessId);
    expect(changed.definitionHash).not.toBe(before.definitionHash);
    expect(changed.rootConversationId).toBeUndefined();
    expect(await readFile(join(oldDirectory, "binding.json"), "utf8")).toBe(
      oldBinding,
    );
    expect(workers.instances).toHaveLength(1);
  });

  it("projects worker crashes only into their own project and ignores callbacks after stop or daemon close", async () => {
    await definition("beta-squad", "beta");
    const daemon = await start();
    const beta = await listed(daemon, "beta");
    workers.instances[0]?.onFailure({
      code: "runtime_unavailable",
      message: "Worker exited",
      retryable: false,
    });
    expect(await listed(daemon)).toMatchObject({
      state: "error",
      error: { scope: (await listed(daemon)).scope },
    });
    expect(await listed(daemon, "beta")).toEqual(beta);
    await daemon.setProjectEnabled("alpha", false);
    workers.instances[0]?.onFailure({
      code: "runtime_unavailable",
      message: "Late worker failure",
      retryable: false,
    });
    expect((await listed(daemon)).state).toBe("stopped");
    await daemon.close();
    workers.instances[1]?.onFailure({
      code: "runtime_unavailable",
      message: "Late shutdown failure",
      retryable: false,
    });
    expect((await listed(daemon, "beta")).state).toBe("running");
  });

  it("isolates rejected worker startup and cleanup from another healthy project without exposing secrets", async () => {
    await definition("beta-squad", "beta");
    workers.ready.push(async () => {
      throw Object.assign(new Error("private-secret"), {
        code: "capability_missing",
      });
    });
    workers.closing.push(async () => {
      throw new Error("cleanup-private-secret");
    });
    const daemon = await start();
    expect(await listed(daemon)).toMatchObject({
      state: "error",
      error: { code: "runtime_unavailable" },
    });
    expect(JSON.stringify(await daemon.listProjects())).not.toContain(
      "private-secret",
    );
    expect((await listed(daemon, "beta")).state).toBe("running");
    const failedProject = await listed(daemon);
    expect(() => daemon.runtime(failedProject.scope)).toThrow(
      expect.objectContaining({ code: "runtime_unavailable" }),
    );
  });

  it("keeps an invalid definition registered and allows recovery through a repaired explicit binding", async () => {
    const role = join(
      definitionsDirectory,
      "alpha-squad",
      "roles",
      "command",
      "ROLE.md",
    );
    const original = await readFile(role, "utf8");
    await writeFile(
      role,
      original.replace("skills: [planning]", "skills: [missing]"),
    );
    const daemon = await start();
    expect(await listed(daemon)).toMatchObject({
      state: "error",
      definitionHash: "",
      error: { code: "invalid_definition" },
    });
    expect(workers.instances).toHaveLength(0);
    await daemon.setProjectEnabled("alpha", false);
    await daemon.setProjectEnabled("alpha", false);
    await daemon.setProjectEnabled("alpha", true);
    expect((await listed(daemon)).state).toBe("error");
    await writeFile(role, original);
    const repaired = await daemon.bindDefinition("alpha");
    expect(repaired.state).toBe("running");
    expect(workers.instances).toHaveLength(1);
  });

  it("registers a new project after startup, keeps directory ownership exclusive and reenables persisted stopped projects", async () => {
    const daemon = await start();
    await expect(start()).rejects.toMatchObject({ code: "storage_in_use" });
    await definition("beta-squad", "beta");
    expect(await daemon.registerProject("beta-squad")).toMatchObject({
      projectId: "beta",
      state: "running",
    });
    await daemon.setProjectEnabled("alpha", false);
    await daemon.close();
    const reopened = await start();
    expect((await listed(reopened)).state).toBe("stopped");
    expect((await listed(reopened, "beta")).state).toBe("running");
    expect((await reopened.setProjectEnabled("alpha", true)).state).toBe(
      "running",
    );
  });

  it.each(["model", "no-model"] as const)(
    "stores an independent Local environment with %s configuration",
    async (kind) => {
      const model = {
        baseUrl: "http://127.0.0.1:12345/v1",
        apiKey: "private-secret",
        modelId: "test-model",
        contextWindow: 32000,
        maxTokens: 1024,
        thinkingLevel: "off" as const,
      };
      const daemon = await start({
        mode: "local",
        ...(kind === "model" ? { model } : {}),
      });
      expect(daemon.mode).toBe("local");
      const project = await listed(daemon);
      expect(project.scope.environmentId).toBe("local");
      if (kind === "model")
        expect(project.model).toEqual({
          provider: "local-model",
          modelId: model.modelId,
          thinkingLevel: "off",
        });
      else expect(project.model).toBeUndefined();
      expect(JSON.stringify(project)).not.toContain("private-secret");
    },
  );

  it("keeps a capability startup diagnostic without exposing its original message", async () => {
    workers.ready.push(async () => {
      throw Object.assign(new Error("private-secret"), {
        code: "capability_missing",
      });
    });
    const daemon = await start();
    expect(await listed(daemon)).toMatchObject({
      state: "error",
      error: {
        code: "capability_missing",
        message: "A required model, tool, or extension is unavailable",
      },
    });
  });

  it("rejects a frozen definition whose bytes do not retain the source hash", async () => {
    const load = definitions.loadDefinition;
    vi.spyOn(definitions, "loadDefinition").mockImplementation((path) => {
      const result = load(path);
      return path.includes(".definition.")
        ? { ...result, contentHash: "tampered-freeze" }
        : result;
    });
    await expect(start()).rejects.toMatchObject({ code: "binding_mismatch" });
    expect(workers.instances).toHaveLength(0);
  });

  it("normalizes an unexpected definition parser failure while retaining the project diagnostic", async () => {
    vi.spyOn(definitions, "loadDefinition").mockImplementationOnce(() => {
      throw "private-secret";
    });
    const daemon = await start();
    expect(await listed(daemon)).toMatchObject({
      state: "error",
      error: { code: "runtime_unavailable" },
    });
    expect(JSON.stringify(await daemon.listProjects())).not.toContain(
      "private-secret",
    );
  });

  it("isolates synchronous worker construction failures and failure callbacks from a healthy project", async () => {
    await definition("beta-squad", "beta");
    workers.construct.push(() => {
      throw new Error("private-secret constructor failure");
    });
    let daemon = await start();
    expect(await listed(daemon)).toMatchObject({
      state: "error",
      error: { code: "runtime_unavailable" },
    });
    expect((await listed(daemon, "beta")).state).toBe("running");
    const failed = await listed(daemon);
    expect(() => daemon.runtime(failed.scope)).toThrow(
      expect.objectContaining({ code: "runtime_unavailable" }),
    );
    expect(JSON.stringify(await daemon.listProjects())).not.toContain(
      "private-secret",
    );
    await daemon.close();
    workers.construct.push((onFailure) =>
      onFailure({
        code: "runtime_unavailable",
        message: "Safe synchronous failure",
        retryable: false,
      }),
    );
    daemon = await start();
    expect(await listed(daemon)).toMatchObject({
      state: "error",
      error: { code: "runtime_unavailable" },
    });
    expect((await listed(daemon, "beta")).state).toBe("running");
    const beta = await listed(daemon, "beta");
    expect(daemon.runtime(beta.scope)).toEqual({
      marker: "scope-owned-service",
    });
  });

  it("aggregates close failures while releasing the daemon SQLite lock and keeps close idempotent", async () => {
    workers.closing.push(async () => {
      throw new Error("Owned worker cleanup failed");
    });
    const daemon = await start();
    const closing = daemon.close();
    expect(daemon.close()).toBe(closing);
    await expect(closing).rejects.toBeInstanceOf(AggregateError);
    const reopened = await start();
    expect(reopened.instanceId).toBe(daemon.instanceId);
    expect(workers.instances[0]?.close).toHaveBeenCalledOnce();
  });
});

describe("daemon directory integrity", () => {
  it("rejects a non-daemon directory and a symlinked data root without modifying owned sentinels", async () => {
    await mkdir(directory);
    await writeFile(join(directory, "sentinel.txt"), "owned sentinel");
    await expect(start()).rejects.toMatchObject({ code: "binding_mismatch" });
    expect(await readFile(join(directory, "sentinel.txt"), "utf8")).toBe(
      "owned sentinel",
    );
    const link = join(root, "linked-runtime");
    await symlink(directory, link);
    await expect(start({ directory: link })).rejects.toMatchObject({
      code: "invalid_directory",
    });
  });

  it("rejects a symlinked SQLite path and unrelated SQLite without overwriting either", async () => {
    await mkdir(directory);
    const outside = join(root, "other.sqlite");
    const database = new DatabaseSync(outside);
    database.exec("CREATE TABLE unrelated (id INTEGER)");
    database.close();
    await symlink(outside, join(directory, "daemon.sqlite"));
    await expect(start()).rejects.toMatchObject({ code: "binding_mismatch" });
    await rm(join(directory, "daemon.sqlite"));
    await cp(outside, join(directory, "daemon.sqlite"));
    await expect(start()).rejects.toMatchObject({ code: "binding_mismatch" });
  });

  it.each(["mode", "projectId", "scope", "harnessId", "binding"] as const)(
    "rejects persisted %s tampering while releasing storage for repair",
    async (field) => {
      const daemon = await start();
      await daemon.close();
      if (field === "mode") {
        await expect(start({ mode: "local" })).rejects.toMatchObject({
          code: "binding_mismatch",
        });
        return;
      }
      changeStored((entry) => {
        if (field === "projectId") entry.project.projectId = "../escape";
        if (field === "scope")
          entry.project.scope = {
            ...(entry.project.scope as object),
            projectId: "other",
          };
        if (field === "harnessId")
          entry.project.scope = {
            ...(entry.project.scope as object),
            harnessId: "invalid",
          };
        if (field === "binding")
          entry.binding.scope = {
            ...(entry.binding.scope as object),
            squadId: "other",
          };
      });
      await expect(start()).rejects.toMatchObject({ code: "binding_mismatch" });
      const repaired = new DatabaseSync(join(directory, "daemon.sqlite"));
      repaired.exec("DELETE FROM projects");
      repaired.close();
    },
  );

  it.each([
    "missing",
    "duplicate",
    "wrong-id",
    "blank-title",
    "bad-project",
  ] as const)("rejects invalid Squad metadata (%s)", async (failure) => {
    const path = join(definitionsDirectory, "alpha-squad", "SQUAD.md");
    let text = await readFile(path, "utf8");
    if (failure === "missing") text = "No metadata";
    if (failure === "duplicate")
      text = text.replace(
        "projectId: alpha",
        "projectId: alpha\nprojectId: beta",
      );
    if (failure === "wrong-id")
      text = text.replace("id: alpha-squad", "id: wrong-squad");
    if (failure === "blank-title")
      text = text.replace("title: Minimal Squad", "title: '  '");
    if (failure === "bad-project")
      text = text.replace("projectId: alpha", "projectId: ../escape");
    await writeFile(path, text);
    await expect(start()).rejects.toMatchObject({ code: "invalid_definition" });
    expect(workers.instances).toHaveLength(0);
  });

  it("rejects symlinked metadata and ignores non-Squad directory entries", async () => {
    const path = join(definitionsDirectory, "alpha-squad", "SQUAD.md");
    const original = join(root, "original.md");
    await cp(path, original);
    await rm(path);
    await symlink(original, path);
    await expect(start()).rejects.toMatchObject({ code: "invalid_definition" });
    await rm(path);
    await cp(original, path);
    await mkdir(join(definitionsDirectory, "Invalid-Name"));
    await writeFile(join(definitionsDirectory, "notes.txt"), "not a Squad");
    const daemon = await start();
    expect(await daemon.listProjects()).toHaveLength(1);
  });

  it("adopts an authenticated E2E owner workspace with private SQLite permissions", async () => {
    definitionsDirectory = join(directory, "workspace", "squads");
    await definition();
    await writeFile(
      join(directory, "owner.json"),
      JSON.stringify({ runId: randomUUID(), root: directory }),
    );
    const daemon = await start();
    expect((await stat(join(directory, "daemon.sqlite"))).mode & 0o777).toBe(
      0o600,
    );
    expect(await daemon.listProjects()).toHaveLength(1);
  });

  it.each([
    "invalid-json",
    "invalid-run",
    "wrong-root",
    "symlink-owner",
    "wrong-workspace",
  ] as const)("rejects an unowned E2E workspace (%s)", async (failure) => {
    const owner = join(directory, "owner.json");
    await mkdir(join(directory, "workspace", "squads"), { recursive: true });
    let value = JSON.stringify({ runId: randomUUID(), root: directory });
    if (failure === "invalid-json") value = "{";
    if (failure === "invalid-run")
      value = JSON.stringify({ runId: "not-a-run", root: directory });
    if (failure === "wrong-root")
      value = JSON.stringify({ runId: randomUUID(), root });
    await writeFile(owner, value);
    if (failure === "symlink-owner") {
      const target = join(root, "owner-source.json");
      await cp(owner, target);
      await rm(owner);
      await symlink(target, owner);
    }
    if (failure !== "wrong-workspace")
      definitionsDirectory = join(directory, "workspace", "squads");
    await expect(start()).rejects.toMatchObject({ code: "binding_mismatch" });
    expect(await readFile(owner, "utf8")).toBe(value);
  });
});
