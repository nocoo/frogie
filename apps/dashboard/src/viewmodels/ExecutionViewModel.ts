import type {
  GetTaskInput,
  InspectInput,
  ListEntriesInput,
  ListTasksInput,
  RuntimeEntry,
  RuntimeInspection,
  RuntimePage,
  RuntimeScope,
  RuntimeTask,
} from "@frogie/core/protocol";

type ConversationId = ListEntriesInput["conversationId"];
type TaskId = GetTaskInput["taskId"];

export interface ExecutionApi {
  inspect(input: InspectInput, scope: RuntimeScope): Promise<RuntimeInspection>;
  listTasks(
    input: ListTasksInput,
    scope: RuntimeScope,
  ): Promise<RuntimePage<RuntimeTask>>;
  getTask(
    input: GetTaskInput,
    scope: RuntimeScope,
  ): Promise<RuntimeTask | undefined>;
  listEntries(
    input: ListEntriesInput,
    scope: RuntimeScope,
  ): Promise<RuntimePage<RuntimeEntry>>;
}

export interface ExecutionSnapshot {
  readonly scope: RuntimeScope | undefined;
  readonly conversationId: ConversationId | undefined;
  readonly inspection: RuntimeInspection | undefined;
  readonly tasks: readonly RuntimeTask[];
  readonly taskCursor: string | null;
  readonly entries: readonly RuntimeEntry[];
  readonly entryCursor: string | null;
  readonly selectedTask: RuntimeTask | undefined;
  readonly busy: boolean;
  readonly error: string | null;
}

export interface ExecutionViewModel {
  getSnapshot(): ExecutionSnapshot;
  subscribe(listener: () => void): () => void;
  setTarget(
    scope: RuntimeScope,
    conversationId?: ConversationId,
  ): Promise<void>;
  refresh(): Promise<void>;
  loadMoreTasks(): Promise<void>;
  selectTask(id: TaskId): Promise<void>;
  loadMoreEntries(): Promise<void>;
  dispose(): void;
}

function merge<T extends { readonly id: number }>(
  current: readonly T[],
  incoming: readonly T[],
): readonly T[] {
  const items = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) items.set(item.id, item);
  return [...items.values()].sort((left, right) => right.id - left.id);
}

export function createExecutionViewModel(
  api: ExecutionApi,
): ExecutionViewModel {
  let snapshot: ExecutionSnapshot = {
    scope: undefined,
    conversationId: undefined,
    inspection: undefined,
    tasks: [],
    taskCursor: null,
    entries: [],
    entryCursor: null,
    selectedTask: undefined,
    busy: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  let disposed = false;
  let generation = 0;
  let selection = 0;
  let active = 0;
  let pending: Promise<void> | undefined;
  let pagedTasks = false;
  let pagedEntries = false;

  const publish = (change: Partial<ExecutionSnapshot>): void => {
    if (disposed) return;
    snapshot = { ...snapshot, ...change };
    for (const listener of [...listeners]) listener();
  };
  const run = (
    read: (
      scope: RuntimeScope,
      conversationId: ConversationId | undefined,
    ) => Promise<Partial<ExecutionSnapshot>>,
    exclusive = true,
    selectedGeneration = selection,
  ): Promise<void> => {
    if (disposed || snapshot.scope === undefined) return Promise.resolve();
    if (exclusive && pending) return pending;
    const current = generation;
    const scope = snapshot.scope;
    const conversationId = snapshot.conversationId;
    active++;
    const request = Promise.resolve()
      .then(() =>
        !disposed && current === generation ? read(scope, conversationId) : {},
      )
      .then((change) => {
        if (
          !disposed &&
          current === generation &&
          (exclusive || selectedGeneration === selection)
        )
          publish(change);
      })
      .catch((error: unknown) => {
        if (
          !disposed &&
          current === generation &&
          (exclusive || selectedGeneration === selection)
        )
          publish({
            error: error instanceof Error ? error.message : "执行观察失败",
          });
      })
      .finally(() => {
        if (!disposed && current === generation) {
          active--;
          if (exclusive) pending = undefined;
          publish({ busy: active > 0 });
        }
      });
    if (exclusive) pending = request;
    publish({ busy: true, error: null });
    return request;
  };
  const refresh = (): Promise<void> =>
    run(async (scope, conversationId) => {
      const selectedId = snapshot.selectedTask?.id;
      const currentSelection = selection;
      const results = await Promise.allSettled([
        api.inspect({}, scope),
        api.listTasks(
          conversationId === undefined ? {} : { conversationId },
          scope,
        ),
        conversationId === undefined
          ? Promise.resolve(undefined)
          : api.listEntries({ conversationId }, scope),
        selectedId === undefined
          ? Promise.resolve(undefined)
          : api.getTask({ taskId: selectedId }, scope),
      ]);
      const value = <T>(result: PromiseSettledResult<T>): T => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      };
      const inspection = value(results[0]);
      const tasks = value(results[1]);
      const entries = value(results[2]);
      const selected = value(results[3]);
      return {
        inspection,
        tasks: merge(snapshot.tasks, tasks.items),
        taskCursor: pagedTasks ? snapshot.taskCursor : tasks.cursor,
        entries: merge(snapshot.entries, entries?.items ?? []),
        entryCursor: pagedEntries
          ? snapshot.entryCursor
          : (entries?.cursor ?? null),
        ...(currentSelection === selection
          ? {
              selectedTask:
                selected ??
                tasks.items.find((task) => task.id === selectedId) ??
                snapshot.selectedTask,
            }
          : {}),
      };
    });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTarget(scope, conversationId) {
      if (disposed) return Promise.resolve();
      if (
        snapshot.scope?.projectId === scope.projectId &&
        snapshot.scope.environmentId === scope.environmentId &&
        snapshot.scope.squadId === scope.squadId &&
        snapshot.scope.harnessId === scope.harnessId &&
        snapshot.conversationId === conversationId
      )
        return pending ?? Promise.resolve();
      generation++;
      selection++;
      active = 0;
      pending = undefined;
      pagedTasks = false;
      pagedEntries = false;
      publish({
        scope: { ...scope },
        conversationId,
        inspection: undefined,
        tasks: [],
        entries: [],
        taskCursor: null,
        entryCursor: null,
        selectedTask: undefined,
        busy: false,
        error: null,
      });
      return refresh();
    },
    refresh,
    loadMoreTasks() {
      const cursor = snapshot.taskCursor;
      const current = generation;
      if (cursor === null) return Promise.resolve();
      return run(async (scope, conversationId) => {
        const page = await api.listTasks(
          {
            ...(conversationId === undefined ? {} : { conversationId }),
            cursor,
          },
          scope,
        );
        if (!disposed && current === generation) pagedTasks = true;
        return {
          tasks: merge(snapshot.tasks, page.items),
          taskCursor: page.cursor,
        };
      });
    },
    selectTask(id) {
      if (disposed || snapshot.scope === undefined) return Promise.resolve();
      const currentSelection = ++selection;
      return run(
        async (scope) => {
          const selectedTask = await api.getTask({ taskId: id }, scope);
          return { selectedTask };
        },
        false,
        currentSelection,
      );
    },
    loadMoreEntries() {
      const cursor = snapshot.entryCursor;
      const current = generation;
      if (cursor === null || snapshot.conversationId === undefined)
        return Promise.resolve();
      return run(async (scope, conversationId) => {
        if (conversationId === undefined) return {};
        const page = await api.listEntries({ conversationId, cursor }, scope);
        if (!disposed && current === generation) pagedEntries = true;
        return {
          entries: merge(snapshot.entries, page.items),
          entryCursor: page.cursor,
        };
      });
    },
    dispose() {
      disposed = true;
      generation++;
      pending = undefined;
      listeners.clear();
    },
  };
}
