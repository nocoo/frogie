import { type ChildProcess, fork } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  BACKGROUND_CONTEXT as context,
  withAbortSignal,
} from "@earendil-works/chord/context";
import type {
  ConversationId,
  ConversationView,
  ConversationWatch,
} from "@earendil-works/pi-durable";
import type { RuntimeCall } from "@frogie/core/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HarnessConfiguration,
  HarnessProcess,
  runtimeFailure,
  type WorkerMessage,
  type WorkerRequest,
} from "./harnessProcess.js";

vi.mock("node:child_process", () => ({ fork: vi.fn() }));
const scope = {
  projectId: "test-project",
  environmentId: "e2e",
  squadId: "test-squad",
  harnessId: "test-harness",
};
const config: HarnessConfiguration = {
  directory: "/unused-harness-process-fixture",
  mode: "e2e",
  binding: {
    projectId: scope.projectId,
    scope,
    definition: { contentHash: "fixture-definition" },
  },
};
const call = { scope, caller: { id: "owner" }, input: {} };
const view = {
  conversation: { id: 17 as ConversationId },
  entries: [],
  docs: {},
} as ConversationView;
const processes: HarnessProcess[] = [];
const children: ReturnType<typeof childFixture>[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function childFixture() {
  const emitter = new EventEmitter();
  const send = vi.fn(
    (_message: WorkerRequest, callback?: (error: Error | null) => void) => {
      callback?.(null);
      return true;
    },
  );
  const child = Object.assign(emitter, {
    connected: true,
    send,
    kill: vi.fn((_signal: string) => true),
  });
  return {
    child,
    send,
    emit: (message: WorkerMessage) => emitter.emit("message", message),
  };
}

function fixture(ready = true) {
  const child = childFixture();
  children.push(child);
  vi.mocked(fork).mockReturnValueOnce(child.child as unknown as ChildProcess);
  const onFailure = vi.fn();
  const process = new HarnessProcess(config, onFailure);
  processes.push(process);
  if (ready) child.emit({ type: "ready", rootConversationId: 17 });
  return { ...child, process, onFailure };
}

function request(
  test: ReturnType<typeof fixture>,
): Extract<WorkerRequest, { type: "call" }> {
  const message = test.send.mock.calls.at(-1)?.[0];
  if (message?.type !== "call") throw new Error("Missing runtime call");
  return message;
}

async function openWatch(
  test: ReturnType<typeof fixture>,
  requestedContext = context,
): Promise<{ watch: ConversationWatch; id: number }> {
  const pending = test.process.service.observeConversation(
    { ...call, input: { conversationId: 17 as ConversationId } },
    requestedContext,
  );
  const id = request(test).id;
  test.emit({ type: "result", id, value: view });
  return { watch: await pending, id };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(async () => {
  for (const child of children.splice(0)) child.child.emit("exit", 0, null);
  await Promise.allSettled(
    processes.splice(0).map((process) => process.close()),
  );
  vi.useRealTimers();
});

describe("HarnessProcess", () => {
  it("forks a source worker with private IPC, initializes it and preserves ready root identity", async () => {
    const test = fixture();
    expect(await test.process.ready).toBe(17);
    expect(fork).toHaveBeenCalledWith(
      expect.stringMatching(/harnessWorker\.ts$/),
      [],
      {
        execArgv: ["--import", "tsx", "--conditions=frogie-source"],
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    expect(test.send).toHaveBeenCalledWith(
      { type: "initialize", config },
      expect.any(Function),
    );
    expect(test.onFailure).not.toHaveBeenCalled();
    expect(runtimeFailure("binding_mismatch", "Boundaries")).toMatchObject({
      code: "binding_mismatch",
      message: "Boundaries",
      retryable: false,
    });
  });

  it.each([
    "describe",
    "listConversations",
    "createConversation",
    "submit",
    "getSubmission",
    "cancel",
    "compact",
  ] as const)(
    "correlates the %s response with only its own pending request",
    async (operation) => {
      const test = fixture();
      const method = test.process.service[operation] as (
        input: typeof call,
        requestedContext: typeof context,
      ) => Promise<unknown>;
      const first = method(call, context);
      const firstId = request(test).id;
      const second = method(call, context);
      const secondId = request(test).id;
      test.emit({ type: "result", id: secondId, value: "second" });
      test.emit({ type: "result", id: 999, value: "unrelated" });
      test.emit({ type: "result", id: firstId, value: "first" });
      expect(await first).toBe("first");
      expect(await second).toBe("second");
    },
  );

  it("routes four inspection reads through their original scoped calls and preserves independent response and cancellation ownership", async () => {
    const test = fixture();
    const operations = [
      ["inspect", {}],
      ["listTasks", { conversationId: 17, limit: 50, cursor: "task-cursor" }],
      ["getTask", { taskId: 42 }],
      [
        "listEntries",
        { conversationId: 17, limit: 100, cursor: "entry-cursor" },
      ],
    ] as const;
    const requests = operations.map(([operation, input]) => {
      const method = test.process.service[operation] as (
        input: RuntimeCall<unknown>,
        requestedContext: typeof context,
      ) => Promise<unknown>;
      const original = { ...call, input };
      const pending = method(original, context);
      const sent = request(test);
      expect(sent.operation).toBe(operation);
      expect(sent.call).toBe(original);
      expect(sent.call).toEqual({ scope, caller: call.caller, input });
      return {
        method,
        original,
        pending,
        id: sent.id,
        value: { operation, marker: sent.id },
      };
    });
    expect(new Set(requests.map(({ id }) => id)).size).toBe(4);
    for (const { id, value } of [...requests].reverse())
      test.emit({ type: "result", id, value });
    expect(await Promise.all(requests.map(({ pending }) => pending))).toEqual(
      requests.map(({ value }) => value),
    );
    for (const { method, original } of requests) {
      const abort = new AbortController();
      const reason = new DOMException(
        "Inspection read cancelled",
        "AbortError",
      );
      const pending = method(original, withAbortSignal(abort.signal, context));
      const sent = request(test);
      expect(sent.call).toBe(original);
      const rejected = expect(pending).rejects.toBe(reason);
      abort.abort(reason);
      await rejected;
      expect(test.send).toHaveBeenLastCalledWith(
        { type: "cancel_request", id: sent.id },
        expect.any(Function),
      );
      test.emit({
        type: "result",
        id: sent.id,
        value: "late inspection result",
      });
      test.emit({
        type: "error",
        id: sent.id,
        error: {
          code: "not_found",
          message: "Late inspection error",
          retryable: false,
        },
      });
      const sentCount = test.send.mock.calls.length;
      await expect(
        method(original, withAbortSignal(abort.signal, context)),
      ).rejects.toBe(reason);
      await expect(
        method(
          { ...original, scope: { ...scope, harnessId: "foreign-harness" } },
          context,
        ),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
      expect(test.send).toHaveBeenCalledTimes(sentCount);
    }
    expect(test.onFailure).not.toHaveBeenCalled();
  });

  it.each(["projectId", "environmentId", "squadId", "harnessId"] as const)(
    "rejects mismatched %s before crossing IPC",
    async (field) => {
      const test = fixture();
      await expect(
        test.process.service.describe(
          { ...call, scope: { ...scope, [field]: "forged" } },
          context,
        ),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
      expect(test.send).toHaveBeenCalledTimes(1);
    },
  );

  it("passes a safe worker error to the exact request and ignores late replies after cancellation", async () => {
    const test = fixture();
    const failed = test.process.service.describe(call, context);
    const id = request(test).id;
    test.emit({
      type: "error",
      id,
      error: { code: "forbidden", message: "Not authorized", retryable: false },
    });
    await expect(failed).rejects.toMatchObject({
      code: "forbidden",
      message: "Not authorized",
    });
    const abort = new AbortController();
    const reason = new Error("Caller cancelled");
    const running = test.process.service.describe(
      call,
      withAbortSignal(abort.signal, context),
    );
    const cancelledId = request(test).id;
    abort.abort(reason);
    await expect(running).rejects.toBe(reason);
    expect(test.send).toHaveBeenLastCalledWith(
      { type: "cancel_request", id: cancelledId },
      expect.any(Function),
    );
    test.emit({ type: "result", id: cancelledId, value: "late" });
    await expect(
      test.process.service.describe(
        call,
        withAbortSignal(abort.signal, context),
      ),
    ).rejects.toBe(reason);
  });

  it("fails pending work and active watches when the child exits", async () => {
    const test = fixture();
    const { watch } = await openWatch(test);
    const running = test.process.service.describe(call, context);
    test.child.emit("exit", 1, null);
    await expect(running).rejects.toMatchObject({
      code: "runtime_unavailable",
    });
    expect(await watch.closed).toEqual({ reason: "session_closed" });
    expect(test.onFailure).toHaveBeenCalledOnce();
    await expect(
      test.process.service.describe(call, context),
    ).rejects.toMatchObject({ code: "runtime_unavailable" });
  });

  it("reports startup errors and disconnections without continuing to serve requests", async () => {
    const startup = fixture(false);
    const ready = expect(startup.process.ready).rejects.toMatchObject({
      code: "capability_missing",
    });
    startup.emit({
      type: "startup_error",
      error: {
        code: "capability_missing",
        message: "Unavailable extension",
        retryable: false,
      },
    });
    await ready;
    const disconnected = fixture();
    disconnected.child.connected = false;
    disconnected.child.emit("disconnect");
    expect(disconnected.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "runtime_unavailable",
        message: "Harness IPC connection was lost",
      }),
    );
    await expect(
      disconnected.process.service.describe(call, context),
    ).rejects.toMatchObject({ code: "runtime_unavailable" });
  });

  it("does not expose raw child process errors through ready, pending requests or public failure callbacks", async () => {
    const test = fixture(false);
    const ready = expect(test.process.ready).rejects.not.toThrow(
      "private-secret",
    );
    const pending = test.process.service.describe(call, context);
    const failure = expect(pending).rejects.not.toThrow("private-secret");
    test.child.emit("error", new Error("private-secret from /private/path"));
    await Promise.all([ready, failure]);
    expect(JSON.stringify(test.onFailure.mock.calls)).not.toContain(
      "private-secret",
    );
  });

  it("sanitizes a synchronous fork failure before exposing it to the caller", () => {
    vi.mocked(fork).mockImplementationOnce(() => {
      throw new Error("private-secret from fork");
    });
    const onFailure = vi.fn();
    expect(() => new HarnessProcess(config, onFailure)).toThrow(
      "Harness process could not start",
    );
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "runtime_unavailable",
        message: "Harness process could not start",
      }),
    );
  });

  it("handles repeated transport errors and synchronous send exceptions without leaking details", async () => {
    const test = fixture();
    test.send.mockImplementationOnce(() => {
      throw new Error("private-secret");
    });
    const failure = await test.process.service
      .describe(call, context)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "runtime_unavailable" });
    expect((failure as Error).message).not.toContain("private-secret");
    test.child.emit("error", new Error("Repeated private-secret"));
    expect(test.onFailure).toHaveBeenCalledOnce();
    test.child.emit("close");
    await test.process.close();
  });

  it.each([false, true])(
    "handles a process close event without an exit event (%s)",
    async (alreadyClosing) => {
      const test = fixture();
      const closing = alreadyClosing ? test.process.close() : undefined;
      test.child.emit("close");
      if (closing) await closing;
      else
        expect(test.onFailure).toHaveBeenCalledWith(
          expect.objectContaining({ message: "Harness process closed" }),
        );
      await test.process.close();
      expect(test.child.kill).not.toHaveBeenCalled();
    },
  );

  it("ignores callback errors and synchronous send errors once cleanup owns the process", async () => {
    const test = fixture();
    test.send.mockImplementationOnce(() => {
      throw new Error("Closing private-secret");
    });
    const closing = test.process.close();
    test.child.emit("exit", 0, null);
    await closing;
    expect(test.onFailure).not.toHaveBeenCalled();
    const callback = fixture();
    callback.send.mockImplementationOnce((_message, complete) => {
      complete?.(new Error("Closing callback secret"));
      return true;
    });
    const second = callback.process.close();
    callback.child.emit("close");
    await second;
    expect(callback.onFailure).not.toHaveBeenCalled();
    callback.emit({ type: "closed" });
    callback.emit({
      type: "error",
      id: 999,
      error: {
        code: "runtime_unavailable",
        message: "Late request",
        retryable: false,
      },
    });
  });

  it("fails a request if IPC send fails and does not wait forever for a reply", async () => {
    const test = fixture();
    test.send.mockImplementationOnce((_message, callback) => {
      callback?.(new Error("IPC private-secret"));
      return false;
    });
    const error = await test.process.service
      .describe(call, context)
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "runtime_unavailable" });
    expect((error as Error).message).not.toContain("private-secret");
    await expect(
      test.process.service.describe(call, context),
    ).rejects.toMatchObject({ code: "runtime_unavailable" });
    expect(JSON.stringify(test.onFailure.mock.calls)).not.toContain(
      "private-secret",
    );
  });

  it("rejects ready safely and promptly if the initialization IPC send fails", async () => {
    vi.useFakeTimers();
    const child = childFixture();
    children.push(child);
    child.send.mockImplementationOnce((_message, callback) => {
      callback?.(new Error("Initialization private-secret"));
      return false;
    });
    vi.mocked(fork).mockReturnValueOnce(child.child as unknown as ChildProcess);
    const onFailure = vi.fn();
    const process = new HarnessProcess(config, onFailure);
    processes.push(process);
    let result: unknown;
    const ready = process.ready.catch((error: unknown) => {
      result = error;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBeInstanceOf(Error);
    expect(result).toMatchObject({ code: "runtime_unavailable" });
    expect((result as Error).message).not.toContain("private-secret");
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain(
      "private-secret",
    );
    child.child.emit("exit", 1, null);
    await ready;
  });

  it("buffers the first update until start and waits for the listener before ACK", async () => {
    const test = fixture();
    const { watch, id } = await openWatch(test);
    const next = { ...view, docs: { marker: { value: "next" } } };
    test.emit({ type: "watch", id, value: next, ops: [] });
    expect(watch.value).toEqual(view);
    const pending = deferred<void>();
    const listener = vi.fn(async () => pending.promise);
    watch.start(listener);
    expect(listener).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    expect(watch.value).toEqual(next);
    expect(
      test.send.mock.calls.some(([message]) => message.type === "ack_watch"),
    ).toBe(false);
    pending.resolve();
    await vi.waitFor(() =>
      expect(test.send).toHaveBeenLastCalledWith(
        { type: "ack_watch", id },
        expect.any(Function),
      ),
    );
    expect(() => watch.start(listener)).toThrow("already started");
    expect(await watch.stop()).toEqual({ reason: "stopped" });
    expect(await watch.stop()).toEqual({ reason: "stopped" });
    test.emit({ type: "watch", id, value: view, ops: [] });
    expect(listener).toHaveBeenCalledOnce();
    expect(() => watch.start(listener)).toThrow();
  });

  it.each(["consumer failed", new Error("consumer failed")])(
    "turns listener exceptions into a watch terminal error and stops only that watch (%#)",
    async (error) => {
      const test = fixture();
      const { watch, id } = await openWatch(test);
      watch.start(async () => {
        throw error;
      });
      test.emit({ type: "watch", id, value: view, ops: [] });
      expect(await watch.closed).toMatchObject({
        reason: "listener_error",
        error: { message: "consumer failed" },
      });
      expect(test.send).toHaveBeenLastCalledWith(
        { type: "stop_watch", id },
        expect.any(Function),
      );
      const next = test.process.service.describe(call, context);
      test.emit({ type: "result", id: request(test).id, value: "healthy" });
      expect(await next).toBe("healthy");
    },
  );

  it("propagates worker watch termination and aborts an observer without cancelling unrelated work", async () => {
    const test = fixture();
    const abort = new AbortController();
    const { watch, id } = await openWatch(
      test,
      withAbortSignal(abort.signal, context),
    );
    abort.abort();
    expect(await watch.closed).toEqual({ reason: "cancelled" });
    expect(test.send).toHaveBeenLastCalledWith(
      { type: "stop_watch", id },
      expect.any(Function),
    );
    const other = await openWatch(test);
    test.emit({
      type: "watch_closed",
      id: other.id,
      end: {
        reason: "listener_error",
        error: Object.assign(new Error("Worker listener failed"), {
          code: "runtime_unavailable",
        }),
      },
    });
    expect(await other.watch.closed).toMatchObject({
      reason: "listener_error",
      error: { message: "Worker listener failed" },
    });
    const stopped = await openWatch(test);
    test.emit({
      type: "watch_closed",
      id: stopped.id,
      end: { reason: "retired" },
    });
    expect(await stopped.watch.closed).toEqual({ reason: "retired" });
  });

  it("cleans up a watch if acquisition fails or its context is already cancelled", async () => {
    const test = fixture();
    const acquiring = test.process.service.observeConversation(
      { ...call, input: { conversationId: 17 as ConversationId } },
      context,
    );
    const id = request(test).id;
    test.emit({
      type: "error",
      id,
      error: {
        code: "not_found",
        message: "Missing conversation",
        retryable: false,
      },
    });
    await expect(acquiring).rejects.toMatchObject({ code: "not_found" });
    expect(test.send).toHaveBeenLastCalledWith(
      { type: "stop_watch", id },
      expect.any(Function),
    );
    const abort = new AbortController();
    abort.abort(new Error("No longer observing"));
    await expect(
      test.process.service.observeConversation(
        { ...call, input: { conversationId: 17 as ConversationId } },
        withAbortSignal(abort.signal, context),
      ),
    ).rejects.toThrow("No longer observing");
  });

  it.each(["abort", "close"] as const)(
    "terminates an observer if %s occurs just after the acquisition result",
    async (operation) => {
      const test = fixture();
      const abort = new AbortController();
      const pending = test.process.service.observeConversation(
        { ...call, input: { conversationId: 17 as ConversationId } },
        withAbortSignal(abort.signal, context),
      );
      const id = request(test).id;
      test.emit({ type: "result", id, value: view });
      if (operation === "abort") abort.abort();
      else {
        void test.process.close();
        test.child.emit("exit", 0, null);
      }
      const watch = await pending;
      expect(await watch.closed).toEqual({
        reason: operation === "abort" ? "cancelled" : "session_closed",
      });
      expect(() => watch.start(async () => undefined)).toThrow(
        "Watch is stopped",
      );
    },
  );

  it("suppresses a queued frame when the observer is stopped before its microtask executes", async () => {
    const test = fixture();
    const { watch, id } = await openWatch(test);
    const listener = vi.fn(async () => undefined);
    watch.start(listener);
    test.emit({ type: "watch", id, value: view, ops: [] });
    await watch.stop();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    test.emit({ type: "watch_closed", id: 999, end: { reason: "stopped" } });
    expect(await watch.closed).toEqual({ reason: "stopped" });
  });

  it("finishes bounded cleanup when the child exits after SIGTERM without escalating again", async () => {
    vi.useFakeTimers();
    const test = fixture();
    const closing = test.process.close();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(test.child.kill).toHaveBeenCalledWith("SIGTERM");
    test.child.emit("exit", null, "SIGTERM");
    await closing;
    expect(test.child.kill).toHaveBeenCalledTimes(1);
  });

  it("rejects startup after 10 seconds and closes with bounded SIGTERM/SIGKILL escalation", async () => {
    vi.useFakeTimers();
    const test = fixture(false);
    const ready = expect(test.process.ready).rejects.toMatchObject({
      code: "runtime_unavailable",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await ready;
    expect(test.onFailure).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(test.child.kill).toHaveBeenLastCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(2_500);
    expect(test.child.kill).toHaveBeenLastCalledWith("SIGKILL");
    test.child.emit("exit", null, "SIGKILL");
    await test.process.close();
  });

  it("closes concurrently once, handles graceful exit and rejects commands while closing", async () => {
    const test = fixture();
    const first = test.process.close();
    expect(test.process.close()).toBe(first);
    await expect(
      test.process.service.describe(call, context),
    ).rejects.toMatchObject({ code: "runtime_unavailable" });
    test.child.emit("disconnect");
    test.child.emit("exit", 0, null);
    await first;
    expect(test.child.kill).not.toHaveBeenCalled();
    expect(
      test.send.mock.calls.filter(([message]) => message.type === "close"),
    ).toHaveLength(1);
    expect(test.onFailure).not.toHaveBeenCalled();
  });

  it("fails bounded cleanup if its owned process never exits", async () => {
    vi.useFakeTimers();
    const test = fixture();
    const closing = test.process.close();
    const failed = expect(closing).rejects.toThrow("cleanup exceeded");
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(test.child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
  });
});
