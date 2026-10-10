import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type {
  ConversationId,
  ConversationView,
  ConversationWatch,
  WatchEnd,
} from "@earendil-works/pi-durable";
import { DefinitionError, loadDefinition } from "@frogie/core/definitions";
import type { RuntimeCall } from "@frogie/core/protocol";
import type { RuntimeHandle } from "@frogie/core/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { daemonModelServer } from "../../../tests/fixtures/daemon-model-server.js";
import type {
  HarnessConfiguration,
  WorkerMessage,
  WorkerRequest,
} from "./harnessProcess.js";
import {
  createWorkerTransport,
  launchHarnessWorker,
  openHarnessRuntime,
  workerFailure,
} from "./harnessWorker.js";

const source = fileURLToPath(
  new URL("../../../tests/fixtures/minimal-squad", import.meta.url),
);
const scope = {
  projectId: "frogie",
  environmentId: "e2e",
  squadId: "minimal-squad",
  harnessId: "worker-harness",
};
const call = { scope, caller: { id: "worker-owner" }, input: {} };
const view = {
  conversation: { id: 17 as ConversationId },
  entries: [],
  docs: {},
} as ConversationView;
const config: HarnessConfiguration = {
  directory: "/unused-test-directory",
  mode: "e2e",
  binding: {
    projectId: scope.projectId,
    scope,
    definition: { contentHash: "fixture-hash" },
    environment: {
      model: { provider: "fixture", modelId: "test" },
      thinkingLevel: "low",
    },
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeRuntime() {
  const ended = deferred<WatchEnd>();
  const watch: ConversationWatch = {
    value: view,
    start: vi.fn(),
    stop: vi.fn(async () => {
      ended.resolve({ reason: "stopped" });
      return { reason: "stopped" } as WatchEnd;
    }),
    closed: ended.promise,
  };
  const service = {
    describe: vi.fn(
      async (_call: RuntimeCall<unknown>, _context: typeof context) => ({
        marker: "runtime-result",
      }),
    ),
    observeConversation: vi.fn(async () => watch),
  };
  const close = vi.fn(async () => {
    ended.resolve({ reason: "session_closed" });
  });
  const runtime = {
    service,
    root: { id: 17 },
    close,
  } as unknown as RuntimeHandle;
  return { runtime, service, close, watch, ended };
}

function transportFixture() {
  const test = fakeRuntime();
  const messages: WorkerMessage[] = [];
  const send = vi.fn((message: WorkerMessage) => {
    messages.push(message);
  });
  const exit = vi.fn();
  const open = vi.fn(async () => test.runtime);
  const transport = createWorkerTransport({ send, exit, open });
  return { ...test, messages, send, exit, open, transport };
}

async function initialize(test: ReturnType<typeof transportFixture>) {
  await test.transport.receive({ type: "initialize", config });
  expect(test.messages.at(-1)).toEqual({
    type: "ready",
    rootConversationId: 17,
  });
}

async function observe(test: ReturnType<typeof transportFixture>, id = 1) {
  await test.transport.receive({
    type: "call",
    id,
    operation: "observeConversation",
    call: { ...call, input: { conversationId: 17 } },
  });
  expect(test.messages.at(-1)).toEqual({ type: "result", id, value: view });
}

const roots: string[] = [];
const runtimes: RuntimeHandle[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close(context);
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function runtimeConfig(): Promise<HarnessConfiguration> {
  const directory = await mkdtemp(join(tmpdir(), "frogie-worker-test-"));
  roots.push(directory);
  await cp(source, join(directory, "definition"), { recursive: true });
  const definition = loadDefinition(join(directory, "definition"));
  const input = {
    ...config,
    directory,
    binding: {
      ...config.binding,
      definition: { contentHash: definition.contentHash },
    },
  };
  await writeFile(
    join(directory, "binding.json"),
    JSON.stringify(input.binding),
  );
  return input;
}

describe("worker failures", () => {
  it.each([
    "binding_mismatch",
    "capability_missing",
    "not_found",
    "forbidden",
    "invalid_request",
    "unknown",
  ])(
    "retains only safe classifications and never exposes error details (%s)",
    (code) => {
      const error = workerFailure(
        Object.assign(new Error("api-key=private-secret /private/path"), {
          code,
        }),
      );
      expect(error.code).toBe(
        code === "unknown" ? "runtime_unavailable" : code,
      );
      expect(error.retryable).toBe(false);
      expect(JSON.stringify(error)).not.toMatch(/private-secret|private\/path/);
    },
  );
  it("normalizes non-Errors and definition diagnostics", () => {
    expect(workerFailure("private-secret")).toMatchObject({
      code: "runtime_unavailable",
      message: "Harness operation failed",
    });
    expect(
      workerFailure(
        new DefinitionError({
          code: "bad_role",
          message: "private-secret",
          path: "/private/path",
        }),
      ),
    ).toEqual({
      code: "invalid_definition",
      message: "Squad definition is invalid",
      retryable: false,
    });
  });
});

describe("worker transport", () => {
  it("initializes once, routes a result and closes concurrently once", async () => {
    const test = transportFixture();
    await initialize(test);
    await test.transport.receive({ type: "initialize", config });
    expect(test.open).toHaveBeenCalledOnce();
    expect(test.messages.at(-1)).toMatchObject({ type: "startup_error" });
    await test.transport.receive({
      type: "call",
      id: 1,
      operation: "describe",
      call,
    });
    expect(test.service.describe).toHaveBeenCalledWith(call, expect.anything());
    expect(test.messages.at(-1)).toEqual({
      type: "result",
      id: 1,
      value: { marker: "runtime-result" },
    });
    await Promise.all([
      test.transport.close(),
      test.transport.close(),
      test.transport.receive({ type: "close" }),
    ]);
    expect(test.close).toHaveBeenCalledOnce();
    expect(test.exit).toHaveBeenCalledOnce();
    expect(
      test.messages.filter((message) => message.type === "closed"),
    ).toHaveLength(1);
    await test.transport.receive({
      type: "call",
      id: 2,
      operation: "describe",
      call,
    });
    expect(test.messages.at(-1)).toMatchObject({
      type: "error",
      id: 2,
      error: { code: "runtime_unavailable" },
    });
  });

  it("waits for initialization before closing and never publishes ready after close", async () => {
    const test = transportFixture();
    const pending = deferred<RuntimeHandle>();
    test.open.mockReturnValueOnce(pending.promise);
    const starting = test.transport.receive({ type: "initialize", config });
    const closing = test.transport.close();
    pending.resolve(test.runtime);
    await Promise.all([starting, closing]);
    expect(test.close).toHaveBeenCalledOnce();
    expect(test.messages.some((message) => message.type === "ready")).toBe(
      false,
    );
    expect(test.exit).toHaveBeenCalledOnce();
    await test.transport.receive({ type: "initialize", config });
    expect(test.open).toHaveBeenCalledOnce();
  });

  it("reports initialization and cleanup failures using safe messages", async () => {
    const test = transportFixture();
    test.open.mockRejectedValueOnce(new Error("private-secret"));
    await test.transport.receive({ type: "initialize", config });
    await test.transport.close();
    expect(test.messages).toContainEqual({
      type: "startup_error",
      error: workerFailure(new Error()),
    });
    expect(test.exit).toHaveBeenCalledOnce();
    const cleanup = transportFixture();
    await initialize(cleanup);
    cleanup.close.mockRejectedValueOnce(new Error("private-secret"));
    await cleanup.transport.close();
    expect(cleanup.messages.at(-2)).toEqual({
      type: "startup_error",
      error: workerFailure(new Error()),
    });
    expect(cleanup.exit).toHaveBeenCalledOnce();
  });

  it("rejects calls before initialization and sanitizes operation failures", async () => {
    const test = transportFixture();
    await test.transport.receive({
      type: "call",
      id: 1,
      operation: "describe",
      call,
    });
    expect(test.messages.at(-1)).toMatchObject({ type: "error", id: 1 });
    await initialize(test);
    test.service.describe.mockRejectedValueOnce(
      Object.assign(new Error("private-secret"), { code: "forbidden" }),
    );
    await test.transport.receive({
      type: "call",
      id: 2,
      operation: "describe",
      call,
    });
    expect(test.messages.at(-1)).toMatchObject({
      type: "error",
      id: 2,
      error: { code: "forbidden" },
    });
    await test.transport.receive({
      type: "unknown",
    } as unknown as WorkerRequest);
    await test.transport.close();
  });

  it.each(["result", "start"] as const)(
    "stops a newly acquired watch if sending its %s throws",
    async (phase) => {
      const test = transportFixture();
      await initialize(test);
      if (phase === "result")
        test.send.mockImplementationOnce(() => {
          throw new Error("Transport failed");
        });
      else
        vi.mocked(test.watch.start).mockImplementationOnce(() => {
          throw new Error("Listener installation failed");
        });
      await test.transport.receive({
        type: "call",
        id: 1,
        operation: "observeConversation",
        call: { ...call, input: { conversationId: 17 } },
      });
      expect(test.watch.stop).toHaveBeenCalledOnce();
      expect(test.messages.at(-1)).toMatchObject({ type: "error", id: 1 });
      await test.transport.close();
    },
  );

  it("aborts an ordinary in-flight operation on cancel_request", async () => {
    const test = transportFixture();
    await initialize(test);
    test.service.describe.mockImplementationOnce(
      async (_call, requestedContext) =>
        new Promise((_resolve, reject) =>
          requestedContext.abortSignal?.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        ),
    );
    const running = test.transport.receive({
      type: "call",
      id: 1,
      operation: "describe",
      call,
    });
    await test.transport.receive({ type: "cancel_request", id: 1 });
    await running;
    expect(test.messages.at(-1)).toMatchObject({ type: "error", id: 1 });
    await test.transport.receive({ type: "cancel_request", id: 999 });
    await test.transport.close();
  });

  it("keeps a watch update pending until ACK and releases it on stop", async () => {
    const test = transportFixture();
    await initialize(test);
    await observe(test);
    const listener = vi.mocked(test.watch.start).mock.calls[0]?.[0];
    if (!listener) throw new Error("Missing worker watch listener");
    const next = { ...view, docs: { marker: { value: "next" } } };
    let settled = false;
    const update = listener(next, [], context).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(test.messages.at(-1)).toEqual({
      type: "watch",
      id: 1,
      value: next,
      ops: [],
    });
    await test.transport.receive({ type: "ack_watch", id: 1 });
    await update;
    expect(settled).toBe(true);
    const held = listener(view, [], context);
    await test.transport.receive({ type: "stop_watch", id: 1 });
    await held;
    expect(test.watch.stop).toHaveBeenCalledOnce();
    await listener(next, [], context);
    await test.transport.receive({ type: "stop_watch", id: 999 });
    await test.transport.receive({ type: "ack_watch", id: 999 });
    await test.transport.close();
  });

  it.each(["cancel", "close"] as const)(
    "stops an acquired watch if %s occurs during acquisition",
    async (operation) => {
      const test = transportFixture();
      await initialize(test);
      const pending = deferred<ConversationWatch>();
      test.service.observeConversation.mockReturnValueOnce(pending.promise);
      const watching = test.transport.receive({
        type: "call",
        id: 1,
        operation: "observeConversation",
        call: { ...call, input: { conversationId: 17 } },
      });
      if (operation === "cancel")
        await test.transport.receive({ type: "stop_watch", id: 1 });
      else await test.transport.close();
      pending.resolve(test.watch);
      await watching;
      expect(test.watch.stop).toHaveBeenCalledOnce();
      expect(test.messages.at(-1)).toMatchObject({ type: "error", id: 1 });
      await test.transport.close();
    },
  );

  it("sanitizes a watch listener failure and unblocks pending ACK on close", async () => {
    const test = transportFixture();
    await initialize(test);
    await observe(test);
    test.ended.resolve({
      reason: "listener_error",
      error: new Error("private-secret"),
    });
    await Promise.resolve();
    const end = test.messages.at(-1);
    expect(end).toMatchObject({
      type: "watch_closed",
      end: {
        reason: "listener_error",
        error: {
          code: "runtime_unavailable",
          message: "Harness operation failed",
        },
      },
    });
    expect(JSON.stringify(end)).not.toContain("private-secret");
    await test.transport.close();
    const held = transportFixture();
    await initialize(held);
    await observe(held);
    const listener = vi.mocked(held.watch.start).mock.calls[0]?.[0];
    const update = listener?.(view, [], context);
    await held.transport.close();
    await update;
    expect(held.close).toHaveBeenCalledOnce();
  });
});

describe("worker process entry", () => {
  it("wires process messages, disconnection and SIGTERM with safe IPC and a single exit", async () => {
    const handlers = new Map<string, (...arguments_: unknown[]) => void>();
    const on = vi.spyOn(process, "on").mockImplementation(((
      event: string,
      listener: (...arguments_: unknown[]) => void,
    ) => {
      handlers.set(event, listener);
      return process;
    }) as typeof process.on);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const previousConnected = Object.getOwnPropertyDescriptor(
      process,
      "connected",
    );
    const previousSend = Object.getOwnPropertyDescriptor(process, "send");
    const send = vi.fn();
    Object.defineProperty(process, "connected", {
      value: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process, "send", {
      value: send,
      configurable: true,
      writable: true,
    });
    try {
      launchHarnessWorker();
      expect([...handlers.keys()]).toEqual([
        "message",
        "disconnect",
        "SIGTERM",
      ]);
      handlers.get("message")?.({
        type: "call",
        id: 1,
        operation: "describe",
        call,
      });
      await Promise.resolve();
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          id: 1,
          error: {
            code: "runtime_unavailable",
            message: "Harness operation failed",
            retryable: false,
          },
        }),
      );
      send.mockImplementationOnce(() => {
        throw new Error("private-secret");
      });
      handlers.get("message")?.({
        type: "call",
        id: 2,
        operation: "describe",
        call,
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(send).toHaveBeenLastCalledWith({
        type: "startup_error",
        error: workerFailure(new Error()),
      });
      Reflect.set(process, "connected", false);
      send.mockClear();
      handlers.get("message")?.({
        type: "call",
        id: 3,
        operation: "describe",
        call,
      });
      await Promise.resolve();
      expect(send).not.toHaveBeenCalled();
      handlers.get("disconnect")?.();
      handlers.get("SIGTERM")?.();
      await Promise.resolve();
      expect(exit).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      on.mockRestore();
      exit.mockRestore();
      if (previousConnected)
        Object.defineProperty(process, "connected", previousConnected);
      else Reflect.deleteProperty(process, "connected");
      if (previousSend) Object.defineProperty(process, "send", previousSend);
      else Reflect.deleteProperty(process, "send");
    }
  });
});

describe("worker runtime assembly", () => {
  it("opens real Pi SQLite with the no-cost model and preserves history on reopen", async () => {
    const input = await runtimeConfig();
    const runtime = await openHarnessRuntime(input);
    runtimes.push(runtime);
    const watch = await runtime.service.observeConversation(
      { ...call, input: { conversationId: runtime.root.id } },
      context,
    );
    try {
      const observed = deferred<ConversationView>();
      watch.start(async (value) => {
        if (JSON.stringify(value.entries).includes("Local Pi test reply"))
          observed.resolve(value);
      });
      await runtime.service.submit(
        {
          ...call,
          input: {
            conversationId: runtime.root.id,
            submission: { type: "input", content: "Worker persisted turn" },
          },
        },
        context,
      );
      const entries = (await observed.promise).entries;
      await watch.stop();
      await runtime.close(context);
      const reopened = await openHarnessRuntime(input);
      runtimes.push(reopened);
      expect(reopened.root.id).toBe(runtime.root.id);
      const restored = await reopened.service.observeConversation(
        { ...call, input: { conversationId: reopened.root.id } },
        context,
      );
      expect(restored.value.entries).toEqual(entries);
      await restored.stop();
      expect(
        (await readFile(join(input.directory, "session.sqlite")))
          .subarray(0, 16)
          .toString(),
      ).toBe("SQLite format 3\u0000");
    } finally {
      await watch.stop();
    }
  });

  it.each(["binding", "definition", "capability", "missing-model"] as const)(
    "rejects %s assembly errors before starting an executable runtime",
    async (failure) => {
      let input = await runtimeConfig();
      if (failure === "binding")
        await writeFile(
          join(input.directory, "binding.json"),
          JSON.stringify({ ...input.binding, projectId: "other" }),
        );
      if (failure === "definition")
        await writeFile(
          join(input.directory, "definition", "SQUAD.md"),
          "invalid definition",
        );
      if (failure === "capability") {
        input = {
          ...input,
          binding: {
            ...input.binding,
            environment: { model: { provider: "fixture", modelId: "missing" } },
          },
        };
        await writeFile(
          join(input.directory, "binding.json"),
          JSON.stringify(input.binding),
        );
      }
      if (failure === "missing-model") input = { ...input, mode: "local" };
      await expect(openHarnessRuntime(input)).rejects.toThrow();
    },
  );

  it("uses a real local provider adapter against the owned no-cost loopback fixture", async () => {
    const server = await daemonModelServer();
    server.release();
    let input = await runtimeConfig();
    input = {
      ...input,
      mode: "local",
      model: server.model,
      binding: {
        ...input.binding,
        environment: {
          model: { provider: "local-model", modelId: server.model.modelId },
          thinkingLevel: "off",
        },
      },
    };
    await writeFile(
      join(input.directory, "binding.json"),
      JSON.stringify(input.binding),
    );
    try {
      const runtime = await openHarnessRuntime(input);
      runtimes.push(runtime);
      const submission = await runtime.service.submit(
        {
          ...call,
          input: {
            conversationId: runtime.root.id,
            submission: { type: "input", content: "Local worker model" },
          },
        },
        context,
      );
      const settled = await (
        await runtime.harness.submission(submission, context)
      )?.wait(context);
      expect(settled?.status).toBe("done");
      expect(server.requests).toHaveLength(1);
      await runtime.close(context);
    } finally {
      await server.close();
    }
  });
});
