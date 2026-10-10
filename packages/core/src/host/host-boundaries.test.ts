import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { Type } from "typebox";
import { afterEach, expect, it, vi } from "vitest";
import { loadDefinition } from "../definitions/index.js";
import {
  assistantMessage,
  createModelFixture,
  testHost,
  toolCall,
} from "../testing/index.js";
import {
  defineHostTool,
  type Host,
  type HostModels,
  type HostOptions,
  openAgentHost,
} from "./index.js";
import { getHostInternals } from "./internal.js";

interface State {
  events: string[];
}
const hosts: Host<State>[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.allSettled(hosts.splice(0).map((host) => host.close()));
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "frogie-host-boundary-"));
  directories.push(path);
  return path;
}
function setup() {
  const definition = loadDefinition("tests/fixtures/minimal-squad");
  const model = createModelFixture({
    provider: "boundary",
    models: [{ id: "agent", reasoning: true }],
    tokensPerSecond: 1000000,
  });
  const options: HostOptions<State> = {
    definition,
    runtimeId: "boundaries",
    scope: {
      projectId: definition.projectId,
      environmentId: "test",
      squadId: definition.squadId,
      harnessId: "boundaries",
    },
    models: model.models,
    roles: Object.fromEntries(
      definition.roles.map((role) => [
        role.id,
        {
          provider: "boundary",
          modelId: "agent",
          thinkingLevel: "low" as const,
        },
      ]),
    ),
    tools: [],
    state: { kind: "boundaries.state", initial: () => ({ events: [] }) },
  };
  return { options, model };
}
async function open(options: HostOptions<State>) {
  const host = await openAgentHost(options);
  hosts.push(host);
  return host;
}

it("rejects missing role selection, reserved state kind and foreign model handles before running", async () => {
  const { options } = setup();
  await expect(openAgentHost({ ...options, roles: {} })).rejects.toThrow(
    /Missing role selection/,
  );
  for (const kind of ["frogie.foreign", "pi.foreign"])
    await expect(
      openAgentHost({ ...options, state: { ...options.state, kind } }),
    ).rejects.toThrow(/reserved/);
  await expect(
    openAgentHost({ ...options, models: {} as HostModels }),
  ).rejects.toThrow(/Invalid host model handle/);
});

it("rejects duplicate tool registration", async () => {
  const { options } = setup();
  const tool = defineHostTool({
    name: "save",
    description: "Save",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => ({ content: [] }),
  });
  await expect(
    openAgentHost({ ...options, tools: [tool, tool] }),
  ).rejects.toThrow(/Duplicate host tool/);
});

it("keeps transactions atomic for foreign IDs and permits explicit exact role reconfiguration", async () => {
  const { options } = setup();
  const host = await open(options);
  expect((await testHost(host).agent(host.rootId)).tools).toEqual([]);
  await host.configure(host.rootId, { instructions: "Exact host instruction" });
  expect((await testHost(host).agent(host.rootId)).instructions).toBe(
    "Exact host instruction",
  );
  await host.transact(async (tx) => {
    await tx.configure(host.rootId, {
      thinkingLevel: "medium",
      instructions: "Transaction instruction",
    });
    (await tx.state()).events.push("configured");
  });
  expect(await testHost(host).agent(host.rootId)).toMatchObject({
    thinkingLevel: "medium",
    instructions: "Transaction instruction",
  });
  await expect(
    host.transact(async (tx) => {
      (await tx.state()).events.push("must roll back");
      await tx.configure(999, { instructions: "foreign" });
    }),
  ).rejects.toThrow(/does not belong/);
  expect((await host.snapshot()).events).toEqual(["configured"]);
  for (const id of [0, -1, 0.5, NaN, Infinity, 999])
    await expect(
      host.configure(id, { instructions: "foreign" }),
    ).rejects.toThrow();
  await host.cleanup(999);
  await host.close();
  await expect(host.resume()).rejects.toThrow(/closed/);
  await expect(host.transact(async () => undefined)).rejects.toThrow(/closed/);
});

it("coalesces an identical active request but rejects a competing request in that conversation", async () => {
  const { options, model } = setup();
  const host = await open(options);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  model.fake.setResponses([
    async () => {
      await gate;
      return assistantMessage("Shared result");
    },
  ]);
  const input = { content: "work", requestId: "same", timeoutMs: 3000 };
  const first = host.run(host.rootId, input);
  expect(host.run(host.rootId, { ...input })).toBe(first);
  await expect(
    host.run(host.rootId, { ...input, requestId: "other" }),
  ).rejects.toThrow(/busy/);
  await expect(
    host.run(host.rootId, { ...input, content: "different" }),
  ).rejects.toThrow(/busy/);
  release();
  expect(await first).toEqual({ status: "done", text: "Shared result" });
  expect(model.fake.state.callCount).toBe(1);
});

it("reopens queued SQLite work paused until explicit idempotent resume", async () => {
  const first = setup();
  first.options.databasePath = join(await directory(), "session.sqlite");
  const initial = await open(first.options);
  const internals = getHostInternals(initial);
  await internals.runtime.root.submit(
    { type: "input", content: "queued before shutdown", requestId: "queued" },
    internals.context,
  );
  expect(first.model.fake.state.callCount).toBe(0);
  await initial.close();
  const next = setup();
  next.options.databasePath = first.options.databasePath;
  next.model.fake.setResponses([assistantMessage("Recovered queue")]);
  const recovered = await open(next.options);
  expect(next.model.fake.state.callCount).toBe(0);
  await recovered.resume();
  await recovered.resume();
  await expect.poll(() => next.model.fake.state.callCount).toBe(1);
  expect(
    (
      await recovered.run(recovered.rootId, {
        content: "queued before shutdown",
        requestId: "queued",
        timeoutMs: 3000,
      })
    ).text,
  ).toBe("Recovered queue");
  expect(next.model.fake.state.callCount).toBe(1);
});

it("validates tool arguments before entering the implementation and supplies real execution context", async () => {
  const { options, model } = setup();
  const execute = vi.fn(
    async (
      args: { text: string },
      context: { conversationId: number; taskId: number; signal: AbortSignal },
    ) => {
      expect(context.conversationId).toBeGreaterThan(0);
      expect(context.taskId).toBeGreaterThan(0);
      expect(context.signal).toBeInstanceOf(AbortSignal);
      return { content: [{ type: "text" as const, text: args.text }] };
    },
  );
  options.tools = [
    defineHostTool({
      name: "record",
      description: "Record a string",
      parameters: Type.Object(
        { text: Type.String() },
        { additionalProperties: false },
      ),
      replay: "safe",
      execute,
    }),
  ];
  const role = options.definition.roles[0];
  if (!role) throw new Error("Fixture role missing");
  role.extensions = ["boundaries.tools"];
  role.tools = ["record"];
  const host = await open(options);
  model.fake.setResponses([
    assistantMessage([toolCall("record", {})], {
      stopReason: "toolUse",
    }),
    assistantMessage([toolCall("record", { text: "valid" })], {
      stopReason: "toolUse",
    }),
    assistantMessage("Corrected arguments"),
  ]);
  expect(
    (
      await host.run(host.rootId, {
        content: "record",
        requestId: "tools",
        timeoutMs: 3000,
      })
    ).status,
  ).toBe("done");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]?.[0]).toEqual({ text: "valid" });
});

it("times out native shell work, terminates its process and permits idempotent environment cleanup", async () => {
  const { options, model } = setup();
  const path = await directory();
  const pidFile = join(path, "child.pid");
  options.execution = { directory: path, shellEnv: { PATH: process.env.PATH } };
  const role = options.definition.roles[0];
  if (!role) throw new Error("Fixture role missing");
  role.extensions = ["coding-tools"];
  role.tools = ["bash"];
  const host = await open(options);
  const program = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`;
  const script = join(path, "long-running.cjs");
  await writeFile(script, program);
  model.fake.setResponses([
    assistantMessage(
      [
        toolCall("bash", {
          command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`,
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  const run = host.run(host.rootId, {
    content: "start bounded work",
    requestId: "timeout",
    timeoutMs: 1200,
  });
  await expect
    .poll(async () => readFile(pidFile, "utf8").catch(() => ""), {
      timeout: 1000,
    })
    .toMatch(/^\d+$/);
  const pid = Number(await readFile(pidFile, "utf8"));
  expect((await run).status).not.toBe("done");
  await host.cleanup(host.rootId);
  await host.cleanup(host.rootId);
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    })
    .toBe(true);
});

it("reports failed execution-directory creation without leaving a pending environment", async () => {
  const { options, model } = setup();
  const path = join(await directory(), "not-a-directory");
  await writeFile(path, "owned fixture");
  options.execution = { directory: path, shellEnv: {} };
  const role = options.definition.roles[0];
  if (!role) throw new Error("Fixture role missing");
  role.extensions = ["coding-tools"];
  role.tools = ["bash"];
  model.fake.setResponses([
    assistantMessage([toolCall("bash", { command: "echo should-not-run" })], {
      stopReason: "toolUse",
    }),
    assistantMessage("Directory failure noted"),
  ]);
  const host = await open(options);
  await host.run(host.rootId, {
    content: "test",
    requestId: "directory",
    timeoutMs: 3000,
  });
  expect(await readFile(path, "utf8")).toBe("owned fixture");
  await host.close();
});

it("releases startup storage when business state initialization throws", async () => {
  const { options } = setup();
  options.databasePath = join(await directory(), "startup.sqlite");
  const failure = new Error("business initializer failed");
  options.state.initial = () => {
    throw failure;
  };
  await expect(openAgentHost(options)).rejects.toThrow(failure);
  options.state.initial = () => ({ events: [] });
  const recovered = await open(options);
  expect(await recovered.snapshot()).toEqual({ events: [] });
});

it("returns one stable close failure while still cleaning execution environments", async () => {
  const { options, model } = setup();
  const path = await directory();
  options.execution = { directory: path, shellEnv: { PATH: process.env.PATH } };
  const role = options.definition.roles[0];
  if (!role) throw new Error("Fixture role missing");
  role.extensions = ["coding-tools"];
  role.tools = ["bash"];
  model.fake.setResponses([
    assistantMessage([toolCall("bash", { command: "printf first" })], {
      stopReason: "toolUse",
    }),
    assistantMessage([toolCall("bash", { command: "printf second" })], {
      stopReason: "toolUse",
    }),
    assistantMessage("Executed both commands"),
  ]);
  const host = await open(options);
  await host.run(host.rootId, {
    content: "test",
    requestId: "close",
    timeoutMs: 3000,
  });
  const runtime = getHostInternals(host).runtime;
  expect(
    await runtime.service.describe(
      {
        scope: options.scope,
        caller: { id: "host-owner" },
        input: {},
      },
      getHostInternals(host).context,
    ),
  ).toMatchObject({ runtimeId: "boundaries" });
  const originalClose = runtime.close.bind(runtime);
  const failure = new Error("storage close reported failure");
  vi.spyOn(runtime, "close").mockImplementation(async (context) => {
    await originalClose(context);
    throw failure;
  });
  const closing = host.close();
  expect(host.close()).toBe(closing);
  await expect(closing).rejects.toMatchObject({
    name: "AggregateError",
    errors: [failure],
  });
});

it("retains execution cleanup errors rather than reporting a successful shutdown", async () => {
  const { options, model } = setup();
  options.execution = {
    directory: await directory(),
    shellEnv: { PATH: process.env.PATH },
  };
  const role = options.definition.roles[0];
  if (!role) throw new Error("Fixture role missing");
  role.extensions = ["coding-tools"];
  role.tools = ["bash"];
  model.fake.setResponses([
    assistantMessage(
      [toolCall("bash", { command: "printf cleanup-fixture" })],
      { stopReason: "toolUse" },
    ),
    assistantMessage("Ready to close"),
  ]);
  const host = await open(options);
  await host.run(host.rootId, {
    content: "test",
    requestId: "cleanup-error",
    timeoutMs: 3000,
  });
  const original = NodeExecutionEnv.prototype.cleanup;
  const failure = new Error("execution cleanup failed");
  vi.spyOn(NodeExecutionEnv.prototype, "cleanup").mockImplementation(
    async function (this: NodeExecutionEnv, context) {
      await original.call(this, context);
      throw failure;
    },
  );
  await expect(host.close()).rejects.toMatchObject({
    name: "AggregateError",
    errors: [failure],
  });
});

it("aborts work explicitly and rejects fabricated diagnostic handles", async () => {
  const { options, model } = setup();
  const host = await open(options);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  model.fake.setResponses([
    async () => {
      await gate;
      return assistantMessage("late");
    },
  ]);
  const run = host.run(host.rootId, {
    content: "work",
    requestId: "abort",
    timeoutMs: 3000,
  });
  await expect.poll(() => model.fake.state.callCount).toBe(1);
  const aborting = host.abort(host.rootId);
  release();
  await aborting;
  expect((await run).status).not.toBe("done");
  expect(() => testHost({})).toThrow(/Invalid host handle/);
});
