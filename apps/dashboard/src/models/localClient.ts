import type { DefinitionBundle } from "@frogie/core/definitions";
import type {
  CancelInput,
  CancelOutput,
  CompactInput,
  CompactOutput,
  CreateConversationInput,
  CreateConversationOutput,
  DescribeInput,
  GetSubmissionInput,
  GetSubmissionOutput,
  ListConversationsInput,
  ObservationFrame,
  ObserveConversationInput,
  RuntimeCaller,
  RuntimeConversationRecord,
  RuntimeDescription,
  RuntimeError,
  RuntimeScope,
  SubmitInput,
  SubmitOutput,
} from "@frogie/core/protocol";
import {
  type EventSourceMessage,
  EventSourceParserStream,
} from "eventsource-parser/stream";
import Type from "typebox";
import Value from "typebox/value";
import type {
  FileDraft,
  SquadSummary,
} from "../viewmodels/DashboardViewModel.js";

const nonempty = Type.String({ minLength: 1 });
const scopeSchema = Type.Object({
  environmentId: nonempty,
  squadId: nonempty,
  harnessId: nonempty,
});
const authSchema = Type.Object({
  csrf: nonempty,
  caller: Type.Object({ id: nonempty }),
});
const contextSchema = Type.Object({
  instanceId: nonempty,
  scope: scopeSchema,
  description: Type.Object({
    protocolVersion: Type.Literal(1),
    scope: scopeSchema,
  }),
});
const safeId = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const frameSchema = Type.Object({
  type: Type.Union([Type.Literal("snapshot"), Type.Literal("update")]),
  scope: scopeSchema,
  conversationId: safeId,
  value: Type.Object({
    conversation: Type.Object({ id: safeId }),
    entries: Type.Array(Type.Unknown()),
    docs: Type.Record(Type.String(), Type.Unknown()),
  }),
});

function failure(
  code = "runtime_unavailable",
  message = "Local runtime request failed",
): Error & RuntimeError {
  return Object.assign(new Error(message), {
    code,
    retryable: code === "runtime_unavailable",
  });
}

function sameScope(left: RuntimeScope, right: RuntimeScope): boolean {
  return (
    left.environmentId === right.environmentId &&
    left.squadId === right.squadId &&
    left.harnessId === right.harnessId
  );
}

export interface LocalRuntimeOptions {
  readonly origin: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}

export interface LocalRuntimeContext {
  readonly instanceId: string;
  readonly scope: RuntimeScope;
  readonly description: RuntimeDescription;
}

export interface LocalRuntimeClient {
  readonly context: LocalRuntimeContext;
  readonly caller: RuntimeCaller;
  listSquads(): Promise<SquadSummary[]>;
  loadDefinition(squadId: string): Promise<DefinitionBundle>;
  saveDefinition(
    squadId: string,
    draft: FileDraft,
    requestId: string,
  ): Promise<DefinitionBundle>;
  describe(input: DescribeInput): Promise<RuntimeDescription>;
  listConversations(
    input: ListConversationsInput,
  ): Promise<readonly RuntimeConversationRecord[]>;
  createConversation(
    input: CreateConversationInput,
  ): Promise<CreateConversationOutput>;
  submit(input: SubmitInput): Promise<SubmitOutput>;
  getSubmission(input: GetSubmissionInput): Promise<GetSubmissionOutput>;
  cancel(input: CancelInput): Promise<CancelOutput>;
  compact(input: CompactInput): Promise<CompactOutput>;
  observe(
    input: ObserveConversationInput,
    listener: (frame: ObservationFrame) => void,
    onError: (error: RuntimeError) => void,
  ): () => void;
  dispose(): void;
}

export async function connectLocalRuntime(
  options: LocalRuntimeOptions,
): Promise<LocalRuntimeClient> {
  let origin: URL;
  try {
    origin = new URL(options.origin);
  } catch {
    throw failure("invalid_request", "Invalid local runtime origin");
  }
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.origin !== options.origin ||
    !options.token
  )
    throw failure("invalid_request", "Invalid local runtime connection");

  const fetch = options.fetch ?? globalThis.fetch;
  const controllers = new Set<AbortController>();
  const observations = new Set<() => void>();
  let disposed = false;
  const request = async (
    path: string,
    body?: unknown,
    csrf?: string,
  ): Promise<unknown> => {
    if (disposed)
      throw failure("runtime_unavailable", "Local runtime disposed");
    const controller = new AbortController();
    controllers.add(controller);
    try {
      let response: Response;
      try {
        response = await fetch(new URL(path, origin), {
          method: body === undefined ? "GET" : "POST",
          credentials: "same-origin",
          redirect: "error",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(csrf === undefined ? {} : { "X-Frogie-CSRF": csrf }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        throw failure();
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw failure("runtime_unavailable", "Invalid local runtime response");
      }
      if (disposed)
        throw failure("runtime_unavailable", "Local runtime disposed");
      if (!response.ok) {
        if (
          typeof value === "object" &&
          value !== null &&
          "error" in value &&
          typeof value.error === "object" &&
          value.error !== null &&
          "code" in value.error &&
          typeof value.error.code === "string" &&
          "message" in value.error &&
          typeof value.error.message === "string"
        )
          throw failure(value.error.code, value.error.message);
        throw failure();
      }
      return value;
    } finally {
      controllers.delete(controller);
    }
  };

  const auth = await request("/__local/auth/exchange", {
    token: options.token,
  });
  if (!Value.Check(authSchema, auth))
    throw failure(
      "runtime_unavailable",
      "Invalid local authentication response",
    );
  const loaded = await request("/__local/context");
  if (
    !Value.Check(contextSchema, loaded) ||
    !sameScope(loaded.scope, loaded.description.scope)
  )
    throw failure("binding_mismatch", "Invalid local runtime context");
  const context = Object.freeze({
    ...(loaded as LocalRuntimeContext),
    scope: Object.freeze({ ...loaded.scope }),
  });
  const caller = Object.freeze({ ...auth.caller });
  const operation = async <T>(name: string, input: unknown): Promise<T> => {
    const result = await request(
      `/__local/instances/${encodeURIComponent(context.instanceId)}/operations/${name}`,
      { scope: context.scope, input },
      auth.csrf,
    );
    if (
      typeof result !== "object" ||
      result === null ||
      !("scope" in result) ||
      !Value.Check(scopeSchema, result.scope) ||
      !sameScope(result.scope, context.scope) ||
      !("value" in result)
    )
      throw failure("binding_mismatch", "Invalid local runtime response scope");
    return result.value as T;
  };
  const definitionRequest = async <T>(
    name: string,
    body: unknown,
  ): Promise<T> => {
    const result = await request(
      `/__local/definitions/${name}`,
      body,
      auth.csrf,
    );
    if (
      typeof result !== "object" ||
      result === null ||
      Array.isArray(result) ||
      !("value" in result) ||
      typeof result.value !== "object" ||
      result.value === null ||
      Array.isArray(result.value) !== (name === "list")
    )
      throw failure("runtime_unavailable", "Invalid local definition response");
    return result.value as T;
  };

  return {
    context,
    caller,
    listSquads: () => definitionRequest("list", {}),
    loadDefinition: (squadId) => definitionRequest("load", { squadId }),
    saveDefinition: (squadId, draft, requestId) =>
      definitionRequest("save", { squadId, draft, requestId }),
    describe: (input) => operation("describe", input),
    listConversations: (input) => operation("listConversations", input),
    createConversation: (input) => operation("createConversation", input),
    submit: (input) => operation("submit", input),
    async getSubmission(input) {
      return (
        (await operation<GetSubmissionOutput | null>("getSubmission", input)) ??
        undefined
      );
    },
    async cancel(input) {
      return (
        (await operation<CancelOutput | null>("cancel", input)) ?? undefined
      );
    },
    compact: (input) => operation("compact", input),
    observe(input, listener, onError) {
      if (disposed)
        throw failure("runtime_unavailable", "Local runtime disposed");
      const controller = new AbortController();
      const conversationId = input.conversationId;
      let reader: ReadableStreamDefaultReader<EventSourceMessage> | undefined;
      let stopped = false;
      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        controller.abort();
        if (reader) void reader.cancel().catch(() => undefined);
        controllers.delete(controller);
        observations.delete(stop);
      };
      controllers.add(controller);
      observations.add(stop);
      void (async () => {
        try {
          const response = await fetch(
            new URL(
              `/__local/instances/${encodeURIComponent(context.instanceId)}/operations/observeConversation`,
              origin,
            ),
            {
              method: "POST",
              credentials: "same-origin",
              redirect: "error",
              signal: controller.signal,
              headers: {
                Accept: "text/event-stream",
                "Content-Type": "application/json",
                "X-Frogie-CSRF": auth.csrf,
              },
              body: JSON.stringify({ scope: context.scope, input }),
            },
          );
          if (stopped || disposed) {
            await response.body?.cancel();
            return;
          }
          if (!response.ok) {
            const value: unknown = await response.json();
            if (
              typeof value === "object" &&
              value !== null &&
              "error" in value &&
              typeof value.error === "object" &&
              value.error !== null &&
              "code" in value.error &&
              typeof value.error.code === "string" &&
              "message" in value.error &&
              typeof value.error.message === "string"
            )
              throw failure(value.error.code, value.error.message);
            throw failure();
          }
          if (
            !response.body ||
            !/^text\/event-stream(?:\s*;|$)/iu.test(
              response.headers.get("Content-Type") ?? "",
            )
          ) {
            await response.body?.cancel();
            throw failure(
              "runtime_unavailable",
              "Invalid local observation response",
            );
          }
          reader = response.body
            .pipeThrough(new TextDecoderStream("utf-8", { fatal: true }))
            .pipeThrough(
              new EventSourceParserStream({
                maxBufferSize: 1_048_576,
                onError: "terminate",
              }),
            )
            .getReader();
          while (!stopped && !disposed) {
            const { done, value } = await reader.read();
            if (stopped || disposed) return;
            if (done)
              throw failure(
                "runtime_unavailable",
                "Local observation disconnected",
              );
            const frame: unknown = JSON.parse(value.data);
            if (
              !Value.Check(frameSchema, frame) ||
              value.event !== frame.type ||
              !sameScope(frame.scope, context.scope) ||
              frame.conversationId !== conversationId ||
              frame.value.conversation.id !== conversationId
            )
              throw failure(
                "binding_mismatch",
                "Invalid local observation frame",
              );
            listener(frame as unknown as ObservationFrame);
          }
        } catch (error) {
          if (!stopped && !disposed) {
            stop();
            try {
              onError(
                error instanceof Error && "code" in error
                  ? (error as Error & RuntimeError)
                  : failure(),
              );
            } catch {
              return;
            }
          }
        } finally {
          stop();
          reader?.releaseLock();
        }
      })();
      return stop;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const stop of observations) stop();
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },
  };
}
