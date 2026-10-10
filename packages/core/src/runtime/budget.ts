import type { Context } from "@earendil-works/chord";
import {
  awaitWithContext,
  withoutAbortSignal,
} from "@earendil-works/chord/context";
import {
  defineDoc,
  type Harness,
  type JsonObject,
  type Session,
} from "@earendil-works/pi-durable";
import type {
  ExtendBudgetInput,
  RuntimeBudgetLimits,
  RuntimeBudgetSnapshot,
  RuntimeScope,
} from "../protocol/index.js";

const BudgetDoc = defineDoc<JsonObject>({
  kind: "frogie.budget",
  version: 1,
  scope: "session",
  initial: () => ({}),
});
type Counter = "modelRequests" | "toolEntries";
type Stop = NonNullable<RuntimeBudgetSnapshot["stopped"]>;
interface Grant {
  caller: string;
  input: ExtendBudgetInput;
}
interface StoredBudget {
  initial: RuntimeBudgetLimits;
  limits: RuntimeBudgetLimits;
  consumed: { modelRequests: number; toolEntries: number };
  stopped?: Stop;
  grants: Grant[];
}
class BudgetFailure extends Error {
  readonly retryable = false;
  constructor(
    readonly code: string,
    readonly scope: RuntimeScope,
  ) {
    super(
      code === "budget_exhausted"
        ? "Runtime execution budget is exhausted"
        : "Runtime budget operation could not complete",
    );
  }
}
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const nonnegative = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keysOnly = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const limitsEqual = (a: RuntimeBudgetLimits, b: RuntimeBudgetLimits): boolean =>
  a.modelRequests === b.modelRequests &&
  a.toolEntries === b.toolEntries &&
  a.modelConcurrency === b.modelConcurrency &&
  a.deadlineAt === b.deadlineAt;

export function validBudgetLimits(
  value: unknown,
): value is RuntimeBudgetLimits {
  return (
    object(value) &&
    keysOnly(value, [
      "modelRequests",
      "toolEntries",
      "modelConcurrency",
      "deadlineAt",
    ]) &&
    nonnegative(value.modelRequests) &&
    nonnegative(value.toolEntries) &&
    positive(value.modelConcurrency) &&
    (value.deadlineAt === undefined || positive(value.deadlineAt))
  );
}

function validGrant(input: unknown): input is ExtendBudgetInput {
  return (
    object(input) &&
    keysOnly(input, [
      "requestId",
      "modelRequests",
      "toolEntries",
      "deadlineAt",
    ]) &&
    typeof input.requestId === "string" &&
    input.requestId.trim().length > 0 &&
    Buffer.byteLength(input.requestId) <= 128 &&
    (input.modelRequests === undefined || positive(input.modelRequests)) &&
    (input.toolEntries === undefined || positive(input.toolEntries)) &&
    (input.deadlineAt === undefined || positive(input.deadlineAt)) &&
    (input.modelRequests !== undefined ||
      input.toolEntries !== undefined ||
      input.deadlineAt !== undefined)
  );
}

function snapshot(value: StoredBudget): RuntimeBudgetSnapshot {
  return copy({
    limits: value.limits,
    consumed: value.consumed,
    ...(value.stopped === undefined ? {} : { stopped: value.stopped }),
  });
}

export function createRuntimeBudget(
  initial: RuntimeBudgetLimits,
  scope: RuntimeScope,
) {
  const policy = copy(initial);
  let harness: Harness;
  let context: Context;
  let state: StoredBudget;
  let stopped = new AbortController();
  const closed = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let cancelling: Promise<void> | undefined;
  let cancelAgain = false;
  let generation = 0;
  let active = 0;
  const waiters = new Set<() => void>();
  const failure = (code: string) => new BudgetFailure(code, scope);

  function safe(error: unknown, callContext?: Context): Error {
    if (
      callContext?.abortSignal?.aborted &&
      callContext.abortSignal.reason instanceof Error
    )
      return callContext.abortSignal.reason;
    return error instanceof BudgetFailure ? error : failure("binding_mismatch");
  }

  function load(
    host: Harness,
    callContext: Context,
  ): Promise<StoredBudget | undefined> {
    return host
      .snapshot(BudgetDoc, callContext)
      .then((value) => (value === undefined ? undefined : stored(value)))
      .catch((error) => {
        throw safe(error, callContext);
      });
  }

  function stored(value: unknown): StoredBudget {
    if (
      !object(value) ||
      !keysOnly(value, [
        "initial",
        "limits",
        "consumed",
        "stopped",
        "grants",
      ]) ||
      !validBudgetLimits(value.initial) ||
      !limitsEqual(value.initial, policy) ||
      !validBudgetLimits(value.limits) ||
      !object(value.consumed) ||
      !keysOnly(value.consumed, ["modelRequests", "toolEntries"]) ||
      !nonnegative(value.consumed.modelRequests) ||
      !nonnegative(value.consumed.toolEntries) ||
      value.consumed.modelRequests > value.limits.modelRequests ||
      value.consumed.toolEntries > value.limits.toolEntries ||
      !Array.isArray(value.grants) ||
      value.grants.length > 1024 ||
      (value.stopped !== undefined &&
        (!object(value.stopped) ||
          !keysOnly(value.stopped, ["reason", "at"]) ||
          !["model_requests", "tool_entries", "deadline"].includes(
            String(value.stopped.reason),
          ) ||
          !positive(value.stopped.at)))
    )
      throw failure("binding_mismatch");
    const replay = { ...policy };
    const keys = new Set<string>();
    for (const grant of value.grants) {
      if (
        !object(grant) ||
        !keysOnly(grant, ["caller", "input"]) ||
        typeof grant.caller !== "string" ||
        !grant.caller.length ||
        !validGrant(grant.input) ||
        keys.has(grant.input.requestId)
      )
        throw failure("binding_mismatch");
      keys.add(grant.input.requestId);
      replay.modelRequests += grant.input.modelRequests ?? 0;
      replay.toolEntries += grant.input.toolEntries ?? 0;
      if (grant.input.deadlineAt !== undefined) {
        if (
          replay.deadlineAt === undefined ||
          grant.input.deadlineAt <= replay.deadlineAt
        )
          throw failure("binding_mismatch");
        replay.deadlineAt = grant.input.deadlineAt;
      }
    }
    if (!validBudgetLimits(replay) || !limitsEqual(replay, value.limits))
      throw failure("binding_mismatch");
    return copy(value as unknown as StoredBudget);
  }

  function write(txValue: JsonObject, value: StoredBudget): void {
    if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024)
      throw failure("output_limit");
    Object.assign(txValue, JSON.parse(JSON.stringify(value)) as JsonObject);
    if (value.stopped === undefined) delete txValue.stopped;
  }

  async function cancel(): Promise<void> {
    if (closed.signal.aborted || !state.stopped) return;
    if (cancelling) {
      cancelAgain = true;
      return cancelling;
    }
    const host = harness;
    const epoch = generation;
    const cancelContext = {
      ...withoutAbortSignal(context),
      abortSignal: AbortSignal.any([closed.signal, AbortSignal.timeout(5000)]),
    };
    cancelling = (async () => {
      const current = await awaitWithContext(
        host.inspect(cancelContext),
        cancelContext,
      );
      if (epoch !== generation || !state.stopped) return;
      const results = await awaitWithContext(
        Promise.allSettled([
          ...current.tasks.map(({ record }) =>
            host.abortTask(record.id, cancelContext),
          ),
          ...current.submissions
            .filter(
              (record) => record.type === "input" && record.status === "queued",
            )
            .map((record) => host.abortSubmission(record.id, cancelContext)),
        ]),
        cancelContext,
      );
      if (results.some((result) => result.status === "rejected"))
        throw failure("runtime_unavailable");
    })()
      .catch(() => {
        throw failure("runtime_unavailable");
      })
      .finally(() => {
        cancelling = undefined;
        if (cancelAgain) {
          cancelAgain = false;
          queueMicrotask(() => {
            void cancel().catch(() => {});
          });
        }
      });
    return cancelling;
  }

  function refresh(value: StoredBudget): void {
    if (Boolean(state?.stopped) !== Boolean(value.stopped)) generation++;
    state = value;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (value.stopped) {
      stopped.abort(failure("budget_exhausted"));
      // Native abort joins its invocation; never await it from that invocation's admission path.
      queueMicrotask(() => {
        void cancel().catch(() => {});
      });
    } else {
      if (stopped.signal.aborted) stopped = new AbortController();
      const deadline = value.limits.deadlineAt;
      if (deadline !== undefined && !closed.signal.aborted) {
        timer = setTimeout(
          () => {
            void expire().catch(() => {
              closed.abort(failure("binding_mismatch"));
            });
          },
          Math.min(2_147_483_647, Math.max(0, deadline - Date.now())),
        );
        timer.unref();
      }
    }
    for (const wake of waiters) wake();
  }

  async function mutate<T>(
    change: (value: StoredBudget) => T,
    commit: Session["commit"],
    callContext: Context,
  ): Promise<T> {
    return commit(async (tx) => {
      const doc = await tx.doc(BudgetDoc);
      const value = stored(doc);
      const result = change(value);
      write(doc, value);
      return result;
    }, callContext).catch((error) => {
      throw safe(error, callContext);
    });
  }

  const reason = (
    value: StoredBudget,
    counter?: Counter,
  ): Stop["reason"] | undefined =>
    value.stopped?.reason ??
    (value.limits.deadlineAt !== undefined &&
    Date.now() >= value.limits.deadlineAt
      ? "deadline"
      : counter !== undefined &&
          value.consumed[counter] >= value.limits[counter]
        ? counter === "modelRequests"
          ? "model_requests"
          : "tool_entries"
        : undefined);

  async function expire(): Promise<void> {
    if (closed.signal.aborted) return;
    await mutate(
      (value) => {
        if (reason(value) && value.stopped === undefined)
          value.stopped = { reason: "deadline", at: Date.now() };
      },
      harness.commit.bind(harness),
      context,
    );
  }

  async function admit(
    counter: Counter,
    callContext: Context,
    commit = harness.commit.bind(harness),
  ): Promise<void> {
    closed.signal.throwIfAborted();
    const denied = await mutate(
      (value) => {
        const denied = reason(value, counter);
        if (denied) value.stopped ??= { reason: denied, at: Date.now() };
        else value.consumed[counter]++;
        return denied;
      },
      commit,
      callContext,
    );
    if (denied) throw failure("budget_exhausted");
  }

  function signal(caller?: AbortSignal): AbortSignal {
    return AbortSignal.any([
      closed.signal,
      stopped.signal,
      ...(caller ? [caller] : []),
    ]);
  }

  async function acquire(
    caller?: AbortSignal,
  ): Promise<{ signal: AbortSignal; release(): void }> {
    const requestSignal = signal(caller);
    while (true) {
      requestSignal.throwIfAborted();
      if (
        state.limits.deadlineAt !== undefined &&
        Date.now() >= state.limits.deadlineAt
      ) {
        await expire();
        throw failure("budget_exhausted");
      }
      if (active < state.limits.modelConcurrency) break;
      await new Promise<void>((resolve, reject) => {
        const clean = () => {
          waiters.delete(wake);
          requestSignal.removeEventListener("abort", abort);
        };
        const wake = () => {
          clean();
          resolve();
        };
        const abort = () => {
          clean();
          reject(requestSignal.reason);
        };
        waiters.add(wake);
        requestSignal.addEventListener("abort", abort, { once: true });
        if (requestSignal.aborted) abort();
      });
    }
    active++;
    let released = false;
    return {
      signal: requestSignal,
      release: () => {
        if (released) return;
        released = true;
        active--;
        for (const wake of waiters) wake();
      },
    };
  }

  return {
    failure,
    safe,
    acquire,
    signal,
    async check(callContext: Context): Promise<void> {
      callContext.abortSignal?.throwIfAborted();
      if (reason(state)) {
        await expire();
        throw failure("budget_exhausted");
      }
    },
    admitModel: (callContext: Context) => admit("modelRequests", callContext),
    admitTool: (commit: Session["commit"], callContext: Context) =>
      admit("toolEntries", callContext, commit),
    async attach(
      host: Harness,
      existing: boolean,
      hostContext: Context,
    ): Promise<void> {
      harness = host;
      context = withoutAbortSignal(hostContext);
      const saved = await load(host, hostContext);
      if (existing && saved === undefined) throw failure("binding_mismatch");
      if (saved !== undefined) state = saved;
      else {
        state = {
          initial: copy(policy),
          limits: copy(policy),
          consumed: { modelRequests: 0, toolEntries: 0 },
          grants: [],
        };
        await host
          .commit(async (tx) => {
            write(await tx.doc(BudgetDoc), state as StoredBudget);
          }, hostContext)
          .catch((error) => {
            throw safe(error, hostContext);
          });
      }
      unsubscribe = host.subscribeCommits((publication) => {
        for (const change of publication.changes) {
          if (
            change.type === "document" &&
            change.record.kind === "frogie.budget"
          ) {
            try {
              refresh(stored(change.value));
            } catch {
              closed.abort(failure("binding_mismatch"));
            }
          }
        }
        if (
          state?.stopped &&
          publication.changes.some(
            (change) =>
              (change.type === "task" &&
                change.value.state.status !== "terminal" &&
                !change.value.abortRequested) ||
              (change.type === "submission" &&
                change.value.status === "queued" &&
                change.value.type === "input"),
          )
        )
          queueMicrotask(() => {
            void cancel().catch(() => {});
          });
      });
      refresh(state);
      if (reason(state)) {
        await expire();
        await cancel();
      }
    },
    async read(callContext: Context): Promise<RuntimeBudgetSnapshot> {
      const value = await load(harness, callContext);
      if (!value) throw failure("binding_mismatch");
      return snapshot(value);
    },
    async extend(
      input: ExtendBudgetInput,
      caller: string,
      callContext: Context,
    ): Promise<RuntimeBudgetSnapshot> {
      if (!validGrant(input) || typeof caller !== "string" || !caller.length)
        throw failure("invalid_request");
      const normalized: ExtendBudgetInput = {
        requestId: input.requestId,
        ...(input.modelRequests === undefined
          ? {}
          : { modelRequests: input.modelRequests }),
        ...(input.toolEntries === undefined
          ? {}
          : { toolEntries: input.toolEntries }),
        ...(input.deadlineAt === undefined
          ? {}
          : { deadlineAt: input.deadlineAt }),
      };
      // Drain the old cancellation pass before a grant permits new work.
      if (state?.stopped) await cancel();
      return mutate(
        (value) => {
          const previous = value.grants.find(
            (grant) => grant.input.requestId === input.requestId,
          );
          if (previous) {
            if (
              previous.caller !== caller ||
              JSON.stringify(previous.input) !== JSON.stringify(normalized)
            )
              throw failure("conflict");
            return snapshot(value);
          }
          const limits = {
            ...value.limits,
            modelRequests:
              value.limits.modelRequests + (input.modelRequests ?? 0),
            toolEntries: value.limits.toolEntries + (input.toolEntries ?? 0),
          };
          if (input.deadlineAt !== undefined) {
            if (
              limits.deadlineAt === undefined ||
              input.deadlineAt <= limits.deadlineAt ||
              input.deadlineAt <= Date.now()
            )
              throw failure("invalid_request");
            limits.deadlineAt = input.deadlineAt;
          }
          if (!validBudgetLimits(limits)) throw failure("invalid_request");
          if (value.grants.length >= 1024) throw failure("output_limit");
          value.limits = limits;
          value.grants.push({ caller, input: normalized });
          if (
            value.stopped &&
            (limits.deadlineAt === undefined ||
              limits.deadlineAt > Date.now()) &&
            (value.stopped.reason === "deadline" ||
              (value.stopped.reason === "model_requests" &&
                value.consumed.modelRequests < limits.modelRequests) ||
              (value.stopped.reason === "tool_entries" &&
                value.consumed.toolEntries < limits.toolEntries))
          )
            delete value.stopped;
          return snapshot(value);
        },
        harness.commit.bind(harness),
        callContext,
      );
    },
    close(): void {
      closed.abort(
        Object.assign(new Error("Runtime closed"), { name: "AbortError" }),
      );
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe?.();
      for (const wake of waiters) wake();
    },
  };
}

export type RuntimeBudget = ReturnType<typeof createRuntimeBudget>;
