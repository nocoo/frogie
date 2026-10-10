import { type ChildProcess, fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Op } from "@earendil-works/chord/delta";
import type {
  ConversationView,
  ConversationWatch,
  WatchEnd,
} from "@earendil-works/pi-durable";
import type {
  ProjectBinding,
  RuntimeCall,
  RuntimeError,
  RuntimeService,
} from "@frogie/core/protocol";
import type { LocalModelConfig } from "./server/localRuntime.js";

export interface HarnessConfiguration {
  readonly directory: string;
  readonly binding: ProjectBinding;
  readonly mode: "local" | "e2e";
  readonly model?: LocalModelConfig;
  readonly approvedScripts?: readonly string[];
}

export type WorkerRequest =
  | { type: "initialize"; config: HarnessConfiguration }
  | { type: "close" }
  | { type: "cancel_request" | "stop_watch" | "ack_watch"; id: number }
  | {
      type: "call";
      id: number;
      operation: keyof RuntimeService;
      call: RuntimeCall<unknown>;
    };

export type WorkerMessage =
  | { type: "ready"; rootConversationId: number }
  | { type: "startup_error"; error: RuntimeError }
  | { type: "closed" }
  | { type: "result"; id: number; value: unknown }
  | { type: "error"; id: number; error: RuntimeError }
  | { type: "watch"; id: number; value: ConversationView; ops: readonly Op[] }
  | { type: "watch_closed"; id: number; end: WatchEnd };

export function runtimeFailure(
  code: string,
  message: string,
): Error & RuntimeError {
  return Object.assign(new Error(message), { code, retryable: false });
}

const matches = (
  a: ProjectBinding["scope"],
  b: ProjectBinding["scope"],
): boolean =>
  a.projectId === b.projectId &&
  a.environmentId === b.environmentId &&
  a.squadId === b.squadId &&
  a.harnessId === b.harnessId;

export class HarnessProcess {
  readonly service: RuntimeService;
  readonly ready: Promise<number>;
  readonly #child: ChildProcess;
  readonly #config: HarnessConfiguration;
  readonly #pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: unknown): void;
      cleanup(): void;
    }
  >();
  readonly #watches = new Map<
    number,
    {
      deliver(value: ConversationView, ops: readonly Op[]): void;
      finish(end: WatchEnd): void;
    }
  >();
  readonly #exited: Promise<void>;
  readonly #transportFailure: (message: string) => void;
  #id = 0;
  #unavailable = false;
  #closing: Promise<void> | undefined;

  constructor(
    config: HarnessConfiguration,
    onFailure: (error: RuntimeError) => void,
  ) {
    this.#config = config;
    try {
      this.#child = fork(
        fileURLToPath(new URL("./harnessWorker.ts", import.meta.url)),
        [],
        {
          execArgv: ["--import", "tsx", "--conditions=frogie-source"],
          serialization: "advanced",
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
    } catch {
      const error = runtimeFailure(
        "runtime_unavailable",
        "Harness process could not start",
      );
      onFailure(error);
      throw error;
    }
    let resolveReady!: (value: number) => void;
    let rejectReady!: (error: unknown) => void;
    this.ready = new Promise<number>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const startup = setTimeout(() => {
      const error = runtimeFailure(
        "runtime_unavailable",
        "Harness startup exceeded 10 seconds",
      );
      rejectReady(error);
      onFailure(error);
      void this.close().catch(() => undefined);
    }, 10_000);
    this.#transportFailure = (message) => {
      if (this.#unavailable) return;
      clearTimeout(startup);
      const error = runtimeFailure("runtime_unavailable", message);
      this.#fail(error);
      rejectReady(error);
      onFailure(error);
      void this.close().catch(() => undefined);
    };
    this.#exited = new Promise<void>((resolve) => {
      this.#child.once("exit", (code, signal) => {
        clearTimeout(startup);
        const unexpected = !this.#closing && !this.#unavailable;
        const error = runtimeFailure(
          "runtime_unavailable",
          `Harness exited (${signal ?? code})`,
        );
        this.#fail(error);
        rejectReady(error);
        if (unexpected) onFailure(error);
        resolve();
      });
      this.#child.once("close", () => {
        clearTimeout(startup);
        if (!this.#closing) this.#transportFailure("Harness process closed");
        resolve();
      });
      this.#child.on("error", () => {
        this.#transportFailure("Harness process failed");
      });
    });
    this.#child.once("disconnect", () => {
      if (this.#closing) return;
      this.#transportFailure("Harness IPC connection was lost");
    });
    this.#child.on("message", (message: WorkerMessage) => {
      if (message.type === "ready") {
        clearTimeout(startup);
        resolveReady(message.rootConversationId);
      } else if (message.type === "startup_error") {
        clearTimeout(startup);
        rejectReady(
          Object.assign(new Error(message.error.message), message.error),
        );
      } else if (message.type === "result" || message.type === "error") {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        pending?.cleanup();
        if (message.type === "result") pending?.resolve(message.value);
        else
          pending?.reject(
            Object.assign(new Error(message.error.message), message.error),
          );
      } else if (message.type === "watch")
        this.#watches.get(message.id)?.deliver(message.value, message.ops);
      else if (message.type === "watch_closed")
        this.#watches.get(message.id)?.finish(
          message.end.reason === "listener_error"
            ? {
                reason: message.end.reason,
                error: Object.assign(
                  new Error(message.end.error.message),
                  message.end.error,
                ),
              }
            : message.end,
        );
    });
    this.#send({ type: "initialize", config });
    this.service = {
      inspect: (call, context) => this.#call("inspect", call, context),
      listEntries: (call, context) => this.#call("listEntries", call, context),
      listTasks: (call, context) => this.#call("listTasks", call, context),
      getTask: (call, context) => this.#call("getTask", call, context),
      describe: (call, context) => this.#call("describe", call, context),
      listConversations: (call, context) =>
        this.#call("listConversations", call, context),
      createConversation: (call, context) =>
        this.#call("createConversation", call, context),
      submit: (call, context) => this.#call("submit", call, context),
      getSubmission: (call, context) =>
        this.#call("getSubmission", call, context),
      cancel: (call, context) => this.#call("cancel", call, context),
      compact: (call, context) => this.#call("compact", call, context),
      observeConversation: (call, context) => this.#watch(call, context),
    };
  }

  #send(message: WorkerRequest): void {
    if (!this.#child.connected) {
      if (!this.#closing)
        this.#transportFailure("Harness IPC connection was lost");
      return;
    }
    try {
      this.#child.send(message, (error) => {
        if (error && !this.#closing)
          this.#transportFailure("Harness IPC delivery failed");
      });
    } catch {
      if (!this.#closing) this.#transportFailure("Harness IPC delivery failed");
    }
  }

  #fail(error: unknown): void {
    this.#unavailable = true;
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.#pending.clear();
    for (const watch of this.#watches.values())
      watch.finish({ reason: "session_closed" });
  }

  #call<T>(
    operation: keyof RuntimeService,
    call: RuntimeCall<unknown>,
    context: Context,
    id = ++this.#id,
  ): Promise<T> {
    if (!matches(call.scope, this.#config.binding.scope))
      return Promise.reject(
        runtimeFailure("binding_mismatch", "Runtime scope does not match"),
      );
    if (this.#unavailable || this.#closing)
      return Promise.reject(
        runtimeFailure("runtime_unavailable", "Harness is not running"),
      );
    if (context.abortSignal?.aborted)
      return Promise.reject(context.abortSignal.reason);
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.#send({ type: "cancel_request", id });
        this.#pending.delete(id);
        reject(context.abortSignal?.reason);
      };
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        cleanup: () => context.abortSignal?.removeEventListener("abort", abort),
      });
      context.abortSignal?.addEventListener("abort", abort, { once: true });
      this.#send({ type: "call", id, operation, call });
    });
  }

  async #watch(
    call: Parameters<RuntimeService["observeConversation"]>[0],
    context: Context,
  ): Promise<ConversationWatch> {
    const id = ++this.#id;
    let value!: ConversationView;
    let listener: Parameters<ConversationWatch["start"]>[0] | undefined;
    let started = false;
    let end: WatchEnd | undefined;
    let frame: { value: ConversationView; ops: readonly Op[] } | undefined;
    let start!: ConversationWatch["start"];
    let stop!: ConversationWatch["stop"];
    const closed = new Promise<WatchEnd>((resolve) => {
      const finish = (result: WatchEnd) => {
        if (end) return;
        end = result;
        context.abortSignal?.removeEventListener("abort", abort);
        this.#watches.delete(id);
        resolve(result);
      };
      const deliver = () => {
        if (!listener || !frame || end) return;
        const current = frame;
        frame = undefined;
        queueMicrotask(() => {
          if (end) return;
          value = current.value;
          void Promise.resolve()
            .then(() =>
              listener?.(current.value, current.ops, BACKGROUND_CONTEXT),
            )
            .then(
              () => this.#send({ type: "ack_watch", id }),
              (error: unknown) => {
                finish({
                  reason: "listener_error",
                  error:
                    error instanceof Error ? error : new Error(String(error)),
                });
                this.#send({ type: "stop_watch", id });
              },
            );
        });
      };
      const abort = () => {
        finish({ reason: "cancelled" });
        this.#send({ type: "stop_watch", id });
      };
      this.#watches.set(id, {
        deliver: (next, ops) => {
          frame = { value: next, ops };
          deliver();
        },
        finish,
      });
      start = (callback) => {
        if (started) throw new Error("Watch is already started");
        if (end) throw new Error("Watch is stopped");
        started = true;
        listener = callback;
        deliver();
      };
      stop = () => {
        finish({ reason: "stopped" });
        this.#send({ type: "stop_watch", id });
        return closed;
      };
      context.abortSignal?.addEventListener("abort", abort, { once: true });
    });
    try {
      value = await this.#call<ConversationView>(
        "observeConversation",
        call,
        context,
        id,
      );
      if (context.abortSignal?.aborted) {
        this.#watches.get(id)?.finish({ reason: "cancelled" });
        this.#send({ type: "stop_watch", id });
      }
      if (this.#unavailable || this.#closing)
        this.#watches.get(id)?.finish({ reason: "session_closed" });
    } catch (error) {
      this.#watches.get(id)?.finish({ reason: "cancelled" });
      this.#send({ type: "stop_watch", id });
      throw error;
    }
    return {
      get value() {
        return value;
      },
      start: (callback) => start(callback),
      stop: () => stop(),
      closed,
    };
  }

  close(): Promise<void> {
    this.#closing ??= (async () => {
      this.#fail(runtimeFailure("runtime_unavailable", "Harness is closing"));
      this.#send({ type: "close" });
      const wait = async (milliseconds: number): Promise<boolean> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            this.#exited.then(() => true),
            new Promise<false>((resolve) => {
              timer = setTimeout(() => resolve(false), milliseconds);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      if (await wait(5_000)) return;
      this.#child.kill("SIGTERM");
      if (await wait(2_500)) return;
      this.#child.kill("SIGKILL");
      if (!(await wait(2_500)))
        throw new Error("Harness cleanup exceeded 5 seconds");
    })();
    return this.#closing;
  }
}
