import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  Type,
} from "@earendil-works/pi-ai";
import {
  CompactionEntry,
  createRegistry,
  defineExtension,
  defineTask,
  defineTool,
  MemoryStorage,
  type PromptSection,
  type ToolExecutionApi,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDefinition } from "../definitions/index.js";
import type { RuntimeBudgetLimits } from "../protocol/index.js";
import {
  openRuntime,
  type RuntimeHandle,
  type RuntimeOptions,
} from "./index.js";

const runtimes: RuntimeHandle[] = [];
const directories: string[] = [];
const caller = { id: "budget-owner" };

function setup(budget?: RuntimeBudgetLimits, tokensPerSecond = 1_000_000) {
  const definition = loadDefinition(
    fileURLToPath(
      new URL("../../../../tests/fixtures/minimal-squad", import.meta.url),
    ),
  );
  const faux = fauxProvider({
    provider: "fixture",
    models: [{ id: "test", reasoning: true }],
    tokensPerSecond,
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const options: RuntimeOptions = {
    runtimeId: "budget-runtime",
    definition,
    binding: {
      projectId: definition.projectId,
      scope: {
        projectId: definition.projectId,
        environmentId: "budget-test",
        squadId: definition.squadId,
        harnessId: "budget-harness",
      },
      definition: { contentHash: definition.contentHash },
      environment: {
        model: { provider: "fixture", modelId: "test" },
        thinkingLevel: "low",
      },
      ...(budget === undefined ? {} : { budget }),
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
    models,
    registry,
    call: { scope: options.binding.scope, caller, input: {} },
  };
}

async function open(options: RuntimeOptions) {
  const runtime = await openRuntime(options, context);
  runtimes.push(runtime);
  return runtime;
}
async function answer(
  runtime: RuntimeHandle,
  options: RuntimeOptions,
  text: string,
) {
  const id = await runtime.service.submit(
    {
      scope: options.binding.scope,
      caller,
      input: {
        conversationId: runtime.root.id,
        submission: { type: "input", content: text },
      },
    },
    context,
  );
  const result = await (await runtime.harness.submission(id, context))?.wait(
    context,
  );
  expect(result?.status).toBe("done");
  const watch = await runtime.root.watch(context);
  try {
    const failed = watch.value.entries.flatMap((entry) =>
      (entry.model ?? []).filter(
        (message) => message.role === "toolResult" && message.isError,
      ),
    );
    expect(failed, JSON.stringify(failed)).toEqual([]);
  } finally {
    await watch.stop();
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(
    runtimes.splice(0).map((runtime) => runtime.close(context)),
  );
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function scriptedTool(
  test: ReturnType<typeof setup>,
  execute: (api: ToolExecutionApi) => Promise<void>,
) {
  test.registry.install(
    defineExtension({
      name: "budget-test-tools",
      tools: [
        defineTool({
          name: "budget_probe",
          description: "Exercise public Models in a real tool invocation",
          parameters: Type.Object({}),
          replay: "safe",
          execute: async (_args, api) => {
            await execute(api);
            return {
              content: [{ type: "text", text: "Budget probe complete" }],
            };
          },
        }),
      ],
    }),
  );
  test.options.definition.roles = test.options.definition.roles.map((role) => ({
    ...role,
    extensions: ["budget-test-tools"],
    tools: ["budget_probe"],
  }));
  const reply: import("@earendil-works/pi-ai").FauxResponseFactory = (
    transcript,
  ) => {
    test.faux.appendResponses([reply]);
    const user = JSON.stringify(
      transcript.messages.filter((message) => message.role === "user"),
    );
    if (user.includes("inner-model"))
      return fauxAssistantMessage("Inner model answer");
    return transcript.messages.some((message) => message.role === "toolResult")
      ? fauxAssistantMessage("Outer completed")
      : fauxAssistantMessage(fauxToolCall("budget_probe", {}), {
          stopReason: "toolUse",
        });
  };
  test.faux.setResponses([reply]);
}

describe("durable execution budgets", () => {
  it("admits only one model send when two conversations compete for the last durable unit", async () => {
    const limits = { modelRequests: 1, toolEntries: 10, modelConcurrency: 2 };
    const test = setup(limits);
    test.faux.setResponses([
      fauxAssistantMessage("First permitted answer"),
      fauxAssistantMessage("Second must not be sent"),
    ]);
    const runtime = await open(test.options);
    expect((await runtime.service.inspect(test.call, context)).budget).toEqual({
      limits,
      consumed: { modelRequests: 0, toolEntries: 0 },
    });
    const conversation = await runtime.service.createConversation(
      { ...test.call, input: { roleId: "reviewer" } },
      context,
    );
    const results = await Promise.allSettled(
      [runtime.root.id, conversation.conversationId].map(
        async (conversationId) => {
          const id = await runtime.service.submit(
            {
              ...test.call,
              input: {
                conversationId,
                submission: {
                  type: "input",
                  content: "Compete for one model unit",
                },
              },
            },
            context,
          );
          return (await runtime.harness.submission(id, context))?.wait(context);
        },
      ),
    );
    expect(test.faux.state.callCount).toBe(1);
    expect(
      results.filter(
        (result) =>
          result.status === "fulfilled" && result.value?.status === "done",
      ).length,
    ).toBeLessThanOrEqual(1);
    expect(
      (await runtime.service.inspect(test.call, context)).budget,
    ).toMatchObject({
      limits,
      consumed: { modelRequests: 1, toolEntries: 0 },
      stopped: { reason: "model_requests", at: expect.any(Number) },
    });
  });

  it("persists consumed units and the original deadline through SQLite reopen without charging reads", async () => {
    const limits = {
      modelRequests: 3,
      toolEntries: 5,
      modelConcurrency: 1,
      deadlineAt: Date.now() + 60_000,
    };
    const test = setup(limits);
    const directory = await mkdtemp(join(tmpdir(), "frogie-budget-test-"));
    directories.push(directory);
    const path = join(directory, "session.sqlite");
    const runtime = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(path),
    });
    test.faux.setResponses([fauxAssistantMessage("Persistent budget reply")]);
    await answer(runtime, test.options, "One durable request");
    const initial = (await runtime.service.inspect(test.call, context)).budget;
    expect(initial).toEqual({
      limits,
      consumed: { modelRequests: 1, toolEntries: 0 },
    });
    const grant = {
      requestId: "persisted-grant",
      modelRequests: 2,
      deadlineAt: limits.deadlineAt + 5000,
    };
    const budget = await runtime.service.extendBudget(
      { ...test.call, input: grant },
      context,
    );
    expect(budget).toEqual({
      limits: { ...limits, modelRequests: 5, deadlineAt: grant.deadlineAt },
      consumed: { modelRequests: 1, toolEntries: 0 },
    });
    await runtime.close(context);
    const reopened = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(path),
    });
    expect(reopened.root.id).toBe(runtime.root.id);
    expect((await reopened.service.inspect(test.call, context)).budget).toEqual(
      budget,
    );
    expect(
      await reopened.service.extendBudget(
        { ...test.call, input: grant },
        context,
      ),
    ).toEqual(budget);
    await expect(
      reopened.service.extendBudget(
        { ...test.call, input: { ...grant, modelRequests: 3 } },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await reopened.service.inspect(test.call, context)).scheduling,
    ).toBe("paused");
    await reopened.service.listEntries(
      { ...test.call, input: { conversationId: reopened.root.id } },
      context,
    );
    await reopened.service.listTasks(test.call, context);
    expect((await reopened.service.inspect(test.call, context)).budget).toEqual(
      budget,
    );
    expect(test.faux.state.callCount).toBe(1);
  });

  it("rejects invalid initial limits and every startup attempt to add, remove or replace a durable initial budget", async () => {
    const base = { modelRequests: 3, toolEntries: 4, modelConcurrency: 1 };
    for (const limits of [
      { ...base, modelRequests: -1 },
      { ...base, toolEntries: 1.5 },
      { ...base, modelConcurrency: 0 },
      { ...base, modelRequests: Number.MAX_SAFE_INTEGER + 1 },
      { ...base, deadlineAt: 0 },
    ]) {
      const test = setup(limits);
      await expect(openRuntime(test.options, context)).rejects.toMatchObject({
        code: "invalid_request",
      });
      expect(test.faux.state.callCount).toBe(0);
    }
    const directory = await mkdtemp(join(tmpdir(), "frogie-budget-identity-"));
    directories.push(directory);
    for (const initial of [undefined, base]) {
      const test = setup(initial);
      const path = join(
        directory,
        initial === undefined ? "unbudgeted.sqlite" : "budgeted.sqlite",
      );
      const original = await open({
        ...test.options,
        storage: await openNodeSqliteStorage(path),
      });
      await original.close(context);
      const changed =
        initial === undefined
          ? [base]
          : [
              undefined,
              { ...base, modelRequests: 4 },
              { ...base, toolEntries: 5 },
              { ...base, modelConcurrency: 2 },
              { ...base, deadlineAt: Date.now() + 100_000 },
            ];
      for (const budget of changed) {
        const { budget: _budget, ...binding } = test.options.binding;
        await expect(
          openRuntime(
            {
              ...test.options,
              binding: {
                ...binding,
                ...(budget === undefined ? {} : { budget }),
              },
              storage: await openNodeSqliteStorage(path),
            },
            context,
          ),
        ).rejects.toMatchObject({ code: "binding_mismatch" });
        expect(test.faux.state.callCount).toBe(0);
      }
      const reopened = await open({
        ...test.options,
        storage: await openNodeSqliteStorage(path),
      });
      expect(
        (await reopened.service.inspect(test.call, context)).budget,
      ).toEqual(
        initial === undefined
          ? undefined
          : { limits: initial, consumed: { modelRequests: 0, toolEntries: 0 } },
      );
    }
  });

  it("leaves unbudgeted execution unrestricted and rejects grants without manufacturing a budget or deadline", async () => {
    const test = setup();
    test.faux.setResponses([fauxAssistantMessage("Unbudgeted answer")]);
    const runtime = await open(test.options);
    expect(
      await runtime.service.inspect(test.call, context),
    ).not.toHaveProperty("budget");
    await expect(
      runtime.service.extendBudget(
        { ...test.call, input: { requestId: "no-budget", modelRequests: 1 } },
        context,
      ),
    ).rejects.toMatchObject({ code: "capability_missing" });
    await answer(runtime, test.options, "Ordinary unbudgeted chat");
    expect(
      await runtime.service.inspect(test.call, context),
    ).not.toHaveProperty("budget");
  });

  it("charges complete and completeSimple exactly once at the real Tool Models boundary while preserving synchronous streams", async () => {
    const test = setup({
      modelRequests: 10,
      toolEntries: 5,
      modelConcurrency: 2,
    });
    const simple = vi.spyOn(test.models, "streamSimple");
    const raw = vi.spyOn(test.models, "stream");
    const deferredStream = vi.spyOn(test.models, "streamDeferred");
    const checked = deferred<void>();
    const nestedExecute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "Nested tool completed" }],
    }));
    const nested: ToolRegistration = defineTool({
      name: "budget_nested",
      description: "A host-composed tool invocation",
      parameters: Type.Object({}),
      execute: nestedExecute,
    });
    scriptedTool(test, async (api) => {
      const model = api.models.getModel("fixture", "test");
      if (!model) throw new Error("Missing model fixture");
      expect(
        api.registry.installed().map((extension) => extension.name),
      ).toContain("budget-test-sections");
      expect(
        api.registry.extension("budget-test-sections")?.sections,
      ).toHaveLength(1);
      expect(api.registry.tools().map(({ tool }) => tool.name)).toContain(
        "budget_probe",
      );
      expect(
        api.registry.sections().map(({ section }) => section.key),
      ).toContain("budget-public-section");
      expect(api.registry.tasks().length).toBeGreaterThan(0);
      expect(api.registry.task("pi.tool")).toBeDefined();
      expect(api.registry.extension("missing-extension")).toBeUndefined();
      expect(api.models.getProvider("fixture")).toBeDefined();
      expect(await Promise.resolve(api.models)).toBe(api.models);
      const wrap = api.registry
        .extension("budget-test-sections")
        ?.wraps?.find((wrap) => "tool" in wrap && wrap.tool === nested.name);
      if (!wrap || !("tool" in wrap))
        throw new Error("Missing public tool wrapper");
      await wrap.wrap(nested).execute({}, api, context);
      expect(nestedExecute).toHaveBeenCalledOnce();
      const before = test.faux.state.callCount;
      await api.models.complete(model, {
        messages: [
          { role: "user", content: "inner-model complete", timestamp: 1 },
        ],
      });
      await api.models.completeSimple(model, {
        messages: [
          { role: "user", content: "inner-model completeSimple", timestamp: 1 },
        ],
      });
      const stream = api.models.streamSimple(model, {
        messages: [
          { role: "user", content: "inner-model sync stream", timestamp: 1 },
        ],
      });
      expect(stream).not.toBeInstanceOf(Promise);
      expect(typeof stream[Symbol.asyncIterator]).toBe("function");
      await stream.result();
      const deferredMessage = await api.models.completeSimple(
        model,
        {
          messages: [
            { role: "user", content: "inner-model deferred", timestamp: 1 },
          ],
        },
        { deferred: true },
      );
      if (!deferredMessage.deferred)
        throw new Error("Missing faux deferred response");
      const streamed = api.models.streamDeferred(
        model,
        deferredMessage.deferred,
      );
      expect(streamed).not.toBeInstanceOf(Promise);
      await streamed.result();
      await api.models.fetchDeferred(model, deferredMessage.deferred);
      await api.models.cancelDeferred(model, deferredMessage.deferred);
      await expect(
        api.models.generateImages(
          { ...model, type: "image" } as never,
          { prompt: "No image budget bypass" } as never,
        ),
      ).rejects.toMatchObject({ code: "capability_missing" });
      await expect(
        api.models.classify(
          { ...model, type: "classifier" } as never,
          {} as never,
        ),
      ).rejects.toMatchObject({ code: "capability_missing" });
      expect(test.faux.state.callCount - before).toBe(4);
      expect(test.faux.state.deferredFetchCount).toBe(2);
      expect(test.faux.state.cancelledDeferred).toHaveLength(1);
      checked.resolve();
    });
    test.registry.install(
      defineExtension({
        name: "budget-test-sections",
        tools: [nested],
        sections: [
          {
            key: "budget-public-section",
            render: async () => "Public budget test section",
          },
        ],
        wraps: [
          { tool: nested.name, wrap: (tool: ToolRegistration) => tool },
          {
            section: "budget-public-section",
            wrap: (section: PromptSection) => ({
              ...section,
              render: async (...args: Parameters<PromptSection["render"]>) =>
                `${await section.render(...args)} Wrapped section`,
            }),
          },
        ],
      }),
    );
    test.options.definition.roles = test.options.definition.roles.map(
      (role) => ({
        ...role,
        extensions: [...role.extensions, "budget-test-sections"],
      }),
    );
    const runtime = await open(test.options);
    await answer(runtime, test.options, "Run Models budget probe");
    await checked.promise;
    expect(
      (await runtime.service.inspect(test.call, context)).budget?.consumed,
    ).toEqual({ modelRequests: 8, toolEntries: 2 });
    for (const method of [simple, raw, deferredStream])
      for (const [, , options] of method.mock.calls)
        expect(options?.maxRetries).toBe(0);
  });

  it("keeps a durable model predebit when cancellation follows commit and refuses storage failures before provider dispatch", async () => {
    const test = setup({
      modelRequests: 6,
      toolEntries: 3,
      modelConcurrency: 1,
    });
    const verified = deferred<void>();
    let runtime: RuntimeHandle;
    scriptedTool(test, async (api) => {
      const model = api.models.getModel("fixture", "test");
      if (!model) throw new Error("Missing provider model");
      const controller = new AbortController();
      const nativeCommit = runtime.harness.commit.bind(runtime.harness);
      const admission = vi
        .spyOn(runtime.harness, "commit")
        .mockImplementationOnce(async (...args) => {
          const result = await nativeCommit(...args);
          controller.abort(
            new DOMException("Cancelled after durable admission", "AbortError"),
          );
          return result;
        });
      const before = test.faux.state.callCount;
      try {
        const stream = api.models.streamSimple(
          model,
          {
            messages: [
              { role: "user", content: "inner-model cancelled", timestamp: 1 },
            ],
          },
          { signal: controller.signal },
        );
        await stream.result();
        expect(test.faux.state.callCount).toBe(before);
        expect(
          (await runtime.service.inspect(test.call, context)).budget?.consumed
            .modelRequests,
        ).toBe(2);
      } finally {
        admission.mockRestore();
      }
      const commit = vi
        .spyOn(runtime.harness, "commit")
        .mockRejectedValueOnce(new Error("Predebit persistence unavailable"));
      await api.models.completeSimple(model, {
        messages: [
          { role: "user", content: "inner-model denied storage", timestamp: 1 },
        ],
      });
      commit.mockRestore();
      expect(test.faux.state.callCount).toBe(before);
      expect(
        (await runtime.service.inspect(test.call, context)).budget?.consumed
          .modelRequests,
      ).toBe(2);
      verified.resolve();
    });
    runtime = await open(test.options);
    await answer(runtime, test.options, "Predebit failure boundaries");
    await verified.promise;
    expect(
      (await runtime.service.inspect(test.call, context)).budget?.consumed,
    ).toEqual({ modelRequests: 3, toolEntries: 1 });
  });

  it("responds to slot cancellation without dispatching waiters or consuming their units", async () => {
    const test = setup({
      modelRequests: 10,
      toolEntries: 3,
      modelConcurrency: 1,
      deadlineAt: Date.now() + 60_000,
    });
    const verified = deferred<void>();
    scriptedTool(test, async (api) => {
      const model = api.models.getModel("fixture", "test");
      if (!model) throw new Error("Missing provider model");
      const entered = deferred<void>();
      const release = deferred<void>();
      test.faux.setResponses([
        async () => {
          entered.resolve();
          await release.promise;
          return fauxAssistantMessage("Held request finished");
        },
        fauxAssistantMessage("Cancelled waiter must not send"),
      ]);
      const first = api.models.streamSimple(model, {
        messages: [{ role: "user", content: "inner-model held", timestamp: 1 }],
      });
      await entered.promise;
      const controller = new AbortController();
      const second = api.models.streamSimple(
        model,
        {
          messages: [
            { role: "user", content: "inner-model waiting", timestamp: 1 },
          ],
        },
        { signal: controller.signal },
      );
      controller.abort(
        new DOMException("Cancel queued model slot", "AbortError"),
      );
      await second.result();
      expect(test.faux.state.callCount).toBe(2);
      expect(
        (await runtime.service.inspect(test.call, context)).budget?.consumed
          .modelRequests,
      ).toBe(2);
      release.resolve();
      await first.result();
      test.faux.setResponses([fauxAssistantMessage("Outer final answer")]);
      verified.resolve();
    });
    const runtime = await open(test.options);
    await answer(runtime, test.options, "Exercise fair model slot");
    await verified.promise;
    expect(
      (await runtime.service.inspect(test.call, context)).budget?.consumed,
    ).toEqual({ modelRequests: 3, toolEntries: 1 });
  });

  it("expires a paused budget durably at its absolute deadline and releases deadline timers on close", async () => {
    vi.useFakeTimers();
    const limits = {
      modelRequests: 3,
      toolEntries: 3,
      modelConcurrency: 1,
      deadlineAt: Date.now() + 1000,
    };
    const test = setup(limits);
    const runtime = await open(test.options);
    expect((await runtime.service.inspect(test.call, context)).budget).toEqual({
      limits,
      consumed: { modelRequests: 0, toolEntries: 0 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(async () =>
      expect(
        (await runtime.service.inspect(test.call, context)).budget?.stopped,
      ).toMatchObject({ reason: "deadline", at: limits.deadlineAt }),
    );
    expect(test.faux.state.callCount).toBe(0);
    const submissions = await test.options.storage.scanSubmissions(
      {},
      100,
      undefined,
      context,
    );
    const tasks = await test.options.storage.scanTasks(
      {},
      100,
      undefined,
      context,
    );
    await expect(
      runtime.service.submit(
        {
          ...test.call,
          input: {
            conversationId: runtime.root.id,
            submission: { type: "input", content: "Past deadline" },
          },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    await expect(
      runtime.service.compact(
        { ...test.call, input: { conversationId: runtime.root.id } },
        context,
      ),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(
      await test.options.storage.scanSubmissions({}, 100, undefined, context),
    ).toEqual(submissions);
    expect(
      await test.options.storage.scanTasks({}, 100, undefined, context),
    ).toEqual(tasks);
    const restored = await runtime.service.extendBudget(
      {
        ...test.call,
        input: {
          requestId: "restore-deadline",
          deadlineAt: Date.now() + 10_000,
        },
      },
      context,
    );
    expect(restored).not.toHaveProperty("stopped");
    expect(restored.consumed).toEqual({ modelRequests: 0, toolEntries: 0 });
    await runtime.close(context);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks the absolute deadline before model dispatch even when its timer has not fired", async () => {
    const deadlineAt = Date.now() + 60_000;
    const test = setup({
      modelRequests: 4,
      toolEntries: 1,
      modelConcurrency: 1,
      deadlineAt,
    });
    let models: ToolExecutionApi["models"] | undefined;
    scriptedTool(test, async (api) => {
      models = api.models;
    });
    const runtime = await open(test.options);
    await answer(runtime, test.options, "Capture the public Models boundary");
    if (!models) throw new Error("The tool did not expose Models");
    const model = models.getModel("fixture", "test");
    if (!model) throw new Error("Missing provider model");
    vi.spyOn(Date, "now").mockReturnValue(deadlineAt + 1);
    const reply = await models.completeSimple(model, {
      messages: [
        { role: "user", content: "After deadline", timestamp: deadlineAt },
      ],
    });
    expect(reply.stopReason).toBe("error");
    expect(test.faux.state.callCount).toBe(2);
    expect(
      (await runtime.service.inspect(test.call, context)).budget,
    ).toMatchObject({
      consumed: { modelRequests: 2, toolEntries: 1 },
      stopped: { reason: "deadline", at: deadlineAt + 1 },
    });
  });

  it("persists deadline exhaustion while a request waits for a model slot and cancels the owned work", async () => {
    vi.useFakeTimers();
    const limits = {
      modelRequests: 10,
      toolEntries: 3,
      modelConcurrency: 1,
      deadlineAt: Date.now() + 60_000,
    };
    const test = setup(limits, 0);
    const held = deferred<void>();
    const release = deferred<void>();
    const waiting = deferred<void>();
    let pending: Promise<unknown> | undefined;
    scriptedTool(test, async (api) => {
      const model = api.models.getModel("fixture", "test");
      if (!model) throw new Error("Missing model");
      test.faux.setResponses([
        async () => {
          held.resolve();
          await release.promise;
          return fauxAssistantMessage("Held model reply");
        },
      ]);
      const first = api.models
        .streamSimple(model, {
          messages: [
            {
              role: "user",
              content: "inner-model holds deadline slot",
              timestamp: 1,
            },
          ],
        })
        .result();
      await held.promise;
      pending = api.models
        .streamSimple(model, {
          messages: [
            {
              role: "user",
              content: "inner-model deadline waiter",
              timestamp: 1,
            },
          ],
        })
        .result();
      waiting.resolve();
      await pending;
      await first;
    });
    const runtime = await open(test.options);
    const submission = await runtime.service.submit(
      {
        ...test.call,
        input: {
          conversationId: runtime.root.id,
          submission: { type: "input", content: "Deadline waiting slot" },
        },
      },
      context,
    );
    await waiting.promise;
    expect(
      (await runtime.service.inspect(test.call, context)).budget?.consumed
        .modelRequests,
    ).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    release.resolve();
    await pending;
    await (await runtime.harness.submission(submission, context))?.wait(
      context,
    );
    expect(
      (await runtime.service.inspect(test.call, context)).budget,
    ).toMatchObject({
      consumed: { modelRequests: 2, toolEntries: 1 },
      stopped: { reason: "deadline" },
    });
    expect(test.faux.state.callCount).toBe(2);
    expect((await runtime.harness.inspect(context)).tasks).toEqual([]);
  });

  it("releases a cancelled Tool invocation waiting for a model slot when the runtime closes", async () => {
    const test = setup({
      modelRequests: 10,
      toolEntries: 3,
      modelConcurrency: 1,
    });
    const entered = deferred<void>();
    const release = deferred<void>();
    const waiting = deferred<void>();
    let firstResult: Promise<unknown> | undefined;
    let secondResult: Promise<unknown> | undefined;
    scriptedTool(test, async (api) => {
      const model = api.models.getModel("fixture", "test");
      if (!model) throw new Error("Missing model");
      test.faux.setResponses([
        async () => {
          entered.resolve();
          await release.promise;
          return fauxAssistantMessage("Held model reply");
        },
      ]);
      firstResult = api.models
        .streamSimple(model, {
          messages: [
            { role: "user", content: "inner-model holds slot", timestamp: 1 },
          ],
        })
        .result();
      await entered.promise;
      secondResult = api.models
        .streamSimple(model, {
          messages: [
            {
              role: "user",
              content: "inner-model waits for close",
              timestamp: 1,
            },
          ],
        })
        .result();
      waiting.resolve();
      await secondResult;
    });
    const runtime = await open(test.options);
    await runtime.service.submit(
      {
        ...test.call,
        input: {
          conversationId: runtime.root.id,
          submission: { type: "input", content: "Close waiting model work" },
        },
      },
      context,
    );
    await waiting.promise;
    const before = test.faux.state.callCount;
    const closing = runtime.close(context);
    release.resolve();
    await closing;
    await Promise.all([firstResult, secondResult]);
    expect(test.faux.state.callCount).toBe(before);
  });

  it("counts the final Tool execute once through an existing user wrap and rejects a second tool entry durably", async () => {
    const test = setup({
      modelRequests: 10,
      toolEntries: 1,
      modelConcurrency: 1,
    });
    const executed = vi.fn();
    const wrapped = vi.fn();
    scriptedTool(test, async () => {
      executed();
    });
    test.registry.install(
      defineExtension({
        name: "budget-user-wrap",
        wraps: [
          {
            tool: "budget_probe",
            wrap: (tool: ToolRegistration) => ({
              ...tool,
              execute: async (
                ...args: Parameters<ToolRegistration["execute"]>
              ) => {
                wrapped();
                return tool.execute(...args);
              },
            }),
          },
        ],
      }),
    );
    test.options.definition.roles = test.options.definition.roles.map(
      (role) => ({
        ...role,
        extensions: [...role.extensions, "budget-user-wrap"],
      }),
    );
    test.registry.install(
      defineExtension({
        name: "budget-second-wrapper",
        wraps: [
          {
            tool: "budget_probe",
            wrap: (tool: ToolRegistration) => ({
              ...tool,
              execute: async (
                ...args: Parameters<ToolRegistration["execute"]>
              ) => tool.execute(...args),
            }),
          },
        ],
      }),
    );
    test.options.definition.roles = test.options.definition.roles.map(
      (role) => ({
        ...role,
        extensions: [...role.extensions, "budget-second-wrapper"],
      }),
    );
    const runtime = await open(test.options);
    await answer(runtime, test.options, "First wrapped tool");
    expect(executed).toHaveBeenCalledOnce();
    expect(wrapped).toHaveBeenCalledOnce();
    expect(
      (await runtime.service.inspect(test.call, context)).budget?.consumed
        .toolEntries,
    ).toBe(1);
    expect(
      (await runtime.service.inspect(test.call, context)).budget,
    ).not.toHaveProperty("stopped");
    test.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("budget_probe", {}), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Second tool must not execute"),
    ]);
    const submission = await runtime.service.submit(
      {
        ...test.call,
        input: {
          conversationId: runtime.root.id,
          submission: { type: "input", content: "Invoke another wrapped tool" },
        },
      },
      context,
    );
    await (await runtime.harness.submission(submission, context))?.wait(
      context,
    );
    expect(executed).toHaveBeenCalledOnce();
    expect(wrapped).toHaveBeenCalledOnce();
    expect(
      (await runtime.service.inspect(test.call, context)).budget,
    ).toMatchObject({
      consumed: { toolEntries: 1 },
      stopped: { reason: "tool_entries", at: expect.any(Number) },
    });
    const restored = await runtime.service.extendBudget(
      { ...test.call, input: { requestId: "restore-tools", toolEntries: 2 } },
      context,
    );
    expect(restored).not.toHaveProperty("stopped");
    expect(restored.consumed.toolEntries).toBe(1);
  });

  it("replays a safe wrapped Tool from the same SQLite and charges every actual execute entry without resetting the ledger", async () => {
    const test = setup({
      modelRequests: 5,
      toolEntries: 3,
      modelConcurrency: 1,
    });
    const directory = await mkdtemp(
      join(tmpdir(), "frogie-budget-tool-recovery-"),
    );
    directories.push(directory);
    const path = join(directory, "session.sqlite");
    const entered = deferred<void>();
    const executions: number[] = [];
    const wrapped = vi.fn();
    const tool = defineTool({
      name: "recover_probe",
      description: "Safe replay budget probe",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async (_args, api, callContext) => {
        executions.push(api.taskId);
        if (executions.length === 1) {
          entered.resolve();
          await new Promise<void>((_resolve, reject) =>
            callContext.abortSignal?.addEventListener(
              "abort",
              () => reject(callContext.abortSignal?.reason),
              { once: true },
            ),
          );
        }
        return { content: [{ type: "text", text: "Recovered tool reply" }] };
      },
    });
    test.registry.install(
      defineExtension({
        name: "recovery-tools",
        tools: [tool],
        wraps: [
          {
            tool: "recover_probe",
            wrap: (tool: ToolRegistration) => ({
              ...tool,
              execute: async (
                ...args: Parameters<ToolRegistration["execute"]>
              ) => {
                wrapped();
                return tool.execute(...args);
              },
            }),
          },
        ],
      }),
    );
    test.options.definition.roles = test.options.definition.roles.map(
      (role) => ({
        ...role,
        extensions: ["recovery-tools"],
        tools: ["recover_probe"],
      }),
    );
    test.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("recover_probe", {}), {
        stopReason: "toolUse",
      }),
    ]);
    const runtime = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(path),
    });
    const submissionId = await runtime.service.submit(
      {
        ...test.call,
        input: {
          conversationId: runtime.root.id,
          submission: { type: "input", content: "Recover this safe tool" },
        },
      },
      context,
    );
    await entered.promise;
    expect(
      (await runtime.service.inspect(test.call, context)).budget?.consumed,
    ).toEqual({ modelRequests: 1, toolEntries: 1 });
    await runtime.close(context);
    test.faux.setResponses([fauxAssistantMessage("Recovered parent answer")]);
    const reopened = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(path),
    });
    expect(
      (await reopened.service.inspect(test.call, context)).budget?.consumed,
    ).toEqual({ modelRequests: 1, toolEntries: 1 });
    reopened.harness.resume();
    expect(
      (
        await (
          await reopened.harness.submission(submissionId, context)
        )?.wait(context)
      )?.status,
    ).toBe("done");
    expect(executions).toHaveLength(2);
    expect(executions[0]).toBe(executions[1]);
    expect(wrapped).toHaveBeenCalledTimes(2);
    expect(
      (await reopened.service.inspect(test.call, context)).budget?.consumed,
    ).toEqual({ modelRequests: 2, toolEntries: 2 });
  });

  it("fails closed when persisted budget state is missing or corrupted instead of silently initializing it", async () => {
    const deadlineAt = Date.now() + 60_000;
    const test = setup({
      modelRequests: 3,
      toolEntries: 3,
      modelConcurrency: 1,
      deadlineAt,
    });
    const directory = await mkdtemp(join(tmpdir(), "frogie-budget-storage-"));
    directories.push(directory);
    const path = join(directory, "session.sqlite");
    const runtime = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(path),
    });
    let budgetId: import("@earendil-works/pi-durable").DocumentId | undefined;
    const unsubscribe = runtime.harness.subscribeCommits((publication) => {
      for (const change of publication.changes)
        if (
          change.type === "document" &&
          change.value &&
          "initial" in change.value &&
          "consumed" in change.value
        )
          budgetId = change.record.id;
    });
    await runtime.service.extendBudget(
      {
        ...test.call,
        input: {
          requestId: "identify-state",
          modelRequests: 1,
          toolEntries: 1,
          deadlineAt: deadlineAt + 1000,
        },
      },
      context,
    );
    unsubscribe();
    if (budgetId === undefined)
      throw new Error("Missing persisted budget publication");
    await runtime.close(context);
    for (const fault of [
      "missing",
      "consumed",
      "grants",
      "duplicate-grant",
      "grant-caller",
      "grant-deadline",
      "stopped",
      "overspent",
    ] as const) {
      const storage = await openNodeSqliteStorage(path);
      const document = storage.document.bind(storage);
      vi.spyOn(storage, "document").mockImplementation(
        async (id, at, callContext) => {
          const saved = await document(id, at, callContext);
          if (id !== budgetId || !saved) return saved;
          if (fault === "missing") return undefined;
          const grant = {
            caller: caller.id,
            input: {
              requestId: "identify-state",
              modelRequests: 1,
              toolEntries: 1,
              deadlineAt: deadlineAt + 1000,
            },
          };
          const changes =
            fault === "consumed"
              ? { consumed: { modelRequests: -1, toolEntries: 0 } }
              : fault === "grants"
                ? { grants: [] }
                : fault === "duplicate-grant"
                  ? { grants: [grant, grant] }
                  : fault === "grant-caller"
                    ? { grants: [{ ...grant, caller: "" }] }
                    : fault === "grant-deadline"
                      ? {
                          grants: [
                            { ...grant, input: { ...grant.input, deadlineAt } },
                          ],
                        }
                      : fault === "overspent"
                        ? { consumed: { modelRequests: 5, toolEntries: 0 } }
                        : { stopped: { reason: "unknown", at: -1 } };
          return { ...saved, value: { ...saved.value, ...changes } };
        },
      );
      await expect(
        openRuntime({ ...test.options, storage }, context),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
      expect(test.faux.state.callCount).toBe(0);
    }
    const reopened = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(path),
    });
    expect(
      (await reopened.service.inspect(test.call, context)).budget?.limits
        .modelRequests,
    ).toBe(4);
  });

  it("cancels owned parent, child and background tasks after model exhaustion is durably stopped", async () => {
    const test = setup({
      modelRequests: 0,
      toolEntries: 3,
      modelConcurrency: 1,
    });
    const entered = deferred<void>();
    const cancelled = new Set<number>();
    let running = 0;
    const task = defineTask<Record<string, never>, { phase: "hold" }, void>({
      name: "budget.owned-work",
      version: 1,
      initial: () => ({ phase: "hold" }),
      phases: {
        hold: async (_task, api, callContext) => {
          if (++running === 3) entered.resolve();
          await new Promise<void>((_resolve, reject) =>
            api.signal.addEventListener(
              "abort",
              () => {
                cancelled.add(api.taskId);
                reject(api.signal.reason);
              },
              { once: true },
            ),
          );
          await api.commit(
            () => ({
              status: "terminal",
              outcome: { status: "completed", result: undefined },
            }),
            callContext,
          );
        },
      },
      abort: async (_task, api, callContext) => {
        cancelled.add(api.taskId);
        await api.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          callContext,
        );
      },
    });
    test.registry.install(
      defineExtension({ name: "owned-budget-work", tasks: [task] }),
    );
    const runtime = await open(test.options);
    const ids = await runtime.harness.commit(async (tx) => {
      const parent = await tx.createTask(
        task,
        {},
        {
          ownership: { kind: "conversation" },
          conversationId: runtime.root.id,
        },
      );
      const child = await tx.createTask(
        task,
        {},
        {
          ownership: { kind: "task", taskId: parent },
          conversationId: runtime.root.id,
        },
      );
      const background = await tx.createTask(
        task,
        {},
        {
          ownership: { kind: "conversation" },
          conversationId: runtime.root.id,
          background: true,
        },
      );
      return [parent, child, background];
    }, context);
    runtime.harness.resume();
    await entered.promise;
    const submission = await runtime.service.submit(
      {
        ...test.call,
        input: {
          conversationId: runtime.root.id,
          submission: { type: "input", content: "Exhaust zero model budget" },
        },
      },
      context,
    );
    await (await runtime.harness.submission(submission, context))?.wait(
      context,
    );
    await Promise.all(
      ids.map((id) => runtime.harness.waitForTask(id, context)),
    );
    expect(cancelled.size).toBe(3);
    expect((await runtime.harness.inspect(context)).tasks).toEqual([]);
    expect(
      (await runtime.service.inspect(test.call, context)).budget,
    ).toMatchObject({
      consumed: { modelRequests: 0, toolEntries: 0 },
      stopped: { reason: "model_requests", at: expect.any(Number) },
    });
  });

  it("counts manual Pi compaction as a model request and preserves its committed history without charging reads", async () => {
    const test = setup({
      modelRequests: 3,
      toolEntries: 2,
      modelConcurrency: 1,
    });
    test.faux.setResponses([
      fauxAssistantMessage("Compressed durable summary"),
    ]);
    const runtime = await open(test.options);
    for (let index = 0; index < 3; index++)
      await runtime.service.submit(
        {
          ...test.call,
          input: {
            conversationId: runtime.root.id,
            submission: {
              type: "write",
              entry: {
                kind: "pi.user",
                model: [
                  {
                    role: "user",
                    content: "Preserved history ".repeat(6000),
                    timestamp: 1,
                  },
                ],
              },
            },
          },
        },
        context,
      );
    expect(
      (await runtime.service.inspect(test.call, context)).budget?.consumed
        .modelRequests,
    ).toBe(0);
    const taskId = await runtime.service.compact(
      {
        ...test.call,
        input: {
          conversationId: runtime.root.id,
          instructions: "Retain source facts",
        },
      },
      context,
    );
    const result = await runtime.harness.waitForTask(taskId, context);
    expect(result.state).toMatchObject({
      status: "terminal",
      outcome: { status: "completed" },
    });
    const watch = await runtime.root.watch(context);
    expect(watch.value.entries.some((entry) => CompactionEntry.is(entry))).toBe(
      true,
    );
    await watch.stop();
    expect(
      (await runtime.service.inspect(test.call, context)).budget?.consumed,
    ).toEqual({ modelRequests: 1, toolEntries: 0 });
  });

  it("cancels late queued input and background work while preserving paused scheduling and passive writes", async () => {
    vi.useFakeTimers();
    const test = setup({
      modelRequests: 3,
      toolEntries: 3,
      modelConcurrency: 1,
      deadlineAt: Date.now() + 1000,
    });
    const run = vi.fn();
    const task = defineTask<Record<string, never>, { phase: "hold" }, void>({
      name: "budget.late-work",
      version: 1,
      initial: () => ({ phase: "hold" }),
      phases: { hold: async () => run() },
      abort: async (_task, api, callContext) => {
        await api.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          callContext,
        );
      },
    });
    test.registry.install(
      defineExtension({ name: "late-work", tasks: [task] }),
    );
    const runtime = await open(test.options);
    await vi.advanceTimersByTimeAsync(1000);
    const scan = vi
      .spyOn(runtime.harness, "inspect")
      .mockRejectedValueOnce(new Error("private-late-work-scan"));
    const [input, write] = await runtime.harness.commit(
      async (tx) =>
        [
          await tx.createSubmission({
            conversationId: runtime.root.id,
            type: "input",
            status: "queued",
          }),
          await tx.createSubmission({
            conversationId: runtime.root.id,
            type: "write",
            status: "queued",
          }),
        ] as const,
      context,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledOnce();
    expect(
      await test.options.storage.submission(input.id, context),
    ).toMatchObject({
      status: "queued",
    });
    scan.mockRestore();
    const id = await runtime.harness.commit(
      (tx) =>
        tx.createTask(
          task,
          {},
          {
            ownership: { kind: "conversation" },
            conversationId: runtime.root.id,
            background: true,
          },
        ),
      context,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(await test.options.storage.task(id, context)).toMatchObject({
      abortRequested: true,
      state: { status: "pending" },
    });
    expect(
      await test.options.storage.submission(input.id, context),
    ).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    expect(
      await test.options.storage.submission(write.id, context),
    ).toMatchObject({
      status: "queued",
    });
    expect((await runtime.service.inspect(test.call, context)).scheduling).toBe(
      "paused",
    );
    expect(run).not.toHaveBeenCalled();
    expect(test.faux.state.callCount).toBe(0);
  });

  it("allows the final permitted model answer to finish and persists stopped only when a later admission is denied", async () => {
    const limits = { modelRequests: 1, toolEntries: 2, modelConcurrency: 1 };
    const test = setup(limits);
    test.faux.setResponses([fauxAssistantMessage("Final allowed answer")]);
    const runtime = await open(test.options);
    await answer(runtime, test.options, "Use last model unit");
    expect((await runtime.service.inspect(test.call, context)).budget).toEqual({
      limits,
      consumed: { modelRequests: 1, toolEntries: 0 },
    });
    const denied = await runtime.service
      .submit(
        {
          ...test.call,
          input: {
            conversationId: runtime.root.id,
            submission: { type: "input", content: "One too many" },
          },
        },
        context,
      )
      .then(
        async (id) =>
          (await runtime.harness.submission(id, context))?.wait(context),
        (error: unknown) => error,
      );
    expect(denied).not.toMatchObject({ status: "done" });
    expect(test.faux.state.callCount).toBe(1);
    expect(
      (await runtime.service.inspect(test.call, context)).budget,
    ).toMatchObject({
      consumed: { modelRequests: 1, toolEntries: 0 },
      stopped: { reason: "model_requests", at: expect.any(Number) },
    });
    const before = {
      submissions: await test.options.storage.scanSubmissions(
        {},
        100,
        undefined,
        context,
      ),
      tasks: await test.options.storage.scanTasks({}, 100, undefined, context),
    };
    await expect(
      runtime.service.submit(
        {
          ...test.call,
          input: {
            conversationId: runtime.root.id,
            submission: {
              type: "input",
              content: "Stopped request must not persist",
            },
          },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    await expect(
      runtime.service.compact(
        { ...test.call, input: { conversationId: runtime.root.id } },
        context,
      ),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(
      await test.options.storage.scanSubmissions({}, 100, undefined, context),
    ).toEqual(before.submissions);
    expect(
      await test.options.storage.scanTasks({}, 100, undefined, context),
    ).toEqual(before.tasks);
    expect(test.faux.state.callCount).toBe(1);
    await runtime.service.createConversation(
      { ...test.call, input: { roleId: "reviewer" } },
      context,
    );
    const resumed = await runtime.service.extendBudget(
      {
        ...test.call,
        input: { requestId: "restore-model-budget", modelRequests: 2 },
      },
      context,
    );
    expect(resumed).toEqual({
      limits: { ...limits, modelRequests: 3 },
      consumed: { modelRequests: 1, toolEntries: 0 },
    });
    test.faux.setResponses([fauxAssistantMessage("Granted request completed")]);
    await answer(runtime, test.options, "Continue after authorized grant");
    expect(
      (await runtime.service.inspect(test.call, context)).budget?.consumed
        .modelRequests,
    ).toBe(2);
  });

  it("starts an already expired budget paused, rejects new work and permits a later authorized deadline", async () => {
    const deadlineAt = Date.now() - 1000;
    const test = setup({
      modelRequests: 3,
      toolEntries: 3,
      modelConcurrency: 1,
      deadlineAt,
    });
    const runtime = await open(test.options);
    expect(
      (await runtime.service.inspect(test.call, context)).budget,
    ).toMatchObject({
      consumed: { modelRequests: 0, toolEntries: 0 },
      stopped: { reason: "deadline" },
    });
    await expect(
      runtime.service.submit(
        {
          ...test.call,
          input: {
            conversationId: runtime.root.id,
            submission: { type: "input", content: "Expired initial budget" },
          },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    const restored = await runtime.service.extendBudget(
      {
        ...test.call,
        input: {
          requestId: "authorize-later-deadline",
          deadlineAt: Date.now() + 60_000,
        },
      },
      context,
    );
    expect(restored).not.toHaveProperty("stopped");
    expect((await runtime.service.inspect(test.call, context)).scheduling).toBe(
      "paused",
    );
    expect(test.faux.state.callCount).toBe(0);
  });

  it("bounds the durable grant ledger and refuses to invent an unconfigured deadline", async () => {
    const test = setup({
      modelRequests: 3,
      toolEntries: 3,
      modelConcurrency: 1,
    });
    const directory = await mkdtemp(join(tmpdir(), "frogie-budget-ledger-"));
    directories.push(directory);
    const path = join(directory, "session.sqlite");
    const runtime = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(path),
    });
    await expect(
      runtime.service.extendBudget(
        {
          ...test.call,
          input: {
            requestId: "invent-deadline",
            deadlineAt: Date.now() + 60_000,
          },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    let budgetId: import("@earendil-works/pi-durable").DocumentId | undefined;
    const release = runtime.harness.subscribeCommits((publication) => {
      for (const change of publication.changes)
        if (
          change.type === "document" &&
          change.value &&
          "initial" in change.value &&
          "grants" in change.value
        )
          budgetId = change.record.id;
    });
    await runtime.service.extendBudget(
      { ...test.call, input: { requestId: "grant-0", modelRequests: 1 } },
      context,
    );
    release();
    await runtime.close(context);
    if (budgetId === undefined) throw new Error("Missing owned budget record");
    const storage = await openNodeSqliteStorage(path);
    const saved = await storage.document(budgetId, "current", context);
    if (!saved) throw new Error("Missing durable budget");
    const grants = Array.from({ length: 1024 }, (_, index) => ({
      caller: caller.id,
      input: { requestId: `grant-${index}`, modelRequests: 1 },
    }));
    await storage.commit(
      [
        {
          type: "document.change",
          id: budgetId,
          content: {
            kind: "base",
            version: saved.version,
            value: {
              ...saved.value,
              limits: {
                modelRequests: 1027,
                toolEntries: 3,
                modelConcurrency: 1,
              },
              grants,
            },
          },
        },
      ],
      context,
    );
    await storage.close(context);
    const reopened = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(path),
    });
    await expect(
      reopened.service.extendBudget(
        {
          ...test.call,
          input: { requestId: "one-too-many", modelRequests: 1 },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "output_limit" });
    expect(
      (await reopened.service.inspect(test.call, context)).budget?.limits
        .modelRequests,
    ).toBe(1027);
  });

  it("keeps model slots until an aborted provider actually settles and then admits the next waiter", async () => {
    const test = setup({
      modelRequests: 6,
      toolEntries: 3,
      modelConcurrency: 1,
    });
    const checked = deferred<void>();
    let runtime: RuntimeHandle;
    scriptedTool(test, async (api) => {
      const model = api.models.getModel("fixture", "test");
      if (!model) throw new Error("Missing model");
      const held = deferred<void>();
      const release = deferred<void>();
      const nextEntered = deferred<void>();
      test.faux.setResponses([
        async () => {
          held.resolve();
          await release.promise;
          return fauxAssistantMessage("Held provider settled");
        },
        () => {
          nextEntered.resolve();
          return fauxAssistantMessage("Next admitted");
        },
      ]);
      const abort = new AbortController();
      const first = api.models.streamSimple(
        model,
        {
          messages: [
            {
              role: "user",
              content: "inner-model pending cancellation",
              timestamp: 1,
            },
          ],
        },
        { signal: abort.signal },
      );
      await held.promise;
      abort.abort(
        new DOMException("Provider cancellation requested", "AbortError"),
      );
      await first.result();
      const second = api.models.streamSimple(model, {
        messages: [
          {
            role: "user",
            content: "inner-model queued after cancellation",
            timestamp: 1,
          },
        ],
      });
      expect(test.faux.state.callCount).toBe(2);
      expect(
        (await runtime.service.inspect(test.call, context)).budget?.consumed
          .modelRequests,
      ).toBe(2);
      release.resolve();
      await nextEntered.promise;
      await second.result();
      expect(test.faux.state.callCount).toBe(3);
      test.faux.setResponses([
        fauxAssistantMessage("Outer completed after slot handoff"),
      ]);
      checked.resolve();
    });
    runtime = await open(test.options);
    await answer(runtime, test.options, "Model cancellation handoff");
    await checked.promise;
    expect(
      (await runtime.service.inspect(test.call, context)).budget?.consumed
        .modelRequests,
    ).toBe(4);
  });

  it("contains provider iterator and result failures without leaking private diagnostics or refunding durable admissions", async () => {
    const test = setup({
      modelRequests: 6,
      toolEntries: 3,
      modelConcurrency: 1,
    });
    const checked = deferred<void>();
    scriptedTool(test, async (api) => {
      const model = api.models.getModel("fixture", "test");
      if (!model) throw new Error("Missing provider model");
      for (const stage of ["iterator", "result"] as const) {
        const source = {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                if (stage === "iterator")
                  throw new Error("private-provider-secret");
                return { done: true as const, value: undefined };
              },
            };
          },
          result: () => Promise.reject(new Error("private-provider-secret")),
        };
        const send = vi
          .spyOn(test.models, "streamSimple")
          .mockReturnValueOnce(source as never);
        const reply = await api.models.completeSimple(model, {
          messages: [
            {
              role: "user",
              content: `inner-model ${stage} failure`,
              timestamp: 1,
            },
          ],
        });
        send.mockRestore();
        expect(reply.stopReason).toBe("error");
        expect(reply.errorMessage).not.toContain("private-provider-secret");
      }
      checked.resolve();
    });
    const runtime = await open(test.options);
    await answer(runtime, test.options, "Provider failure isolation");
    await checked.promise;
    expect(
      (await runtime.service.inspect(test.call, context)).budget?.consumed,
    ).toEqual({ modelRequests: 4, toolEntries: 1 });
  });

  it("closes an exhausted cancellation scan that fails and permits a later explicit grant without hanging", async () => {
    vi.useFakeTimers();
    const limits = {
      modelRequests: 3,
      toolEntries: 3,
      modelConcurrency: 1,
      deadlineAt: Date.now() + 1000,
    };
    const test = setup(limits, 0);
    const runtime = await open(test.options);
    const nativeInspect = runtime.harness.inspect.bind(runtime.harness);
    const scanned = deferred<void>();
    const inspect = vi
      .spyOn(runtime.harness, "inspect")
      .mockImplementationOnce(async () => {
        scanned.resolve();
        throw new Error("private-scan-error");
      });
    await vi.advanceTimersByTimeAsync(1000);
    await scanned.promise;
    inspect.mockImplementation(nativeInspect);
    const granted = await runtime.service.extendBudget(
      {
        ...test.call,
        input: {
          requestId: "after-scan-failure",
          deadlineAt: Date.now() + 10_000,
        },
      },
      context,
    );
    expect(granted).not.toHaveProperty("stopped");
    expect(granted.consumed).toEqual({ modelRequests: 0, toolEntries: 0 });
    expect(test.faux.state.callCount).toBe(0);
  });

  it("cannot reopen an unbudgeted runtime after the initial budget committed but the binding commit failed", async () => {
    const test = setup({
      modelRequests: 3,
      toolEntries: 3,
      modelConcurrency: 1,
    });
    const directory = await mkdtemp(
      join(tmpdir(), "frogie-budget-binding-window-"),
    );
    directories.push(directory);
    const path = join(directory, "session.sqlite");
    const storage = await openNodeSqliteStorage(path);
    const nativeCommit = storage.commit.bind(storage);
    let budgetId: import("@earendil-works/pi-durable").DocumentId | undefined;
    let bindingFailed = false;
    vi.spyOn(storage, "commit").mockImplementation(
      async (writes, callContext) => {
        const budget = writes.find(
          (write) =>
            write.type === "document.create" &&
            "initial" in write.content.value &&
            "consumed" in write.content.value,
        );
        if (
          budgetId !== undefined &&
          writes.some(
            (write) =>
              write.type === "document.create" &&
              "bindingHash" in write.content.value,
          )
        ) {
          bindingFailed = true;
          throw new Error(
            "Binding commit failed after durable budget initialization",
          );
        }
        const result = await nativeCommit(writes, callContext);
        if (budget?.type === "document.create") budgetId = budget.record.id;
        return result;
      },
    );
    await expect(
      openRuntime({ ...test.options, storage }, context),
    ).rejects.toThrow();
    expect(bindingFailed).toBe(true);
    if (budgetId === undefined)
      throw new Error(
        "The budget was not durably committed before binding failure",
      );
    const saved = await openNodeSqliteStorage(path);
    expect(
      (await saved.document(budgetId, "current", context))?.value,
    ).toMatchObject({
      initial: test.options.binding.budget,
      consumed: { modelRequests: 0, toolEntries: 0 },
    });
    await saved.close(context);
    const { budget: _budget, ...binding } = test.options.binding;
    const reopening = openRuntime(
      { ...test.options, binding, storage: await openNodeSqliteStorage(path) },
      context,
    ).then((runtime) => {
      runtimes.push(runtime);
      return runtime;
    });
    await expect(reopening).rejects.toMatchObject({ code: "binding_mismatch" });
    expect(test.faux.state.callCount).toBe(0);
  });

  it("fails closed on budget initialization and deadline persistence failures without dispatching models", async () => {
    vi.useFakeTimers();
    for (const phase of ["initialization", "deadline"] as const) {
      const test = setup({
        modelRequests: 3,
        toolEntries: 3,
        modelConcurrency: 1,
        deadlineAt: Date.now() + 1000,
      });
      const commit = test.options.storage.commit.bind(test.options.storage);
      let fail = phase === "initialization";
      let failed = false;
      vi.spyOn(test.options.storage, "commit").mockImplementation(
        (writes, callContext) => {
          if (
            fail &&
            writes.some(
              (write) =>
                write.type === "document.create" ||
                write.type === "document.change",
            )
          ) {
            failed = true;
            throw new Error("private-budget-persistence-failure");
          }
          return commit(writes, callContext);
        },
      );
      if (phase === "initialization") {
        await expect(openRuntime(test.options, context)).rejects.toMatchObject({
          code: "binding_mismatch",
        });
      } else {
        const runtime = await open(test.options);
        fail = true;
        await vi.advanceTimersByTimeAsync(1000);
        fail = false;
        await expect(
          runtime.service.submit(
            {
              ...test.call,
              input: {
                conversationId: runtime.root.id,
                submission: { type: "input", content: "After storage failure" },
              },
            },
            context,
          ),
        ).rejects.toThrow();
        await runtime.close(context);
      }
      expect(failed).toBe(true);
      expect(test.faux.state.callCount).toBe(0);
    }
  });

  it("rejects grants until cancellation of existing unmarked work is confirmed after scan or abort failures", async () => {
    for (const failure of [
      "inspect-error",
      "inspect-timeout",
      "abort-error",
      "abort-timeout",
    ] as const) {
      vi.useFakeTimers();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockImplementation((milliseconds) => {
          const controller = new AbortController();
          setTimeout(
            () =>
              controller.abort(
                new DOMException(
                  "Cancellation confirmation timed out",
                  "TimeoutError",
                ),
              ),
            milliseconds,
          );
          return controller.signal;
        });
      const limits = {
        modelRequests: 3,
        toolEntries: 3,
        modelConcurrency: 1,
        deadlineAt: Date.now() + 1000,
      };
      const test = setup(limits, 0);
      const run = vi.fn();
      const aborted = vi.fn();
      const task = defineTask<Record<string, never>, { phase: "hold" }, void>({
        name: "budget.cancel-confirmation",
        version: 1,
        initial: () => ({ phase: "hold" }),
        phases: {
          hold: async (_task, api, callContext) => {
            run();
            await api.commit(
              () => ({
                status: "terminal",
                outcome: { status: "completed", result: undefined },
              }),
              callContext,
            );
          },
        },
        abort: async (_task, api, callContext) => {
          aborted();
          await api.commit(
            () => ({ status: "terminal", outcome: { status: "aborted" } }),
            callContext,
          );
        },
      });
      test.registry.install(
        defineExtension({ name: "cancel-confirmation", tasks: [task] }),
      );
      const runtime = await open(test.options);
      const id = await runtime.harness.commit(
        (tx) =>
          tx.createTask(
            task,
            {},
            {
              ownership: { kind: "conversation" },
              conversationId: runtime.root.id,
              background: true,
            },
          ),
        context,
      );
      const published =
        deferred<import("@earendil-works/pi-durable").DocumentId>();
      const release = runtime.harness.subscribeCommits((publication) => {
        for (const change of publication.changes)
          if (
            change.type === "document" &&
            change.value &&
            "initial" in change.value &&
            "stopped" in change.value
          )
            published.resolve(change.record.id);
      });
      const inspect = runtime.harness.inspect.bind(runtime.harness);
      const cancellationStarted = deferred<void>();
      const scan = vi
        .spyOn(runtime.harness, "inspect")
        .mockImplementation((callContext) => {
          if (!failure.startsWith("inspect") || !callContext.abortSignal)
            return inspect(callContext);
          cancellationStarted.resolve();
          return failure.endsWith("timeout")
            ? new Promise((_resolve, reject) =>
                callContext.abortSignal?.addEventListener(
                  "abort",
                  () => reject(callContext.abortSignal?.reason),
                  { once: true },
                ),
              )
            : Promise.reject(new Error("private-cancellation-scan"));
        });
      const abortTask = runtime.harness.abortTask.bind(runtime.harness);
      const abort = vi
        .spyOn(runtime.harness, "abortTask")
        .mockImplementation((taskId, callContext) => {
          if (!failure.startsWith("abort"))
            return abortTask(taskId, callContext);
          cancellationStarted.resolve();
          return failure.endsWith("timeout")
            ? new Promise((_resolve, reject) =>
                callContext.abortSignal?.addEventListener(
                  "abort",
                  () => reject(callContext.abortSignal?.reason),
                  { once: true },
                ),
              )
            : Promise.reject(new Error("private-cancellation-abort"));
        });
      await vi.advanceTimersByTimeAsync(1000);
      const budgetId = await published.promise;
      await cancellationStarted.promise;
      const before = (
        await test.options.storage.document(budgetId, "current", context)
      )?.value;
      expect(before).toMatchObject({
        grants: [],
        stopped: { reason: "deadline" },
      });
      const grant = {
        requestId: "grant-after-cancellation",
        deadlineAt: Date.now() + 20_000,
      };
      const granting = runtime.service
        .extendBudget({ ...test.call, input: grant }, context)
        .then(
          (value) => ({ value, error: undefined }),
          (error: unknown) => ({ value: undefined, error }),
        );
      await vi.advanceTimersByTimeAsync(failure.endsWith("timeout") ? 5000 : 0);
      const result = await granting;
      expect(result.error).toMatchObject({ code: "runtime_unavailable" });
      expect((result.error as Error).message).not.toContain(
        "private-cancellation",
      );
      expect(
        (await test.options.storage.document(budgetId, "current", context))
          ?.value,
      ).toEqual(before);
      expect(await test.options.storage.task(id, context)).toMatchObject({
        abortRequested: false,
        state: { status: "pending" },
      });
      scan.mockRestore();
      abort.mockRestore();
      await vi.advanceTimersByTimeAsync(5000);
      const restored = await runtime.service.extendBudget(
        { ...test.call, input: grant },
        context,
      );
      expect(restored).not.toHaveProperty("stopped");
      expect(restored.consumed).toEqual({ modelRequests: 0, toolEntries: 0 });
      expect(await test.options.storage.task(id, context)).toMatchObject({
        abortRequested: true,
        state: { status: "pending" },
      });
      expect(
        (await runtime.service.inspect(test.call, context)).scheduling,
      ).toBe("paused");
      expect(run).not.toHaveBeenCalled();
      expect(aborted).not.toHaveBeenCalled();
      runtime.harness.resume();
      await vi.advanceTimersByTimeAsync(0);
      await runtime.harness.waitForTask(id, context);
      expect(
        (await test.options.storage.task(id, context))?.state,
      ).toMatchObject({
        status: "terminal",
        outcome: { status: "aborted" },
      });
      expect(run).not.toHaveBeenCalled();
      expect(aborted).toHaveBeenCalledOnce();
      expect(test.faux.state.callCount).toBe(0);
      release();
      await runtime.close(context);
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });

  it("authorizes budget grants and persists idempotency without resetting consumption or resuming paused execution", async () => {
    const limits = {
      modelRequests: 3,
      toolEntries: 5,
      modelConcurrency: 1,
      deadlineAt: Date.now() + 60_000,
    };
    const test = setup(limits);
    let allowed = true;
    const runtime = await open({
      ...test.options,
      authorization: async (call) =>
        call.operation !== "extendBudget" || allowed,
    });
    const grant = {
      requestId: "add-units",
      modelRequests: 2,
      toolEntries: 1,
      deadlineAt: limits.deadlineAt + 1000,
    };
    allowed = false;
    await expect(
      runtime.service.extendBudget({ ...test.call, input: grant }, context),
    ).rejects.toMatchObject({ code: "forbidden" });
    allowed = true;
    await expect(
      runtime.service.extendBudget(
        {
          ...test.call,
          scope: { ...test.call.scope, harnessId: "foreign" },
          input: grant,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "binding_mismatch" });
    const first = await runtime.service.extendBudget(
      { ...test.call, input: grant },
      context,
    );
    expect(first).toEqual({
      limits: {
        ...limits,
        modelRequests: 5,
        toolEntries: 6,
        deadlineAt: grant.deadlineAt,
      },
      consumed: { modelRequests: 0, toolEntries: 0 },
    });
    expect(
      await runtime.service.extendBudget(
        { ...test.call, input: grant },
        context,
      ),
    ).toEqual(first);
    await expect(
      runtime.service.extendBudget(
        { ...test.call, input: { ...grant, modelRequests: 3 } },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      runtime.service.extendBudget(
        { ...test.call, caller: { id: "different-owner" }, input: grant },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await runtime.service.inspect(test.call, context)).budget).toEqual(
      first,
    );
    expect((await runtime.service.inspect(test.call, context)).scheduling).toBe(
      "paused",
    );
    for (const input of [
      { requestId: "empty" },
      { requestId: "", modelRequests: 1 },
      { requestId: "😀".repeat(33), modelRequests: 1 },
      { requestId: "zero", modelRequests: 0 },
      { requestId: "negative", toolEntries: -1 },
      { requestId: "fractional", modelRequests: 1.5 },
      { requestId: "past-deadline", deadlineAt: limits.deadlineAt },
      { requestId: "overflow", modelRequests: Number.MAX_SAFE_INTEGER },
    ])
      await expect(
        runtime.service.extendBudget({ ...test.call, input }, context),
      ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      runtime.service.extendBudget(
        {
          ...test.call,
          caller: { id: "x".repeat(1024 * 1024) },
          input: { requestId: "oversized-ledger", modelRequests: 1 },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "output_limit" });
    expect((await runtime.service.inspect(test.call, context)).budget).toEqual(
      first,
    );
  });
});
