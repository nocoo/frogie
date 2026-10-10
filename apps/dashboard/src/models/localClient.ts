import type { DefinitionBundle } from "@frogie/core/definitions";
import type {
  CancelInput,
  CancelOutput,
  CompactInput,
  CompactOutput,
  CreateConversationInput,
  CreateConversationOutput,
  DaemonContext,
  DaemonProject,
  DescribeInput,
  ExtendBudgetInput,
  GetSubmissionInput,
  GetSubmissionOutput,
  GetTaskInput,
  InspectInput,
  ListConversationsInput,
  ListEntriesInput,
  ListTasksInput,
  ObservationFrame,
  ObserveConversationInput,
  RuntimeBudgetSnapshot,
  RuntimeCaller,
  RuntimeConversationRecord,
  RuntimeDescription,
  RuntimeEntry,
  RuntimeError,
  RuntimeInspection,
  RuntimePage,
  RuntimeScope,
  RuntimeTask,
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
  projectId: nonempty,
  environmentId: nonempty,
  squadId: nonempty,
  harnessId: nonempty,
});
const authSchema = Type.Object({
  csrf: nonempty,
  caller: Type.Object({ id: nonempty }),
});
const projectSchema = Type.Object({
  projectId: nonempty,
  title: nonempty,
  scope: scopeSchema,
  enabled: Type.Boolean(),
  state: Type.Union([
    Type.Literal("starting"),
    Type.Literal("running"),
    Type.Literal("stopped"),
    Type.Literal("error"),
  ]),
  definitionHash: Type.String(),
  rootConversationId: Type.Optional(Type.Integer({ minimum: 1 })),
  model: Type.Optional(
    Type.Object({
      provider: nonempty,
      modelId: nonempty,
      thinkingLevel: nonempty,
    }),
  ),
  error: Type.Optional(
    Type.Object({
      code: nonempty,
      message: nonempty,
      retryable: Type.Boolean(),
    }),
  ),
});
const contextSchema = Type.Object({
  instanceId: nonempty,
  mode: Type.Union([Type.Literal("local"), Type.Literal("e2e")]),
  projects: Type.Array(projectSchema),
});
const safeId = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const budgetSchema = Type.Object(
  {
    limits: Type.Object(
      {
        modelRequests: count,
        toolEntries: count,
        modelConcurrency: safeId,
        deadlineAt: Type.Optional(safeId),
      },
      { additionalProperties: false },
    ),
    consumed: Type.Object(
      { modelRequests: count, toolEntries: count },
      { additionalProperties: false },
    ),
    stopped: Type.Optional(
      Type.Object(
        {
          reason: Type.Union([
            Type.Literal("model_requests"),
            Type.Literal("tool_entries"),
            Type.Literal("deadline"),
          ]),
          at: safeId,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
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
const taskSchema = Type.Object({
  id: safeId,
  conversationId: safeId,
  kind: nonempty,
  owner: Type.Optional(safeId),
  background: Type.Boolean(),
  abortRequested: Type.Boolean(),
  startedAt: Type.Optional(Type.Number()),
  endedAt: Type.Optional(Type.Number()),
  state: Type.Object({
    status: Type.Union(
      ["pending", "running", "waiting", "completing", "terminal"].map(
        (status) => Type.Literal(status),
      ),
    ),
    phase: Type.Optional(nonempty),
    on: Type.Optional(Type.Array(safeId)),
    outcome: Type.Optional(
      Type.Union(
        ["completed", "failed", "aborted", "orphaned", "faulted"].map(
          (status) => Type.Literal(status),
        ),
      ),
    ),
  }),
  tool: Type.Optional(
    Type.Object({
      callId: nonempty,
      name: nonempty,
      arguments: Type.Unknown(),
      argumentsSource: Type.Union([
        Type.Literal("requested"),
        Type.Literal("execution"),
      ]),
      output: Type.Optional(Type.String()),
      details: Type.Optional(Type.Unknown()),
      isError: Type.Optional(Type.Boolean()),
      entryId: Type.Optional(safeId),
    }),
  ),
});
const entrySchema = Type.Object({
  id: safeId,
  conversationId: safeId,
  kind: nonempty,
  byTaskId: Type.Optional(safeId),
  head: Type.Optional(safeId),
  messages: Type.Array(
    Type.Object({
      role: Type.Union([
        Type.Literal("user"),
        Type.Literal("assistant"),
        Type.Literal("toolResult"),
      ]),
      content: Type.String(),
      toolCalls: Type.Optional(
        Type.Array(
          Type.Object({
            id: nonempty,
            name: nonempty,
            arguments: Type.Unknown(),
          }),
        ),
      ),
      toolCallId: Type.Optional(nonempty),
      toolName: Type.Optional(nonempty),
      isError: Type.Optional(Type.Boolean()),
      details: Type.Optional(Type.Unknown()),
    }),
  ),
});
const pageSchema = <T extends import("typebox").TSchema>(item: T) =>
  Type.Object({
    items: Type.Array(item, { maxItems: 100 }),
    cursor: Type.Union([
      Type.Null(),
      Type.String({ minLength: 1, maxLength: 4096 }),
    ]),
  });
const tasksSchema = pageSchema(taskSchema);
const entriesSchema = pageSchema(entrySchema);
const usageSchema = Type.Object({
  input: Type.Number({ minimum: 0 }),
  output: Type.Number({ minimum: 0 }),
  cacheRead: Type.Number({ minimum: 0 }),
  cacheWrite: Type.Number({ minimum: 0 }),
  totalTokens: Type.Number({ minimum: 0 }),
  cost: Type.Object({
    input: Type.Number({ minimum: 0 }),
    output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Number({ minimum: 0 }),
    cacheWrite: Type.Number({ minimum: 0 }),
    total: Type.Number({ minimum: 0 }),
  }),
});
const inspectionSchema = Type.Object({
  scope: scopeSchema,
  scheduling: Type.Union([
    Type.Literal("paused"),
    Type.Literal("running"),
    Type.Literal("closing"),
  ]),
  graph: Type.Object({
    tasks: Type.Record(
      Type.String(),
      Type.Object({
        id: safeId,
        kind: nonempty,
        conversationId: safeId,
        owner: Type.Optional(safeId),
        background: Type.Boolean(),
        abortRequested: Type.Boolean(),
        state: Type.Object({ status: nonempty }),
        conversations: Type.Array(safeId),
      }),
    ),
  }),
  usage: Type.Object({
    models: Type.Record(Type.String(), usageSchema),
    tools: Type.Record(Type.String(), usageSchema),
  }),
  budget: Type.Optional(budgetSchema),
});

function validBudget(value: unknown): value is RuntimeBudgetSnapshot {
  return (
    Value.Check(budgetSchema, value) &&
    value.consumed.modelRequests <= value.limits.modelRequests &&
    value.consumed.toolEntries <= value.limits.toolEntries
  );
}

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
    left.projectId === right.projectId &&
    left.environmentId === right.environmentId &&
    left.squadId === right.squadId &&
    left.harnessId === right.harnessId
  );
}

export interface LocalRuntimeOptions {
  readonly origin: string;
  readonly token?: string;
  readonly fetch?: typeof fetch;
}

export interface LocalRuntimeClient {
  readonly context: DaemonContext;
  listProjects(): Promise<readonly DaemonProject[]>;
  setProjectEnabled(
    projectId: string,
    enabled: boolean,
  ): Promise<DaemonProject>;
  registerProject(squadId: string): Promise<DaemonProject>;
  bindDefinition(projectId: string): Promise<DaemonProject>;
  readonly caller: RuntimeCaller;
  listSquads(): Promise<SquadSummary[]>;
  loadDefinition(squadId: string): Promise<DefinitionBundle>;
  saveDefinition(
    squadId: string,
    draft: FileDraft,
    requestId: string,
  ): Promise<DefinitionBundle>;
  describe(
    input: DescribeInput,
    scope: RuntimeScope,
  ): Promise<RuntimeDescription>;
  listConversations(
    input: ListConversationsInput,
    scope: RuntimeScope,
  ): Promise<readonly RuntimeConversationRecord[]>;
  createConversation(
    input: CreateConversationInput,
    scope: RuntimeScope,
  ): Promise<CreateConversationOutput>;
  submit(input: SubmitInput, scope: RuntimeScope): Promise<SubmitOutput>;
  getSubmission(
    input: GetSubmissionInput,
    scope: RuntimeScope,
  ): Promise<GetSubmissionOutput>;
  cancel(input: CancelInput, scope: RuntimeScope): Promise<CancelOutput>;
  compact(input: CompactInput, scope: RuntimeScope): Promise<CompactOutput>;
  inspect(input: InspectInput, scope: RuntimeScope): Promise<RuntimeInspection>;
  extendBudget(
    input: ExtendBudgetInput,
    scope: RuntimeScope,
  ): Promise<RuntimeBudgetSnapshot>;
  listEntries(
    input: ListEntriesInput,
    scope: RuntimeScope,
  ): Promise<RuntimePage<RuntimeEntry>>;
  listTasks(
    input: ListTasksInput,
    scope: RuntimeScope,
  ): Promise<RuntimePage<RuntimeTask>>;
  getTask(
    input: GetTaskInput,
    scope: RuntimeScope,
  ): Promise<RuntimeTask | undefined>;
  observe(
    input: ObserveConversationInput,
    listener: (frame: ObservationFrame) => void,
    onError: (error: RuntimeError) => void,
    scope: RuntimeScope,
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
    !(
      (origin.protocol === "http:" && origin.hostname === "127.0.0.1") ||
      options.origin === "https://frogie.dev.hexly.ai"
    ) ||
    origin.origin !== options.origin ||
    options.token === ""
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

  const auth =
    options.token === undefined
      ? await request("/__local/auth/session")
      : await request("/__local/auth/exchange", { token: options.token });
  if (!Value.Check(authSchema, auth))
    throw failure(
      "runtime_unavailable",
      "Invalid local authentication response",
    );
  const loaded = await request("/__local/context");
  if (
    !Value.Check(contextSchema, loaded) ||
    loaded.projects.some(
      (project) => project.projectId !== project.scope.projectId,
    )
  )
    throw failure("binding_mismatch", "Invalid local runtime context");
  const context = Object.freeze({
    ...(loaded as unknown as DaemonContext),
  });
  const caller = Object.freeze({ ...auth.caller });
  const operation = async <T>(
    name: string,
    input: unknown,
    scope: RuntimeScope,
  ): Promise<T> => {
    const result = await request(
      `/__local/instances/${encodeURIComponent(context.instanceId)}/operations/${name}`,
      { scope, input },
      auth.csrf,
    );
    if (
      typeof result !== "object" ||
      result === null ||
      !("scope" in result) ||
      !Value.Check(scopeSchema, result.scope) ||
      !sameScope(result.scope, scope) ||
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

  const projectRequest = async (
    name: string,
    input: unknown,
  ): Promise<DaemonProject> => {
    const result = await request(`/__local/projects/${name}`, input, auth.csrf);
    if (
      typeof result !== "object" ||
      result === null ||
      !("value" in result) ||
      !Value.Check(projectSchema, result.value) ||
      result.value.projectId !== result.value.scope.projectId
    )
      throw failure("runtime_unavailable", "Invalid project response");
    return result.value as unknown as DaemonProject;
  };
  return {
    context,
    caller,
    async listProjects() {
      const result = await request("/__local/context");
      if (
        !Value.Check(contextSchema, result) ||
        result.instanceId !== context.instanceId ||
        result.mode !== context.mode ||
        result.projects.some(
          (project) => project.projectId !== project.scope.projectId,
        )
      )
        throw failure("binding_mismatch", "Daemon identity changed");
      return result.projects as unknown as readonly DaemonProject[];
    },
    setProjectEnabled: (projectId, enabled) =>
      projectRequest("enabled", { projectId, enabled }),
    registerProject: (squadId) => projectRequest("register", { squadId }),
    bindDefinition: (projectId) => projectRequest("bind", { projectId }),
    listSquads: () => definitionRequest("list", {}),
    loadDefinition: (squadId) => definitionRequest("load", { squadId }),
    saveDefinition: (squadId, draft, requestId) =>
      definitionRequest("save", { squadId, draft, requestId }),
    describe: (input, scope) => operation("describe", input, scope),
    listConversations: (input, scope) =>
      operation("listConversations", input, scope),
    createConversation: (input, scope) =>
      operation("createConversation", input, scope),
    submit: (input, scope) => operation("submit", input, scope),
    async getSubmission(input, scope) {
      return (
        (await operation<GetSubmissionOutput | null>(
          "getSubmission",
          input,
          scope,
        )) ?? undefined
      );
    },
    async cancel(input, scope) {
      return (
        (await operation<CancelOutput | null>("cancel", input, scope)) ??
        undefined
      );
    },
    compact: (input, scope) => operation("compact", input, scope),
    async inspect(input, scope) {
      const result = await operation("inspect", input, scope);
      if (
        !Value.Check(inspectionSchema, result) ||
        !sameScope(result.scope, scope) ||
        (result.budget !== undefined && !validBudget(result.budget))
      )
        throw failure("binding_mismatch", "Invalid runtime inspection");
      return result as unknown as RuntimeInspection;
    },
    async extendBudget(input, scope) {
      const result = await operation("extendBudget", input, scope);
      if (!validBudget(result))
        throw failure("binding_mismatch", "Invalid runtime budget");
      return result;
    },
    async listTasks(input, scope) {
      const result = await operation("listTasks", input, scope);
      if (
        !Value.Check(tasksSchema, result) ||
        (input.conversationId !== undefined &&
          result.items.some(
            (task) => task.conversationId !== input.conversationId,
          ))
      )
        throw failure("binding_mismatch", "Invalid runtime task page");
      return result as unknown as RuntimePage<RuntimeTask>;
    },
    async listEntries(input, scope) {
      const result = await operation("listEntries", input, scope);
      if (!Value.Check(entriesSchema, result))
        throw failure("binding_mismatch", "Invalid runtime history page");
      return result as unknown as RuntimePage<RuntimeEntry>;
    },
    async getTask(input, scope) {
      const result = await operation("getTask", input, scope);
      if (result === null) return undefined;
      if (!Value.Check(taskSchema, result) || result.id !== input.taskId)
        throw failure("binding_mismatch", "Invalid runtime task");
      return result as unknown as RuntimeTask;
    },
    observe(input, listener, onError, scope) {
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
              body: JSON.stringify({ scope, input }),
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
              !sameScope(frame.scope, scope) ||
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
