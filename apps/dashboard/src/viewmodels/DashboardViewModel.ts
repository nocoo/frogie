import type { DefinitionBundle } from "@frogie/core/definitions";
import type {
  CreateConversationInput,
  CreateConversationOutput,
  GetSubmissionOutput,
  ObservationFrame,
  RuntimeCall,
  RuntimeError,
  RuntimeScope,
  SubmitInput,
  SubmitOutput,
} from "@frogie/core/protocol";

type ConversationId = SubmitInput["conversationId"];
type ConversationView = ObservationFrame["value"];
type SubmissionId = SubmitOutput;

export type DashboardScope = RuntimeScope;

export interface RuntimeCaller {
  readonly id: string;
}

export interface SquadSummary {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
}

export interface FileDraft {
  readonly path: string;
  readonly content: string;
  readonly baseContent: string;
}

export interface DashboardApi {
  listSquads(): Promise<readonly SquadSummary[]>;
  loadFiles(scope: DashboardScope): Promise<DefinitionBundle>;
  saveFile(
    scope: DashboardScope,
    draft: FileDraft,
    requestId: string,
  ): Promise<DefinitionBundle>;
  listConversations(scope: DashboardScope): Promise<readonly ConversationId[]>;
  createConversation(
    call: RuntimeCall<CreateConversationInput>,
  ): Promise<CreateConversationOutput>;
  submit(call: RuntimeCall<SubmitInput>): Promise<SubmissionId>;
  getSubmission(
    scope: DashboardScope,
    submissionId: SubmissionId,
  ): Promise<GetSubmissionOutput>;
  observe(
    scope: DashboardScope,
    conversationId: ConversationId,
    listener: (frame: ObservationFrame) => void,
  ): () => void;
  cancel(
    scope: DashboardScope,
    conversationId: ConversationId,
    submissionId?: SubmissionId,
  ): Promise<void>;
  compact(scope: DashboardScope, conversationId: ConversationId): Promise<void>;
}

export interface DashboardSnapshot {
  readonly scope: DashboardScope | undefined;
  readonly squads: readonly SquadSummary[];
  readonly definition: DefinitionBundle | undefined;
  readonly drafts: ReadonlyMap<string, FileDraft>;
  readonly conversations: ReadonlyMap<ConversationId, ConversationView>;
  readonly busy: boolean;
  readonly error: RuntimeError | undefined;
}

export interface DashboardStore {
  getSnapshot(): DashboardSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface DashboardViewModel {
  readonly store: DashboardStore;
  refreshSquads(): Promise<void>;
  setScope(scope: DashboardScope, runtimeEnabled?: boolean): Promise<void>;
  editFile(path: string, content: string): void;
  saveFile(path: string): Promise<void>;
  createConversation(input: CreateConversationInput): Promise<ConversationId>;
  submit(conversationId: ConversationId, text: string): Promise<SubmissionId>;
  observe(conversationId: ConversationId): void;
  cancel(
    conversationId: ConversationId,
    submissionId?: SubmissionId,
  ): Promise<void>;
  compact(conversationId: ConversationId): Promise<void>;
  dispose(): void;
}

function runtimeError(error: unknown, scope?: DashboardScope): RuntimeError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  ) {
    return error as RuntimeError;
  }
  return {
    code: "runtime_unavailable",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    ...(scope === undefined ? {} : { scope }),
  };
}

const sameScope = (left: DashboardScope, right: DashboardScope): boolean =>
  left.projectId === right.projectId &&
  left.environmentId === right.environmentId &&
  left.squadId === right.squadId &&
  left.harnessId === right.harnessId;

export function createDashboardViewModel(
  api: DashboardApi,
  caller: RuntimeCaller,
): DashboardViewModel {
  let snapshot: DashboardSnapshot = {
    scope: undefined,
    squads: [],
    definition: undefined,
    drafts: new Map(),
    conversations: new Map(),
    busy: false,
    error: undefined,
  };
  let disposed = false;
  let generation = 0;
  let busyCount = 0;
  let squadRequest = 0;
  let refreshingSquads = false;
  const listeners = new Set<() => void>();
  const observations = new Map<ConversationId, () => void>();
  const saveRetries = new Map<string, { content: string; requestId: string }>();
  const savingFiles = new Set<string>();
  const submitRetries = new Map<string, { text: string; requestId: string }>();
  const pendingSubmissions = new Map<string, Promise<SubmissionId>>();

  const publish = (change: Partial<DashboardSnapshot>): void => {
    if (disposed) return;
    snapshot = { ...snapshot, ...change };
    for (const listener of [...listeners]) listener();
  };
  const changeBusy = (delta: number, token: number): void => {
    if (disposed || token !== generation) return;
    busyCount = Math.max(0, busyCount + delta);
    publish({ busy: busyCount > 0 || refreshingSquads });
  };
  const runScoped = async <T>(
    operation: (scope: DashboardScope) => Promise<T>,
    accept?: (value: T) => void,
  ): Promise<T> => {
    const scope = scoped();
    const token = generation;
    changeBusy(1, token);
    try {
      const result = await operation(scope);
      if (!disposed && token === generation) {
        accept?.(result);
        publish({ error: undefined });
      }
      return result;
    } catch (error) {
      if (!disposed && token === generation)
        publish({ error: runtimeError(error, scope) });
      throw error;
    } finally {
      changeBusy(-1, token);
    }
  };
  const scoped = (): DashboardScope => {
    if (disposed || !snapshot.scope)
      throw new Error("No active Dashboard scope");
    return snapshot.scope;
  };
  const releaseObservations = (): void => {
    for (const release of observations.values()) release();
    observations.clear();
  };

  const store: DashboardStore = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const viewModel: DashboardViewModel = {
    store,
    async refreshSquads() {
      if (disposed) return;
      const token = ++squadRequest;
      refreshingSquads = true;
      publish({ busy: true, error: undefined });
      try {
        const squads = await api.listSquads();
        if (!disposed && token === squadRequest)
          publish({ squads, error: undefined });
      } catch (error) {
        if (!disposed && token === squadRequest)
          publish({ error: runtimeError(error) });
        throw error;
      } finally {
        if (!disposed && token === squadRequest) {
          refreshingSquads = false;
          publish({ busy: busyCount > 0 });
        }
      }
    },
    async setScope(scope, runtimeEnabled = true) {
      if (disposed) return;
      const token = ++generation;
      releaseObservations();
      saveRetries.clear();
      savingFiles.clear();
      busyCount = 1;
      publish({
        scope,
        definition: undefined,
        drafts: new Map(),
        conversations: new Map(),
        busy: true,
        error: undefined,
      });
      try {
        const [definition, conversationIds] = await Promise.all([
          api.loadFiles(scope),
          runtimeEnabled ? api.listConversations(scope) : Promise.resolve([]),
        ]);
        if (!disposed && token === generation) {
          publish({
            definition,
            conversations: new Map(),
            error: undefined,
          });
          for (const id of conversationIds) viewModel.observe(id);
        }
      } catch (error) {
        if (!disposed && token === generation) {
          publish({
            definition: undefined,
            conversations: new Map(),
            error: runtimeError(error, scope),
          });
        }
        throw error;
      } finally {
        changeBusy(-1, token);
      }
    },
    editFile(path, content) {
      if (disposed || !snapshot.definition) return;
      const current = snapshot.drafts.get(path);
      const baseContent =
        current?.baseContent ??
        snapshot.definition.files.find((file) => file.path === path)?.content;
      if (baseContent === undefined) return;
      const drafts = new Map(snapshot.drafts);
      if (content === baseContent && !savingFiles.has(path))
        drafts.delete(path);
      else drafts.set(path, { path, content, baseContent });
      publish({ drafts, error: undefined });
    },
    async saveFile(path) {
      const scope = scoped();
      const draft = snapshot.drafts.get(path);
      if (!draft) return;
      if (savingFiles.size > 0) {
        const error: RuntimeError = {
          code: "definition_busy",
          message: "A definition save is already in progress",
          retryable: true,
          scope,
        };
        publish({ error });
        throw error;
      }
      const token = generation;
      const retry = saveRetries.get(path);
      const requestId =
        retry?.content === draft.content
          ? retry.requestId
          : globalThis.crypto.randomUUID();
      saveRetries.set(path, { content: draft.content, requestId });
      savingFiles.add(path);
      changeBusy(1, token);
      try {
        const definition = await api.saveFile(scope, draft, requestId);
        if (!disposed && token === generation) {
          const saved = definition.files.find((file) => file.path === path);
          if (saved) {
            const drafts = new Map(snapshot.drafts);
            const current = drafts.get(path);
            if (current?.content === draft.content) drafts.delete(path);
            else if (current)
              drafts.set(path, { ...current, baseContent: saved.content });
            publish({
              definition,
              drafts,
              error: undefined,
            });
          }
          if (saveRetries.get(path)?.requestId === requestId)
            saveRetries.delete(path);
        }
      } catch (error) {
        if (!disposed && token === generation)
          publish({ error: runtimeError(error, scope) });
        throw error;
      } finally {
        if (token === generation) savingFiles.delete(path);
        changeBusy(-1, token);
      }
    },
    async createConversation(input) {
      const result = await runScoped(
        (scope) => api.createConversation({ scope, caller, input }),
        ({ conversationId }) => viewModel.observe(conversationId),
      );
      return result.conversationId;
    },
    async submit(conversationId, text) {
      const scope = scoped();
      const token = generation;
      const key = JSON.stringify([
        scope.projectId,
        scope.environmentId,
        scope.squadId,
        scope.harnessId,
        conversationId,
        text,
      ]);
      const pending = pendingSubmissions.get(key);
      if (pending) return pending;
      const retry = submitRetries.get(key);
      const requestId =
        retry?.text === text ? retry.requestId : globalThis.crypto.randomUUID();
      submitRetries.set(key, { text, requestId });
      changeBusy(1, token);
      const operation = (async () => {
        try {
          const id = await api.submit({
            scope,
            caller,
            input: {
              conversationId,
              submission: { type: "input", content: text, requestId },
            },
          });
          if (submitRetries.get(key)?.requestId === requestId)
            submitRetries.delete(key);
          if (!disposed && token === generation) {
            publish({ error: undefined });
          }
          return id;
        } catch (error) {
          if (!disposed && token === generation)
            publish({ error: runtimeError(error, scope) });
          throw error;
        } finally {
          changeBusy(-1, token);
        }
      })();
      pendingSubmissions.set(key, operation);
      try {
        return await operation;
      } finally {
        if (pendingSubmissions.get(key) === operation)
          pendingSubmissions.delete(key);
      }
    },
    observe(conversationId) {
      if (disposed || !snapshot.scope || observations.has(conversationId))
        return;
      const scope = snapshot.scope;
      const token = generation;
      const release = api.observe(scope, conversationId, (frame) => {
        if (
          disposed ||
          token !== generation ||
          frame.conversationId !== conversationId ||
          frame.value.conversation.id !== conversationId ||
          !sameScope(frame.scope, scope)
        )
          return;
        const conversations = new Map(snapshot.conversations);
        conversations.set(conversationId, frame.value);
        publish({ conversations });
      });
      observations.set(conversationId, release);
    },
    async cancel(conversationId, submissionId) {
      await runScoped((scope) =>
        api.cancel(scope, conversationId, submissionId),
      );
    },
    async compact(conversationId) {
      await runScoped((scope) => api.compact(scope, conversationId));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      releaseObservations();
      listeners.clear();
      pendingSubmissions.clear();
      submitRetries.clear();
      saveRetries.clear();
      savingFiles.clear();
    },
  };

  return viewModel;
}
