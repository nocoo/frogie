import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "@earendil-works/chord";
import {
  BACKGROUND_CONTEXT as context,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { loadDefinition } from "@frogie/core/definitions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifactStore } from "./artifacts.js";
import {
  canonicalJSON,
  checkScriptSandbox,
  createScriptRunner,
} from "./scriptRunner.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const source = fileURLToPath(
  new URL("../../../squads/zeppelin", import.meta.url),
);
const scope = {
  projectId: "frogie",
  environmentId: "e2e",
  squadId: "zeppelin",
  harnessId: "script-harness",
};
const input = {
  conversationId: 17,
  taskId: 23,
  roleId: "engineering",
  skillId: "resource-budget",
  scriptId: "calculate",
  input: {
    budgets: [
      {
        id: "alpha",
        available: 10,
        reserve: 2,
        allocations: [{ id: "fuel", amount: 3 }],
      },
    ],
  },
};
const output = {
  budgets: [{ id: "alpha", demand: 3, remaining: 5, withinBudget: true }],
};
let root: string;
let definitionDirectory: string;
const children: ReturnType<typeof child>[] = [];
const workloads: ReturnType<typeof child>[] = [];
const containers = new Map<
  string,
  { label: string; args: readonly string[] }
>();
let probeOutput = { platform: "linux", arch: "x64", importMetaMain: true };
let managementFailure:
  | "ls-error"
  | "ls-timeout"
  | "ls-exit"
  | "inspect-error"
  | "inspect-timeout"
  | "rm-error"
  | "rm-timeout"
  | "rm-exit"
  | undefined;
const managementEntered = new Map<
  string,
  ReturnType<typeof deferred<ReturnType<typeof child>>>
>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function option(args: readonly string[], flag: string) {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  const index = args.indexOf(flag);
  return (
    inline?.slice(flag.length + 1) ?? (index < 0 ? undefined : args[index + 1])
  );
}

function child() {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const buffers: Buffer[] = [];
  stdin.on("data", (data) => buffers.push(Buffer.from(data)));
  let closed = false;
  const finish = (value: string | Buffer, code: number | null) => {
    if (closed) return;
    closed = true;
    stdout.end(value);
    stderr.end();
    emitter.emit("close", code, null);
  };
  const process = Object.assign(emitter, {
    stdout,
    stderr,
    stdin,
    kill: vi.fn(() => {
      queueMicrotask(() => finish("", null));
      return true;
    }),
    pid: 12345,
  });
  const entered = deferred<readonly string[]>();
  const result = {
    process,
    entered,
    stdin: () => Buffer.concat(buffers).toString(),
    complete: (value: string | Buffer, code = 0) => finish(value, code),
  };
  return result;
}

function dockerOperation(args: readonly string[]): string {
  return args[0] === "container" || args[0] === "image"
    ? (args[1] ?? "")
    : (args[0] ?? "");
}

function mockDocker(
  _command: string,
  rawArgs?: readonly string[],
): ChildProcess {
  const args = rawArgs ?? [];
  const operation = dockerOperation(args);
  const name = args.at(-1) ?? "";
  if (operation === "start") {
    const container = containers.get(name);
    if (!container)
      throw new Error("Cannot start an unowned fixture container");
    if (container.args.some((arg) => arg.startsWith("/skill/"))) {
      const process = workloads.shift();
      if (!process) throw new Error("Unexpected Docker script execution");
      process.entered.resolve(container.args);
      return process.process as unknown as ChildProcess;
    }
  }
  const process = child();
  children.push(process);
  managementEntered.get(operation)?.resolve(process);
  if (managementFailure === `${operation}-timeout`)
    return process.process as unknown as ChildProcess;
  queueMicrotask(() => {
    if (managementFailure === `${operation}-error`) {
      process.process.emit(
        "error",
        new Error("private-secret Docker management"),
      );
      return;
    }
    if (
      (operation === "rm" || operation === "ls") &&
      managementFailure === `${operation}-exit`
    ) {
      process.complete("private-secret failed query", 1);
      return;
    }
    if (operation === "info") process.complete("linux");
    else if (args[0] === "image") process.complete("/");
    else if (operation === "create") {
      const createdName = option(args, "--name");
      if (!createdName) throw new Error("Container must have an owned name");
      const label = args
        .map((arg, index) =>
          arg === "--label"
            ? args[index + 1]
            : arg.startsWith("--label=")
              ? arg.slice(8)
              : "",
        )
        .find((value) => value?.startsWith("ai.hexly.frogie.owner="));
      containers.set(createdName, {
        label: label?.slice("ai.hexly.frogie.owner=".length) ?? "",
        args,
      });
      process.complete(createdName);
    } else if (operation === "start")
      process.complete(JSON.stringify(probeOutput));
    else if (operation === "ls") {
      const filter = args
        .map((arg, index) =>
          arg === "--filter"
            ? args[index + 1]
            : arg.startsWith("--filter=")
              ? arg.slice(9)
              : "",
        )
        .find((value) => value?.startsWith("name="));
      const exact = filter?.replace(/^name=\^\/?/, "").replace(/\$$/, "") ?? "";
      process.complete(containers.has(exact) ? exact : "");
    } else if (operation === "inspect")
      process.complete(
        containers.get(name)?.label ?? "",
        containers.has(name) ? 0 : 1,
      );
    else if (operation === "rm") {
      containers.delete(name);
      process.complete("");
    } else throw new Error(`Unexpected Docker fixture operation ${operation}`);
  });
  return process.process as unknown as ChildProcess;
}

beforeEach(async () => {
  vi.clearAllMocks();
  containers.clear();
  workloads.length = 0;
  probeOutput = { platform: "linux", arch: "x64", importMetaMain: true };
  managementFailure = undefined;
  managementEntered.clear();
  vi.mocked(spawn).mockImplementation(mockDocker);
  root = await mkdtemp(join(tmpdir(), "frogie-script-test-"));
  definitionDirectory = join(root, "definition");
  await cp(source, definitionDirectory, { recursive: true });
});
afterEach(async () => {
  for (const item of children.splice(0)) {
    item.process.stdout.destroy();
    item.process.stderr.destroy();
    item.process.stdin.destroy();
  }
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

async function setup() {
  const definition = loadDefinition(definitionDirectory);
  const artifacts = await createArtifactStore({
    directory: join(root, "artifacts"),
    scope,
  });
  const options = {
    directory: join(root, "scripts"),
    definitionDirectory,
    definition,
    scope,
    artifacts,
    approvedScripts: [`${definition.contentHash}:resource-budget/calculate`],
  };
  return { ...options, runner: createScriptRunner(options) };
}

function workload() {
  const result = child();
  children.push(result);
  workloads.push(result);
  return result;
}

function settled<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
}

function runCalls() {
  return vi
    .mocked(spawn)
    .mock.calls.filter(
      ([, args]) => dockerOperation(args as string[]) === "start",
    );
}

describe("script sandbox preflight", () => {
  it("checks the pinned Node sandbox capabilities without mounts, pulling or building", async () => {
    await checkScriptSandbox(context);
    const calls = vi.mocked(spawn).mock.calls;
    expect(calls[0]?.[0]).toBe("docker");
    expect(calls[0]?.[1]).toEqual(["info", "--format", "{{.OSType}}"]);
    const created = calls.find(
      ([, args]) => dockerOperation(args as string[]) === "create",
    )?.[1] as string[] | undefined;
    if (!created) throw new Error("Missing Node sandbox creation");
    expect(created.join(" ")).toMatch(/node@sha256:[a-f0-9]{64}/);
    expect(created.join(" ")).toContain("import.meta.main");
    expect(created.join(" ")).toContain("process.platform");
    expect(created.join(" ")).toContain("process.arch");
    expect(option(created, "--network")).toBe("none");
    expect(option(created, "--pull")).toBe("never");
    expect(option(created, "--user")).not.toMatch(/^(root|0)(:|$)/);
    expect(created).toContain("--read-only");
    expect(option(created, "--cap-drop")).toBe("ALL");
    expect(option(created, "--security-opt")).toMatch(
      /^no-new-privileges(?::true)?$/,
    );
    expect(option(created, "--cpus")).toBe("1");
    expect(option(created, "--memory")).toMatch(/^(256m|268435456)$/i);
    expect(option(created, "--pids-limit")).toBe("64");
    expect(option(created, "--tmpfs")).toMatch(/\/work:.*size=(16m|16777216)/i);
    expect(
      created.some((argument) =>
        ["--mount", "--volume", "-v", "--privileged"].includes(argument),
      ),
    ).toBe(false);
    const name = option(created, "--name");
    expect(
      calls.filter(([, args]) => dockerOperation(args as string[]) === "start"),
    ).toHaveLength(1);
    expect(
      calls.some(
        ([, args]) =>
          dockerOperation(args as string[]) === "rm" &&
          (args as string[]).at(-1) === name,
      ),
    ).toBe(true);
    expect(
      calls.every(
        ([, args]) =>
          !(args as string[]).some((argument) =>
            ["pull", "build", "run"].includes(argument),
          ),
      ),
    ).toBe(true);
  });

  it("rejects unsupported Node capabilities, absent images and Docker launch failures without exposing diagnostics", async () => {
    for (const failure of [
      "docker-platform",
      "image-platform",
      "image-arch",
      "missing-import-meta",
      "missing-image",
      "spawn-error",
      "spawn-throw",
    ] as const) {
      probeOutput = {
        platform: failure === "image-platform" ? "windows" : "linux",
        arch: failure === "image-arch" ? "arm64" : "x64",
        importMetaMain: failure !== "missing-import-meta",
      };
      vi.mocked(spawn)
        .mockClear()
        .mockImplementation((command, rawArgs) => {
          const args = rawArgs as string[];
          const operation = dockerOperation(args);
          if (failure === "spawn-throw" && operation === "info")
            throw new Error("private-secret from Docker launch");
          if (
            ((failure === "docker-platform" || failure === "spawn-error") &&
              operation === "info") ||
            (failure === "missing-image" && operation === "create")
          ) {
            const process = child();
            children.push(process);
            queueMicrotask(() => {
              if (failure === "spawn-error")
                process.process.emit(
                  "error",
                  new Error("private-secret Docker diagnostic"),
                );
              else
                process.complete(
                  failure === "docker-platform"
                    ? "windows"
                    : "private-secret missing image",
                  failure === "missing-image" ? 1 : 0,
                );
            });
            return process.process as unknown as ChildProcess;
          }
          return mockDocker(command, args);
        });
      const result = await settled(checkScriptSandbox(context));
      expect(result.error).toMatchObject({ code: "capability_missing" });
      expect((result.error as Error).message).not.toContain("private-secret");
      if (["docker-platform", "spawn-error", "spawn-throw"].includes(failure))
        expect(runCalls()).toHaveLength(0);
    }
  });

  it("preserves cancellation before and during preflight and stops only its owned probe process", async () => {
    const abort = new AbortController();
    abort.abort(new DOMException("Cancelled before preflight", "AbortError"));
    await expect(
      checkScriptSandbox(withAbortSignal(abort.signal, context)),
    ).rejects.toBe(abort.signal.reason);
    expect(spawn).not.toHaveBeenCalled();
    const probe = child();
    children.push(probe);
    vi.mocked(spawn).mockReturnValueOnce(
      probe.process as unknown as ChildProcess,
    );
    const pending = new AbortController();
    const running = settled(
      checkScriptSandbox(withAbortSignal(pending.signal, context)),
    );
    pending.abort(new DOMException("Cancelled during preflight", "AbortError"));
    expect((await running).error).toBe(pending.signal.reason);
    expect(probe.process.kill).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("shares one five-second deadline across info, creation and the Node probe", async () => {
    vi.useFakeTimers();
    const info = child();
    const probe = child();
    children.push(info, probe);
    const executing = deferred<void>();
    vi.mocked(spawn).mockImplementation((command, rawArgs) => {
      const args = rawArgs as string[];
      if (dockerOperation(args) === "info")
        return info.process as unknown as ChildProcess;
      if (dockerOperation(args) === "start") {
        executing.resolve();
        return probe.process as unknown as ChildProcess;
      }
      return mockDocker(command, args);
    });
    const running = settled(checkScriptSandbox(context));
    await vi.advanceTimersByTimeAsync(4000);
    info.complete("linux");
    await executing.promise;
    await vi.advanceTimersByTimeAsync(999);
    expect(probe.process.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await running).error).toMatchObject({ code: "capability_missing" });
    expect(probe.process.kill).toHaveBeenCalledOnce();
    expect(info.process.kill).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(spawn)
        .mock.calls.some(
          ([, args]) => dockerOperation(args as string[]) === "rm",
        ),
    ).toBe(true);
  });
});

describe("Docker ownership regressions", () => {
  it("proves Node capabilities inside the pinned sandbox instead of trusting OCI index platform fields", async () => {
    await checkScriptSandbox(context);
    const configuration = vi
      .mocked(spawn)
      .mock.calls.find(
        ([, args]) => dockerOperation(args as string[]) === "create",
      )?.[1] as string[] | undefined;
    if (!configuration) throw new Error("Missing trusted Node sandbox probe");
    expect(configuration.join(" ")).toMatch(/node@sha256:[a-f0-9]{64}/);
    expect(configuration.join(" ")).toContain("import.meta.main");
    expect(option(configuration, "--network")).toBe("none");
    expect(option(configuration, "--pull")).toBe("never");
    expect(option(configuration, "--user")).not.toMatch(/^(root|0)(:|$)/);
    expect(configuration).toContain("--read-only");
    expect(
      configuration.some((argument) =>
        ["--mount", "--volume", "-v", "--privileged"].includes(argument),
      ),
    ).toBe(false);
    expect(
      vi
        .mocked(spawn)
        .mock.calls.some(([, args]) => (args as string[])[0] === "image"),
    ).toBe(false);
  });
  it("does not treat a failed cleanup query as proof that the container is absent", async () => {
    const test = await setup();
    vi.mocked(spawn).mockImplementation((_command, rawArgs) => {
      const args = rawArgs as string[];
      const process = child();
      children.push(process);
      queueMicrotask(() =>
        process.complete(
          args.some((argument) => ["run", "create", "start"].includes(argument))
            ? JSON.stringify(output)
            : "private-secret query failure",
          args.some((argument) => ["run", "create", "start"].includes(argument))
            ? 0
            : 1,
        ),
      );
      return process.process as unknown as ChildProcess;
    });
    const result = await settled(test.runner.run(input, context));
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).not.toContain("private-secret");
    expect(
      vi
        .mocked(spawn)
        .mock.calls.some(([, args]) =>
          (args as string[]).some((argument) =>
            ["run", "create", "start"].includes(argument),
          ),
        ),
    ).toBe(false);
    expect(await test.artifacts.list(17)).toEqual([]);
  });

  it("never starts work when a successful create acknowledgement arrives after cancellation", async () => {
    const test = await setup();
    const creating = deferred<{
      process: ReturnType<typeof child>;
      args: readonly string[];
    }>();
    vi.mocked(spawn).mockImplementation((command, rawArgs) => {
      const args = rawArgs as string[];
      if (dockerOperation(args) !== "create") return mockDocker(command, args);
      const process = child();
      children.push(process);
      process.process.kill.mockImplementation(() => true);
      creating.resolve({ process, args });
      return process.process as unknown as ChildProcess;
    });
    const abort = new AbortController();
    const running = settled(
      test.runner.run(input, withAbortSignal(abort.signal, context)),
    );
    const created = await creating.promise;
    const name = option(created.args, "--name");
    if (!name) throw new Error("Missing owned container name");
    const label =
      created.args
        .find((value) => value.startsWith("ai.hexly.frogie.owner="))
        ?.slice("ai.hexly.frogie.owner=".length) ?? "";
    try {
      expect(created.args).not.toContain("run");
      abort.abort(
        new DOMException("Cancel before create acknowledgement", "AbortError"),
      );
      containers.set(name, { args: created.args, label });
      created.process.complete(name);
      expect((await running).error).toBe(abort.signal.reason);
      expect(runCalls()).toHaveLength(0);
      expect(
        vi
          .mocked(spawn)
          .mock.calls.some(
            ([, args]) =>
              dockerOperation(args as string[]) === "rm" &&
              (args as string[]).at(-1) === name,
          ),
      ).toBe(true);
      expect(await test.artifacts.list(17)).toEqual([]);
    } finally {
      if (!abort.signal.aborted)
        abort.abort(new DOMException("Cleanup cancelled test", "AbortError"));
      created.process.complete(name);
      await running;
    }
  });
});

describe("script execution boundary", () => {
  it("executes only the fixed safe Docker workload and persists original JSON stdout and receipt", async () => {
    const test = await setup();
    const process = workload();
    const running = settled(test.runner.run(input, context));
    const args = await process.entered.promise;
    expect(runCalls()[0]?.[0]).toBe("docker");
    expect(dockerOperation(args)).toBe("create");
    expect(args).toContain("--read-only");
    expect(option(args, "--network")).toBe("none");
    expect(option(args, "--cap-drop")).toBe("ALL");
    expect(option(args, "--security-opt")).toMatch(
      /^no-new-privileges(?::true)?$/,
    );
    expect(option(args, "--cpus")).toBe("1");
    expect(option(args, "--memory")).toMatch(/^(256m|268435456)$/i);
    expect(option(args, "--pids-limit")).toBe("64");
    expect(option(args, "--pull")).toBe("never");
    expect(option(args, "--user")).not.toMatch(/^(root|0)(:|$)/);
    expect(args.join(" ")).toMatch(/node[^\s]*@sha256:[a-f0-9]{64}/);
    expect(option(args, "--tmpfs")).toMatch(/\/work:.*size=(16m|16777216)/i);
    const mount =
      option(args, "--mount") ?? option(args, "--volume") ?? option(args, "-v");
    expect(mount).toContain(
      join(definitionDirectory, "skills", "resource-budget"),
    );
    expect(mount).toMatch(/readonly|:ro(?:,|$)/);
    expect(args.join(" ")).not.toContain("docker.sock");
    expect(args.join(" ")).not.toContain("--privileged");
    const stdout = `${JSON.stringify(output)}\n`;
    process.complete(stdout);
    const { value: result, error } = await running;
    expect(error).toBeUndefined();
    if (!result) throw new Error("Missing script result");
    expect(JSON.parse(process.stdin())).toEqual(input.input);
    expect(result.output).toEqual(output);
    expect(result.artifact).toMatchObject({
      scope,
      conversationId: 17,
      taskId: 23,
      mediaType: "application/json",
      byteLength: Buffer.byteLength(stdout),
    });
    expect((await test.artifacts.read(result.artifact.id, 17)).content).toBe(
      stdout,
    );
    expect(await test.runner.run(input, context)).toEqual(result);
    expect(runCalls()).toHaveLength(1);
    await expect(
      test.runner.run({ ...input, input: { budgets: [] } }, context),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("checks role, Workflow, version approval and replay before spawning or reusing a receipt", async () => {
    const test = await setup();
    const process = workload();
    const running = test.runner.run(input, context);
    await process.entered.promise;
    process.complete(JSON.stringify(output));
    await running;
    for (const candidate of [
      { ...input, roleId: "navigation" },
      { ...input, roleId: "missing-role" },
      { ...input, workflowId: "missing-workflow" },
      { ...input, skillId: "missing-skill" },
      { ...input, scriptId: "missing-script" },
    ])
      await expect(test.runner.run(candidate, context)).rejects.toThrow();
    await expect(
      createScriptRunner({ ...test, approvedScripts: [] }).run(input, context),
    ).rejects.toThrow();
    const workflow = test.definition.workflows[0];
    if (!workflow) throw new Error("Missing Workflow");
    workflow.scripts = [];
    await expect(
      test.runner.run({ ...input, workflowId: workflow.id }, context),
    ).rejects.toThrow();
    const script = test.definition.skills.find(
      (skill) => skill.id === input.skillId,
    )?.scripts[0];
    if (!script) throw new Error("Missing script");
    Reflect.set(script, "replay", "unsafe");
    await expect(test.runner.run(input, context)).rejects.toThrow();
    expect(runCalls()).toHaveLength(1);
  });

  it.each(["exit", "json", "output", "spawn"] as const)(
    "does not publish a successful artifact for %s failure and permits a safe retry",
    async (failure) => {
      const test = await setup();
      const process = workload();
      const running = settled(test.runner.run(input, context));
      await process.entered.promise;
      if (failure === "exit") process.complete("Private diagnostic", 1);
      if (failure === "json") process.complete("not JSON");
      if (failure === "output") process.complete("x".repeat(1_048_577));
      if (failure === "spawn")
        process.process.emit("error", new Error("Docker unavailable"));
      expect((await running).error).toBeInstanceOf(Error);
      expect(await test.artifacts.list(17)).toEqual([]);
      const retry = workload();
      const second = test.runner.run(input, context);
      await retry.entered.promise;
      retry.complete(JSON.stringify(output));
      expect((await second).output).toEqual(output);
    },
  );

  it("preserves AbortError and cleans only the owned container during cancellation", async () => {
    const test = await setup();
    const initial = new AbortController();
    initial.abort(new DOMException("Cancelled", "AbortError"));
    await expect(
      test.runner.run(input, withAbortSignal(initial.signal, context)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(spawn).not.toHaveBeenCalled();
    const process = workload();
    const abort = new AbortController();
    const running = settled(
      test.runner.run(input, withAbortSignal(abort.signal, context)),
    );
    const args = await process.entered.promise;
    abort.abort(new DOMException("Cancelled", "AbortError"));
    expect((await running).error).toMatchObject({ name: "AbortError" });
    const name = option(args, "--name");
    const calls = vi
      .mocked(spawn)
      .mock.calls.map(([, args]) => args as string[]);
    const removals = calls.filter((args) => dockerOperation(args) === "rm");
    expect(removals).toHaveLength(1);
    expect(removals.every((args) => args.at(-1) === name)).toBe(true);
    const query = calls.find((args) => dockerOperation(args) === "ls");
    expect(query).toContain("--all");
    expect(query).toContain(`name=^/${name}$`);
    expect(option(query ?? [], "--format")).toBe("{{.Names}}");
    const inspectIndex = calls.findIndex(
      (args) => dockerOperation(args) === "inspect",
    );
    const removeIndex = calls.findIndex(
      (args) => dockerOperation(args) === "rm",
    );
    expect(inspectIndex).toBeGreaterThanOrEqual(0);
    expect(removeIndex).toBeGreaterThan(inspectIndex);
    expect(await test.artifacts.list(17)).toEqual([]);
  });

  it("rejects an owned-container name collision whose actual owner label does not match", async () => {
    const test = await setup();
    vi.mocked(spawn).mockImplementation((command, rawArgs) => {
      const args = rawArgs as string[];
      if (dockerOperation(args) !== "ls") return mockDocker(command, args);
      const filter = option(args, "--filter");
      expect(filter).toMatch(/^name=\^.*\$$/);
      const name = filter?.replace(/^name=\^\/?/, "").replace(/\$$/, "") ?? "";
      containers.set(name, { args: [], label: "unrelated-owner-label" });
      return mockDocker(command, args);
    });
    await expect(test.runner.run(input, context)).rejects.toMatchObject({
      code: "binding_mismatch",
    });
    expect(runCalls()).toEqual([]);
    expect(
      vi
        .mocked(spawn)
        .mock.calls.some(([, args]) => (args as string[]).includes("rm")),
    ).toBe(false);
    expect(await test.artifacts.list(17)).toEqual([]);
  });

  it("refuses a cleanup listing for a different exact-name identity without inspecting or deleting it", async () => {
    const test = await setup();
    vi.mocked(spawn).mockImplementationOnce((_command, rawArgs) => {
      expect(dockerOperation(rawArgs as string[])).toBe("ls");
      const process = child();
      children.push(process);
      queueMicrotask(() => process.complete("unrelated-container-name"));
      return process.process as unknown as ChildProcess;
    });
    await expect(test.runner.run(input, context)).rejects.toMatchObject({
      code: "binding_mismatch",
    });
    expect(vi.mocked(spawn).mock.calls).toHaveLength(1);
    expect(await test.artifacts.list(17)).toEqual([]);
  });

  it("does not start work if create acknowledgement is invalid or the create client fails synchronously", async () => {
    const test = await setup();
    for (const failure of ["acknowledgement", "spawn"] as const) {
      vi.mocked(spawn)
        .mockClear()
        .mockImplementation((command, rawArgs) => {
          const args = rawArgs as string[];
          if (dockerOperation(args) !== "create")
            return mockDocker(command, args);
          if (failure === "spawn")
            throw new Error("private-secret creating container");
          const process = child();
          children.push(process);
          queueMicrotask(() => process.complete("invalid/container/ack"));
          return process.process as unknown as ChildProcess;
        });
      const result = await settled(test.runner.run(input, context));
      expect(result.error).toMatchObject({ code: "runtime_unavailable" });
      expect((result.error as Error).message).not.toContain("private-secret");
      expect(runCalls()).toHaveLength(0);
      expect(await test.artifacts.list(17)).toEqual([]);
    }
  });

  it("bounds a cancelled create client that never closes even if killing it throws, and ignores late output", async () => {
    const test = await setup();
    vi.useFakeTimers();
    const entered = deferred<ReturnType<typeof child>>();
    vi.mocked(spawn).mockImplementation((command, rawArgs) => {
      if (dockerOperation(rawArgs as string[]) !== "create")
        return mockDocker(command, rawArgs as string[]);
      const process = child();
      children.push(process);
      process.process.kill.mockImplementation(() => {
        throw new Error("Cannot kill owned client");
      });
      entered.resolve(process);
      return process.process as unknown as ChildProcess;
    });
    const abort = new AbortController();
    const running = settled(
      test.runner.run(input, withAbortSignal(abort.signal, context)),
    );
    const creating = await entered.promise;
    abort.abort(new DOMException("Cancelled unconfirmed create", "AbortError"));
    creating.process.stdout.write("late-created-name");
    creating.process.stderr.write("late private-secret");
    await vi.advanceTimersByTimeAsync(1000);
    expect((await running).error).toBe(abort.signal.reason);
    creating.complete("late-created-name");
    expect(runCalls()).toHaveLength(0);
    expect(await test.artifacts.list(17)).toEqual([]);
  });

  it("checks frozen script bytes and symbolic link resources before returning a saved receipt", async () => {
    const test = await setup();
    const process = workload();
    const running = test.runner.run(input, context);
    await process.entered.promise;
    process.complete(JSON.stringify(output));
    await running;
    const entry = join(
      definitionDirectory,
      "skills",
      "resource-budget",
      "scripts",
      "calculate.mjs",
    );
    const original = await readFile(entry, "utf8");
    await writeFile(entry, `${original}\nexport const changed = true;\n`);
    await expect(test.runner.run(input, context)).rejects.toMatchObject({
      code: "binding_mismatch",
    });
    await writeFile(entry, original);
    const outside = join(root, "outside-script.mjs");
    await writeFile(outside, original);
    await rm(entry);
    await symlink(outside, entry);
    await expect(test.runner.run(input, context)).rejects.toThrow();
    expect(runCalls()).toHaveLength(1);
    expect(await readFile(outside, "utf8")).toBe(original);
  });

  it.each(["stderr", "stdin", "stdin-write", "utf8"] as const)(
    "bounds %s failures and cleans its own workload without creating an artifact",
    async (failure) => {
      const test = await setup();
      const process = workload();
      if (failure === "stdin-write")
        vi.spyOn(process.process.stdin, "end").mockImplementation(() => {
          throw new Error("private-secret input write");
        });
      const running = settled(test.runner.run(input, context));
      await process.entered.promise;
      if (failure === "stderr")
        process.process.stderr.write("private-secret".repeat(100_000));
      if (failure === "stdin") {
        process.process.stdin.emit("error", new Error("private-secret"));
        process.complete(JSON.stringify(output));
      }
      if (failure === "utf8") process.complete(Buffer.from([0xff, 0xfe]));
      const error = (await running).error;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("private-secret");
      expect(await test.artifacts.list(17)).toEqual([]);
    },
  );

  it("deduplicates a live task, normalizes equivalent JSON and rejects invalid values before execution", async () => {
    const test = await setup();
    for (const value of [null, true, 3, "text", [1, null], { b: 2, a: 1 }])
      expect(JSON.parse(canonicalJSON(value))).toEqual(value);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    let deeplyNested: JsonValue = null;
    for (let depth = 0; depth < 66; depth++)
      deeplyNested = { nested: deeplyNested };
    for (const value of [
      NaN,
      Infinity,
      undefined,
      new Date(),
      cycle,
      Array(1),
      deeplyNested,
    ])
      await expect(
        test.runner.run({ ...input, input: value as JsonValue }, context),
      ).rejects.toMatchObject({ code: "invalid_request" });
    const process = workload();
    const first = test.runner.run(input, context);
    await process.entered.promise;
    const second = test.runner.run(
      { ...input, input: JSON.parse(JSON.stringify(input.input)) },
      context,
    );
    await expect(
      test.runner.run({ ...input, input: { budgets: [] } }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    process.complete(JSON.stringify(output));
    expect(await second).toEqual(await first);
    expect(runCalls()).toHaveLength(1);
    await expect(
      createScriptRunner({
        ...test,
        scope: { ...scope, projectId: "foreign" },
      }).run(input, context),
    ).rejects.toMatchObject({ code: "binding_mismatch" });
  });

  it.each([
    "ls-error",
    "ls-timeout",
    "ls-exit",
    "inspect-error",
    "inspect-timeout",
    "rm-error",
    "rm-timeout",
    "rm-exit",
  ] as const)(
    "bounds %s during cleanup without removing unrelated containers or publishing a result",
    async (failure) => {
      const test = await setup();
      const process = workload();
      const running = settled(test.runner.run(input, context));
      const args = await process.entered.promise;
      const operation = failure.startsWith("ls")
        ? "ls"
        : failure.startsWith("inspect")
          ? "inspect"
          : "rm";
      const entered = deferred<ReturnType<typeof child>>();
      managementEntered.set(operation, entered);
      managementFailure = failure;
      if (failure.endsWith("timeout")) vi.useFakeTimers();
      process.complete(JSON.stringify(output));
      const management = await entered.promise;
      if (failure.endsWith("timeout")) {
        await vi.runAllTimersAsync();
        expect(management.process.kill).toHaveBeenCalled();
      }
      const result = await running;
      expect(result.error).toMatchObject({ code: "runtime_unavailable" });
      expect((result.error as Error).message).not.toContain("private-secret");
      expect(await test.artifacts.list(17)).toEqual([]);
      const name = option(args, "--name");
      expect(
        vi
          .mocked(spawn)
          .mock.calls.filter(([, args]) => (args as string[]).includes("rm"))
          .every(([, args]) => (args as string[]).at(-1) === name),
      ).toBe(true);
    },
  );

  it("rejects a corrupt receipt instead of accepting changed output or artifact identity", async () => {
    const test = await setup();
    const process = workload();
    const running = test.runner.run(input, context);
    await process.entered.promise;
    process.complete(JSON.stringify(output));
    const result = await running;
    const directory = join(root, "scripts");
    let path: string | undefined;
    for (const file of await readdir(directory)) {
      const candidate = join(directory, file);
      try {
        if (
          JSON.parse(await readFile(candidate, "utf8")).artifact?.id ===
          result.artifact.id
        )
          path = candidate;
      } catch {}
    }
    if (!path) throw new Error("Missing persisted script receipt");
    const original = JSON.parse(await readFile(path, "utf8"));
    for (const record of [
      { ...original, artifact: { ...original.artifact, sha256: "tampered" } },
      { ...original, output: { result: "tampered" } },
    ]) {
      await writeFile(path, JSON.stringify(record));
      await expect(test.runner.run(input, context)).rejects.toMatchObject({
        code: "binding_mismatch",
      });
    }
    expect(runCalls()).toHaveLength(1);
  });

  it("enforces the thirty-second deadline without wall-clock sleeps", async () => {
    const test = await setup();
    vi.useFakeTimers();
    const process = workload();
    const running = settled(test.runner.run(input, context));
    await process.entered.promise;
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await running).error).toBeInstanceOf(Error);
    expect(process.process.kill).toHaveBeenCalled();
    expect(await test.artifacts.list(17)).toEqual([]);
  });
});
