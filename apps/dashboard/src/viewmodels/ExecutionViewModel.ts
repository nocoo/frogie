import type {
  ExtendBudgetInput,
  GetTaskInput,
  InspectInput,
  ListEntriesInput,
  ListTasksInput,
  RuntimeBudgetSnapshot,
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
  extendBudget(
    input: ExtendBudgetInput,
    scope: RuntimeScope,
  ): Promise<RuntimeBudgetSnapshot>;
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

export type BudgetDraft = Readonly<
  Record<"modelRequests" | "toolEntries" | "minutes", string>
>;

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
  readonly budgetDraft: BudgetDraft;
  readonly budgetSaving: boolean;
  readonly budgetError: string | null;
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
  setBudgetDraft(field: keyof BudgetDraft, value: string): void;
  extendBudget(): Promise<void>;
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
    budgetDraft: { modelRequests: "", toolEntries: "", minutes: "" },
    budgetSaving: false,
    budgetError: null,
  };
  const listeners = new Set<() => void>();
  let disposed = false;
  let generation = 0;
  let selection = 0;
  let active = 0;
  let pending: Promise<void> | undefined;
  const reads = new Set<Promise<void>>();
  let budgetPending: Promise<void> | undefined;
  let budgetIntent: ExtendBudgetInput | undefined;
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
    if (snapshot.budgetSaving) return budgetPending ?? Promise.resolve();
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
        reads.delete(request);
        if (!disposed && current === generation) {
          active--;
          if (exclusive) pending = undefined;
          publish({ busy: active > 0 });
        }
      });
    reads.add(request);
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

  const extendBudget = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (snapshot.scope === undefined) {
      publish({ budgetError: "请先选择 Harness。" });
      return Promise.resolve();
    }
    if (budgetPending) return budgetPending;
    const budget = snapshot.inspection?.budget;
    try {
      if (!budget) throw new Error("当前 Harness 未配置执行预算。");
      if (!budgetIntent) {
        const positive = (field: keyof BudgetDraft): number | undefined => {
          const value = snapshot.budgetDraft[field].trim();
          if (!value) return undefined;
          const number = Number(value);
          if (
            !/^\d+$/u.test(value) ||
            !Number.isSafeInteger(number) ||
            number <= 0
          )
            throw new Error("追加额度与分钟数必须是正整数。");
          return number;
        };
        const modelRequests = positive("modelRequests");
        const toolEntries = positive("toolEntries");
        const minutes = positive("minutes");
        if (minutes !== undefined && budget.limits.deadlineAt === undefined)
          throw new Error("当前预算没有截止时间。");
        const deadlineAt =
          minutes === undefined
            ? undefined
            : Math.max(budget.limits.deadlineAt ?? 0, Date.now()) +
              minutes * 60_000;
        if (
          (deadlineAt !== undefined && !Number.isSafeInteger(deadlineAt)) ||
          (modelRequests === undefined &&
            toolEntries === undefined &&
            deadlineAt === undefined)
        )
          throw new Error("请填写有效的追加额度或延长时间。");
        budgetIntent = {
          requestId: crypto.randomUUID(),
          ...(modelRequests === undefined ? {} : { modelRequests }),
          ...(toolEntries === undefined ? {} : { toolEntries }),
          ...(deadlineAt === undefined ? {} : { deadlineAt }),
        };
      }
    } catch (error) {
      publish({ budgetError: (error as Error).message });
      return Promise.resolve();
    }
    const scope = snapshot.scope;
    const current = generation;
    const input = budgetIntent;
    const reading = [...reads];
    const request = Promise.resolve()
      .then(async () => {
        await Promise.all(reading);
        if (disposed || current !== generation) return;
        const budget = await api.extendBudget(input, scope);
        if (disposed || current !== generation) return;
        budgetIntent = undefined;
        publish({
          ...(snapshot.inspection === undefined
            ? {}
            : { inspection: { ...snapshot.inspection, budget } }),
          budgetDraft: { modelRequests: "", toolEntries: "", minutes: "" },
          budgetError: null,
        });
      })
      .catch((error: unknown) => {
        if (!disposed && current === generation)
          publish({
            budgetError:
              error instanceof Error ? error.message : "预算追加失败",
          });
      })
      .finally(() => {
        if (!disposed && current === generation) {
          budgetPending = undefined;
          publish({ budgetSaving: false });
        }
      });
    budgetPending = request;
    publish({ budgetSaving: true, budgetError: null });
    return request;
  };

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
      reads.clear();
      budgetPending = undefined;
      budgetIntent = undefined;
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
        budgetDraft: { modelRequests: "", toolEntries: "", minutes: "" },
        budgetSaving: false,
        budgetError: null,
      });
      return refresh();
    },
    refresh,
    setBudgetDraft(field, value) {
      if (
        disposed ||
        snapshot.budgetSaving ||
        snapshot.budgetDraft[field] === value
      )
        return;
      const normalize = (value: string): string => {
        const trimmed = value.trim();
        return /^\d+$/u.test(trimmed) ? String(Number(trimmed)) : trimmed;
      };
      if (normalize(snapshot.budgetDraft[field]) !== normalize(value))
        budgetIntent = undefined;
      publish({
        budgetDraft: { ...snapshot.budgetDraft, [field]: value },
        budgetError: null,
      });
    },
    extendBudget,
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
      reads.clear();
      listeners.clear();
    },
  };
}
