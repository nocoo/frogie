import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
  Type,
} from "@earendil-works/pi-ai";
import {
  createRegistry,
  defineExtension,
  defineTask,
  defineTool,
  MemoryStorage,
  type TaskId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDefinition } from "../definitions/index.js";
import {
  configureRuntimeRole,
  openRuntime,
  type RuntimeHandle,
  type RuntimeOptions,
} from "./index.js";

const runtimes: RuntimeHandle[] = [];
const directories: string[] = [];

function setup(harnessId = "inspection-harness") {
  const definition = loadDefinition(
    fileURLToPath(
      new URL("../../../../tests/fixtures/minimal-squad", import.meta.url),
    ),
  );
  const faux = fauxProvider({
    provider: "fixture",
    models: [{ id: "test", reasoning: true }],
    tokensPerSecond: 1_000_000,
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const options: RuntimeOptions = {
    runtimeId: harnessId,
    definition,
    binding: {
      projectId: definition.projectId,
      scope: {
        projectId: definition.projectId,
        environmentId: "inspection",
        squadId: definition.squadId,
        harnessId,
      },
      definition: { contentHash: definition.contentHash },
      environment: {
        model: { provider: "fixture", modelId: "test" },
        thinkingLevel: "low",
      },
    },
    models,
    registry,
    storage: new MemoryStorage(),
    authorization: async () => true,
    resume: false,
  };
  return {
    options,
    faux,
    registry,
    call: {
      scope: options.binding.scope,
      caller: { id: "inspection-owner" },
      input: {},
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function open(options: RuntimeOptions) {
  const runtime = await openRuntime(options, context);
  runtimes.push(runtime);
  return runtime;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) await runtime.close(context);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("read-only runtime inspection", () => {
  it("returns native paused scheduling, TaskGraph and usage without resuming, committing or creating work", async () => {
    const test = setup();
    const runtime = await open(test.options);
    const graph = await runtime.harness.watchTaskGraph(context);
    const native = {
      scheduling: (await runtime.harness.inspect(context)).scheduling,
      graph: graph.value,
      usage: await runtime.harness.usage(context),
    };
    await graph.stop();
    const resume = vi.spyOn(runtime.harness, "resume");
    const commit = vi.spyOn(runtime.harness, "commit");
    const before = await test.options.storage.scanConversations(
      {},
      100,
      undefined,
      context,
    );
    expect(await runtime.service.inspect(test.call, context)).toEqual({
      scope: test.call.scope,
      ...native,
    });
    expect(
      await runtime.service.listEntries(
        { ...test.call, input: { conversationId: runtime.root.id } },
        context,
      ),
    ).toEqual({ items: [], cursor: null });
    expect(await runtime.service.listTasks(test.call, context)).toEqual({
      items: [],
      cursor: null,
    });
    expect(
      await runtime.service.getTask(
        { ...test.call, input: { taskId: 999 as TaskId } },
        context,
      ),
    ).toBeUndefined();
    expect(native.scheduling).toBe("paused");
    expect(resume).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(test.faux.state.callCount).toBe(0);
    expect(
      await test.options.storage.scanConversations({}, 100, undefined, context),
    ).toEqual(before);
  });

  it("applies full scope, caller authorization and conversation ownership before exposing any observation", async () => {
    const test = setup();
    let allowed = true;
    const runtime = await open({
      ...test.options,
      authorization: async () => allowed,
    });
    const call = test.call;
    for (const field of [
      "projectId",
      "environmentId",
      "squadId",
      "harnessId",
    ] as const) {
      const scope = { ...call.scope, [field]: "foreign" };
      for (const action of [
        () => runtime.service.inspect({ ...call, scope }, context),
        () =>
          runtime.service.listEntries(
            { ...call, scope, input: { conversationId: runtime.root.id } },
            context,
          ),
        () => runtime.service.listTasks({ ...call, scope }, context),
        () =>
          runtime.service.getTask(
            { ...call, scope, input: { taskId: 999 as TaskId } },
            context,
          ),
      ])
        await expect(action()).rejects.toMatchObject({
          code: "binding_mismatch",
        });
    }
    allowed = false;
    for (const action of [
      () => runtime.service.inspect(call, context),
      () =>
        runtime.service.listEntries(
          { ...call, input: { conversationId: runtime.root.id } },
          context,
        ),
      () => runtime.service.listTasks(call, context),
      () =>
        runtime.service.getTask(
          { ...call, input: { taskId: 999 as TaskId } },
          context,
        ),
    ])
      await expect(action()).rejects.toMatchObject({ code: "forbidden" });
    allowed = true;
    const unbound = await runtime.harness.createConversation(
      { ownership: { kind: "ownerless" } },
      context,
    );
    await expect(
      runtime.service.listEntries(
        { ...call, input: { conversationId: unbound.id } },
        context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      runtime.service.listTasks(
        { ...call, input: { conversationId: unbound.id } },
        context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("returns descending fork-aware public history with query-bound cursors and filters private entry payloads", async () => {
    const test = setup();
    const runtime = await open(test.options);
    const entries = await runtime.harness.commit(async (tx) => {
      const ids = [];
      for (let index = 0; index < 55; index++)
        ids.push(
          (
            await tx.appendEntry(runtime.root.id, {
              kind: "fixture.user",
              model: [
                {
                  role: "user",
                  content: `Public entry ${index}`,
                  timestamp: 1,
                },
              ],
              data: { private: "private-entry-data" },
            })
          ).id,
        );
      await tx.appendEntry(runtime.root.id, {
        kind: "fixture.system",
        model: [
          {
            role: "system",
            content: "private-system-instructions",
            timestamp: 1,
          },
        ],
      });
      await tx.appendEntry(runtime.root.id, {
        kind: "fixture.assistant",
        model: [
          fauxAssistantMessage([
            fauxThinking("private-thinking"),
            { type: "text", text: "Public assistant body" },
            fauxToolCall(
              "public_tool",
              { input: "public-arguments" },
              { id: "call-1" },
            ),
          ]),
        ],
        data: { secret: "private-entry-data" },
      });
      await tx.appendEntry(runtime.root.id, {
        kind: "fixture.tool",
        model: [
          {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "public_tool",
            content: [{ type: "text", text: "Public tool output" }],
            isError: false,
            details: { public: "tool-details" },
            timestamp: 1,
          },
        ],
        data: { secret: "private-entry-data" },
      });
      return ids;
    }, context);
    const first = await runtime.service.listEntries(
      { ...test.call, input: { conversationId: runtime.root.id } },
      context,
    );
    expect(first.items.length).toBeLessThanOrEqual(50);
    expect(first.cursor).toEqual(expect.any(String));
    const second = await runtime.service.listEntries(
      {
        ...test.call,
        input: { conversationId: runtime.root.id, cursor: first.cursor ?? "" },
      },
      context,
    );
    expect(second.cursor).toBeNull();
    const page = [...first.items, ...second.items];
    expect(new Set(page.map((entry) => entry.id)).size).toBe(page.length);
    expect(page.map((entry) => entry.id)).toEqual(
      page.map((entry) => entry.id).sort((a, b) => b - a),
    );
    expect(JSON.stringify(page)).toContain("Public assistant body");
    expect(JSON.stringify(page)).toContain("public-arguments");
    expect(JSON.stringify(page)).toContain("Public tool output");
    expect(JSON.stringify(page)).toContain("tool-details");
    expect(JSON.stringify(page)).not.toMatch(
      /private-entry-data|private-system-instructions|private-thinking/,
    );
    expect(page.every((entry) => !("data" in entry))).toBe(true);
    const at = entries[20];
    if (at === undefined) throw new Error("Missing fork point");
    const fork = await runtime.harness.commit(async (tx) => {
      const fork = await tx.forkConversation(runtime.root.id, at, {
        ownership: { kind: "ownerless" },
      });
      await configureRuntimeRole(tx, test.options, fork.id, "command");
      await tx.appendEntry(fork.id, {
        kind: "fixture.user",
        model: [{ role: "user", content: "Fork-only entry", timestamp: 1 }],
      });
      return fork.id;
    }, context);
    const inherited = await runtime.service.listEntries(
      { ...test.call, input: { conversationId: fork, limit: 100 } },
      context,
    );
    expect(JSON.stringify(inherited)).toContain("Public entry 20");
    expect(JSON.stringify(inherited)).not.toContain("Public entry 21");
    expect(JSON.stringify(inherited)).toContain("Fork-only entry");
    expect(
      inherited.items.some(
        (entry) => entry.id === at && entry.conversationId === runtime.root.id,
      ),
    ).toBe(true);
    await expect(
      runtime.service.listEntries(
        {
          ...test.call,
          input: { conversationId: fork, cursor: first.cursor ?? "" },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    for (const limit of [0, 101, 1.5])
      await expect(
        runtime.service.listEntries(
          { ...test.call, input: { conversationId: runtime.root.id, limit } },
          context,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("bounds UTF-8 history pages and rejects a single oversized public entry explicitly", async () => {
    const test = setup();
    const runtime = await open(test.options);
    await runtime.harness.commit(async (tx) => {
      for (let index = 0; index < 3; index++)
        await tx.appendEntry(runtime.root.id, {
          kind: "fixture.large",
          model: [
            { role: "user", content: "😀".repeat(100_000), timestamp: 1 },
          ],
        });
    }, context);
    const page = await runtime.service.listEntries(
      { ...test.call, input: { conversationId: runtime.root.id, limit: 100 } },
      context,
    );
    expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThanOrEqual(
      1_048_576,
    );
    expect(page.items.length).toBeLessThan(3);
    expect(page.cursor).toEqual(expect.any(String));
    await runtime.harness.commit(
      (tx) =>
        tx.appendEntry(runtime.root.id, {
          kind: "fixture.huge",
          model: [
            { role: "user", content: "😀".repeat(262_144), timestamp: 1 },
          ],
        }),
      context,
    );
    await expect(
      runtime.service.listEntries(
        { ...test.call, input: { conversationId: runtime.root.id } },
        context,
      ),
    ).rejects.toMatchObject({ code: "output_limit" });
  });

  it("includes terminal tasks in paginated read-only projections but never exposes raw inputs or checkpoint state", async () => {
    const test = setup();
    const task = defineTask<
      { secret: string },
      { phase: "ready"; secret: string },
      string
    >({
      name: "fixture.inspect-task",
      version: 1,
      initial: (input) => ({ phase: "ready", secret: input.secret }),
      phases: {
        ready: async (_task, api, context) =>
          api.commit(
            () => ({
              status: "terminal",
              outcome: { status: "completed", result: "private-task-result" },
            }),
            context,
          ),
      },
      abort: async (_task, api, context) =>
        api.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          context,
        ),
    });
    test.registry.install(
      defineExtension({ name: "fixture.tasks", tasks: [task] }),
    );
    const runtime = await open(test.options);
    const ids = await runtime.harness.commit(async (tx) => {
      const ids = [];
      for (let index = 0; index < 55; index++)
        ids.push(
          await tx.createTask(
            task,
            { secret: "private-task-input" },
            {
              ownership: { kind: "conversation" },
              conversationId: runtime.root.id,
            },
          ),
        );
      return ids;
    }, context);
    const first = await runtime.service.listTasks(test.call, context);
    expect(first.items).toHaveLength(50);
    expect(first.cursor).toEqual(expect.any(String));
    const rest = await runtime.service.listTasks(
      { ...test.call, input: { cursor: first.cursor ?? "" } },
      context,
    );
    expect(rest.items).toHaveLength(5);
    expect(rest.cursor).toBeNull();
    expect(
      new Set([...first.items, ...rest.items].map((task) => task.id)).size,
    ).toBe(55);
    expect((await runtime.harness.inspect(context)).scheduling).toBe("paused");
    const id = ids[0];
    if (id === undefined) throw new Error("Missing real task");
    runtime.harness.resume();
    await runtime.harness.waitForTask(id, context);
    const projected = await runtime.service.getTask(
      { ...test.call, input: { taskId: id } },
      context,
    );
    expect(projected).toMatchObject({
      id,
      conversationId: runtime.root.id,
      state: { status: "terminal", outcome: "completed" },
    });
    expect(projected).not.toHaveProperty("input");
    expect(projected).not.toHaveProperty("memos");
    expect(projected?.state).not.toHaveProperty("checkpoint");
    expect(JSON.stringify(projected)).not.toMatch(
      /private-task-input|private-task-result/,
    );
    expect(
      (await runtime.service.listTasks(test.call, context)).items.some(
        (task) => task.state.status === "terminal",
      ),
    ).toBe(true);
    const foreign = await runtime.harness.createConversation(
      { ownership: { kind: "ownerless" } },
      context,
    );
    const foreignTask = await runtime.harness.commit(
      (tx) =>
        tx.createTask(
          task,
          { secret: "private-foreign" },
          { ownership: { kind: "conversation" }, conversationId: foreign.id },
        ),
      context,
    );
    await expect(
      runtime.service.getTask(
        { ...test.call, input: { taskId: foreignTask } },
        context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    const tasks = await runtime.service.listTasks(test.call, context);
    expect(
      tasks.items.every((task) => task.conversationId !== foreign.id),
    ).toBe(true);
    await expect(
      runtime.service.listTasks(
        {
          ...test.call,
          input: {
            conversationId: runtime.root.id,
            cursor: first.cursor ?? "",
          },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    for (const limit of [0, 101, 1.5])
      await expect(
        runtime.service.listTasks({ ...test.call, input: { limit } }, context),
      ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("projects live parent-child tool work from real Pi and preserves public history after SQLite reopen", async () => {
    const test = setup();
    const directory = await mkdtemp(
      join(tmpdir(), "frogie-inspection-sqlite-"),
    );
    directories.push(directory);
    const entered = deferred<void>();
    const release = deferred<void>();
    const tool = defineTool({
      name: "delegate_fixture",
      description: "Create a real owned child",
      parameters: Type.Object({ target: Type.String() }),
      replay: "safe",
      execute: async (args, api, callContext) => {
        await api.memo("private-memo", "private-task-memo", callContext);
        const childId = await api.commit(async (tx) => {
          const child = await tx.createConversation({
            ownership: { kind: "task", taskId: api.taskId },
          });
          await configureRuntimeRole(tx, test.options, child.id, "reviewer");
          return child.id;
        }, callContext);
        await api.details(
          { childConversationId: childId, public: "tool-progress" },
          callContext,
        );
        const child = await api.conversation(childId, callContext);
        if (!child) throw new Error("Missing owned child");
        const submission = await child.submit(
          { type: "input", content: "Child public request" },
          callContext,
        );
        entered.resolve();
        await release.promise;
        await submission.wait(callContext);
        return {
          content: [
            { type: "text", text: `Public tool result ${args.target}` },
          ],
          details: { public: "tool-details" },
        };
      },
    });
    test.registry.install(
      defineExtension({ name: "fixture.tools", tools: [tool] }),
    );
    test.options.definition.roles = test.options.definition.roles.map(
      (role) => ({
        ...role,
        extensions: ["fixture.tools"],
        tools: role.id === "command" ? ["delegate_fixture"] : [],
      }),
    );
    const modelReply = (
      transcript: Parameters<
        import("@earendil-works/pi-ai").FauxResponseFactory
      >[0],
    ) => {
      test.faux.appendResponses([modelReply]);
      if (JSON.stringify(transcript.messages).includes("Child public request"))
        return fauxAssistantMessage("Child public answer");
      return transcript.messages.some(
        (message) => message.role === "toolResult",
      )
        ? fauxAssistantMessage("Parent public answer")
        : fauxAssistantMessage(
            fauxToolCall("delegate_fixture", {
              target: "public-tool-arguments",
            }),
            { stopReason: "toolUse" },
          );
    };
    test.faux.setResponses([modelReply]);
    const path = join(directory, "session.sqlite");
    const runtime = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(path),
    });
    const submission = await runtime.service.submit(
      {
        ...test.call,
        input: {
          conversationId: runtime.root.id,
          submission: { type: "input", content: "Parent public request" },
        },
      },
      context,
    );
    try {
      await entered.promise;
      const graph = await runtime.harness.watchTaskGraph(context);
      const native = graph.value;
      await graph.stop();
      const inspection = await runtime.service.inspect(test.call, context);
      expect(inspection.graph).toEqual(native);
      expect(Object.keys(native.tasks).length).toBeGreaterThan(0);
      const tasks = await runtime.service.listTasks(test.call, context);
      expect(
        tasks.items.some(
          (task) =>
            task.tool?.name === "delegate_fixture" &&
            task.tool.argumentsSource === "execution",
        ),
      ).toBe(true);
      expect(JSON.stringify(tasks)).toContain("public-tool-arguments");
      expect(JSON.stringify(tasks)).toContain("tool-progress");
      expect(JSON.stringify(tasks)).not.toMatch(
        /private-task-memo|checkpoint|error\.stack/,
      );
    } finally {
      release.resolve();
    }
    expect(
      (
        await (
          await runtime.harness.submission(submission, context)
        )?.wait(context)
      )?.status,
    ).toBe("done");
    const entries = await runtime.service.listEntries(
      { ...test.call, input: { conversationId: runtime.root.id } },
      context,
    );
    const tasks = await runtime.service.listTasks(test.call, context);
    expect(
      tasks.items.find((task) => task.tool?.name === "delegate_fixture")?.tool
        ?.argumentsSource,
    ).toBe("requested");
    expect(JSON.stringify(entries)).toContain("Parent public answer");
    expect(JSON.stringify(entries)).toContain("Public tool result");
    const usage = await runtime.harness.usage(context);
    expect((await runtime.service.inspect(test.call, context)).usage).toEqual(
      usage,
    );
    await runtime.close(context);
    const reopened = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(path),
    });
    expect(reopened.root.id).toBe(runtime.root.id);
    expect(
      await reopened.service.listEntries(
        { ...test.call, input: { conversationId: reopened.root.id } },
        context,
      ),
    ).toEqual(entries);
    expect(await reopened.service.listTasks(test.call, context)).toEqual(tasks);
    expect(
      (await reopened.service.inspect(test.call, context)).scheduling,
    ).toBe("paused");
  });

  it("rejects malformed cursors and invalid task IDs while preserving passive and head-marked public history", async () => {
    const test = setup();
    const runtime = await open(test.options);
    const first = await runtime.harness.commit(async (tx) => {
      const entry = await tx.appendEntry(runtime.root.id, {
        kind: "fixture.passive",
        data: { private: "not-public" },
      });
      await tx.appendEntry(runtime.root.id, {
        kind: "fixture.head",
        head: entry.id,
        model: [
          {
            role: "user",
            content: [{ type: "text", text: "Public block" }],
            timestamp: 1,
          },
        ],
      });
      return entry;
    }, context);
    const result = await runtime.service.listEntries(
      { ...test.call, input: { conversationId: runtime.root.id } },
      context,
    );
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "fixture.passive", messages: [] }),
        expect.objectContaining({ kind: "fixture.head", head: first.id }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("not-public");
    for (const cursor of [
      "",
      "!bad",
      "x".repeat(4097),
      "eA",
      Buffer.from(JSON.stringify({ version: 2 })).toString("base64url"),
    ])
      await expect(
        runtime.service.listEntries(
          { ...test.call, input: { conversationId: runtime.root.id, cursor } },
          context,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
    for (const taskId of [0, -1, 1.5])
      await expect(
        runtime.service.getTask(
          { ...test.call, input: { taskId: taskId as TaskId } },
          context,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("fails closed when a persisted native tool record or its public result association is inconsistent", async () => {
    const test = setup();
    const tool = defineTool({
      name: "fixture_tool",
      description: "Public tool",
      parameters: Type.Object({ value: Type.String() }),
      execute: async () => ({
        content: [{ type: "text", text: "Public output" }],
        details: { public: true },
      }),
    });
    test.registry.install(
      defineExtension({ name: "fixture.tools", tools: [tool] }),
    );
    test.options.definition.roles = test.options.definition.roles.map(
      (role) => ({
        ...role,
        extensions: ["fixture.tools"],
        tools: ["fixture_tool"],
      }),
    );
    test.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("fixture_tool", { value: "Public input" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Done"),
    ]);
    const runtime = await open(test.options);
    const submission = await runtime.service.submit(
      {
        ...test.call,
        input: {
          conversationId: runtime.root.id,
          submission: { type: "input", content: "Inspect persisted tool" },
        },
      },
      context,
    );
    await (await runtime.harness.submission(submission, context))?.wait(
      context,
    );
    const records = await test.options.storage.scanTasks(
      { kind: "pi.tool" },
      10,
      undefined,
      context,
    );
    const native = records.items[0];
    if (native?.state.status !== "terminal")
      throw new Error("Missing terminal native tool");
    const original = await runtime.harness.getTask(native.id, context);
    const getTask = vi.spyOn(runtime.harness, "getTask");
    for (const record of [
      { ...native, input: {} },
      { ...native, input: { ...(native.input as object), assistant: 999999 } },
      {
        ...native,
        input: { ...(native.input as object), callId: "wrong-call" },
      },
      {
        ...native,
        state: {
          status: "running",
          checkpoint: { phase: "execute", arguments: [] },
        },
      },
      {
        ...native,
        state: {
          status: "terminal",
          outcome: { status: "completed", result: { entryId: 1.5 } },
        },
      },
      {
        ...native,
        state: {
          status: "terminal",
          outcome: { status: "completed", result: { entryId: 999999 } },
        },
      },
    ]) {
      getTask.mockResolvedValueOnce(record as typeof original);
      await expect(
        runtime.service.getTask(
          { ...test.call, input: { taskId: native.id } },
          context,
        ),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
    }
    const resultId = (native.state.outcome.result as { entryId: number })
      .entryId;
    const result = await test.options.storage.entry(resultId as never, context);
    if (!result) throw new Error("Missing original tool result entry");
    for (const fault of ["task-owner", "tool-call"] as const) {
      const id =
        fault === "task-owner"
          ? resultId
          : await runtime.harness.commit(async (tx) => {
              const modified = await tx.appendEntry(runtime.root.id, {
                kind: result.entry.kind,
                model: (result.entry.model ?? []).map((message) =>
                  message.role === "toolResult"
                    ? { ...message, toolCallId: "wrong-call" }
                    : message,
                ),
              });
              return modified.id;
            }, context);
      const altered =
        fault === "task-owner" ? { ...native, id: 99999 } : native;
      getTask.mockResolvedValueOnce({
        ...altered,
        state: {
          status: "terminal",
          outcome: { status: "completed", result: { entryId: id } },
        },
      } as typeof original);
      await expect(
        runtime.service.getTask(
          { ...test.call, input: { taskId: native.id } },
          context,
        ),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
    }
    getTask.mockResolvedValueOnce({
      ...native,
      state: { status: "terminal", outcome: { status: "aborted" } },
    } as typeof original);
    expect(
      await runtime.service.getTask(
        { ...test.call, input: { taskId: native.id } },
        context,
      ),
    ).toMatchObject({
      state: { status: "terminal", outcome: "aborted" },
      tool: { name: "fixture_tool", argumentsSource: "requested" },
    });
    getTask.mockResolvedValueOnce({
      ...native,
      state: { status: "pending", checkpoint: { phase: "prepare" } },
    } as typeof original);
    expect(
      await runtime.service.getTask(
        { ...test.call, input: { taskId: native.id } },
        context,
      ),
    ).toMatchObject({
      state: { status: "pending", phase: "prepare" },
      tool: { name: "fixture_tool", argumentsSource: "requested" },
    });
    getTask.mockRestore();
    expect(
      await runtime.service.getTask(
        { ...test.call, input: { taskId: native.id } },
        context,
      ),
    ).toMatchObject({
      tool: {
        name: "fixture_tool",
        argumentsSource: "requested",
        output: "Public output",
        details: { public: true },
      },
    });
  });

  it("isolates concurrently read histories and rejects cursors from a different full scope", async () => {
    const alpha = setup("alpha-harness");
    const beta = setup("beta-harness");
    const [first, second] = await Promise.all([
      open(alpha.options),
      open(beta.options),
    ]);
    for (const [runtime, marker] of [
      [first, "Alpha-only history"],
      [second, "Beta-only history"],
    ] as const)
      await runtime.harness.commit(async (tx) => {
        for (let index = 0; index < 3; index++)
          await tx.appendEntry(runtime.root.id, {
            kind: "fixture.user",
            model: [{ role: "user", content: marker, timestamp: 1 }],
          });
      }, context);
    const [entriesAlpha, entriesBeta] = await Promise.all([
      first.service.listEntries(
        { ...alpha.call, input: { conversationId: first.root.id, limit: 1 } },
        context,
      ),
      second.service.listEntries(
        { ...beta.call, input: { conversationId: second.root.id, limit: 1 } },
        context,
      ),
    ]);
    expect(JSON.stringify(entriesAlpha)).not.toContain("Beta-only");
    expect(JSON.stringify(entriesBeta)).not.toContain("Alpha-only");
    expect(entriesAlpha.cursor).toEqual(expect.any(String));
    await expect(
      second.service.listEntries(
        {
          ...beta.call,
          input: {
            conversationId: second.root.id,
            limit: 1,
            cursor: entriesAlpha.cursor ?? "",
          },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect((await first.service.inspect(alpha.call, context)).scheduling).toBe(
      "paused",
    );
    expect((await second.service.inspect(beta.call, context)).scheduling).toBe(
      "paused",
    );
  });
});
