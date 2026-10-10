import type {
  GetTaskInput,
  ListEntriesInput,
  ListTasksInput,
  RuntimeEntry,
  RuntimeInspection,
  RuntimePage,
  RuntimeScope,
  RuntimeTask,
} from "@frogie/core/protocol";
import { describe, expect, it, vi } from "vitest";
import { createExecutionViewModel } from "./ExecutionViewModel.js";

const scope: RuntimeScope = {
  projectId: "inspection-project",
  environmentId: "e2e",
  squadId: "inspection-squad",
  harnessId: "inspection-harness",
};
const inspection: RuntimeInspection = {
  scope,
  scheduling: "paused",
  graph: { tasks: {} },
  usage: { models: {}, tools: {} },
};
const conversationId = 17 as RuntimeEntry["conversationId"];

function task(
  id: number,
  status: RuntimeTask["state"]["status"] = "running",
): RuntimeTask {
  return {
    id: id as RuntimeTask["id"],
    conversationId,
    kind: "pi.tool",
    background: false,
    abortRequested: false,
    state: {
      status,
      ...(status === "terminal"
        ? { outcome: "completed" as const }
        : { phase: "execute" }),
    },
    tool: {
      callId: `call-${id}`,
      name: "read_artifact",
      arguments: { id: "artifact" },
      argumentsSource: status === "terminal" ? "requested" : "execution",
      output: `Task ${id}`,
    },
  };
}
function entry(id: number, content = `Entry ${id}`): RuntimeEntry {
  return {
    id: id as RuntimeEntry["id"],
    conversationId,
    kind: "pi.user",
    messages: [{ role: "user", content }],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const api = {
    inspect: vi.fn(
      async (
        _input: Record<string, never>,
        requestedScope: RuntimeScope,
      ): Promise<RuntimeInspection> => ({
        ...inspection,
        scope: requestedScope,
      }),
    ),
    listTasks: vi.fn(
      async (
        _input: ListTasksInput,
        _scope: RuntimeScope,
      ): Promise<RuntimePage<RuntimeTask>> => ({ items: [], cursor: null }),
    ),
    getTask: vi.fn(
      async (
        _input: GetTaskInput,
        _scope: RuntimeScope,
      ): Promise<RuntimeTask | undefined> => undefined,
    ),
    listEntries: vi.fn(
      async (
        _input: ListEntriesInput,
        _scope: RuntimeScope,
      ): Promise<RuntimePage<RuntimeEntry>> => ({ items: [], cursor: null }),
    ),
  };
  return { api, vm: createExecutionViewModel(api) };
}

describe("execution observation ViewModel", () => {
  it("does no constructor I/O and refreshes only the selected target's read operations", async () => {
    const { api, vm } = fixture();
    for (const method of Object.values(api))
      expect(method).not.toHaveBeenCalled();
    await vm.refresh();
    await vm.loadMoreTasks();
    await vm.loadMoreEntries();
    for (const method of Object.values(api))
      expect(method).not.toHaveBeenCalled();
    await vm.setTarget(scope, conversationId);
    expect(api.inspect).toHaveBeenCalledWith({}, scope);
    expect(api.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId }),
      scope,
    );
    expect(api.listEntries).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId }),
      scope,
    );
    expect(vm.getSnapshot()).toMatchObject({
      scope,
      conversationId,
      inspection,
      tasks: [],
      entries: [],
      taskCursor: null,
      entryCursor: null,
      busy: false,
      error: null,
    });
    await vm.setTarget(scope);
    expect(api.listTasks).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ conversationId }),
      scope,
    );
    expect(api.listEntries).toHaveBeenCalledOnce();
    expect(vm.getSnapshot().conversationId).toBeUndefined();
    vm.dispose();
  });

  it("starts inspection, tasks and entries concurrently and deduplicates refresh while the same target is pending", async () => {
    const { api, vm } = fixture();
    const inspect = deferred<RuntimeInspection>();
    const tasks = deferred<RuntimePage<RuntimeTask>>();
    const entries = deferred<RuntimePage<RuntimeEntry>>();
    api.inspect.mockReturnValueOnce(inspect.promise);
    api.listTasks.mockReturnValueOnce(tasks.promise);
    api.listEntries.mockReturnValueOnce(entries.promise);
    const target = vm.setTarget(scope, conversationId);
    await vi.waitFor(() => expect(api.inspect).toHaveBeenCalledOnce());
    expect(api.inspect).toHaveBeenCalledOnce();
    expect(api.listTasks).toHaveBeenCalledOnce();
    expect(api.listEntries).toHaveBeenCalledOnce();
    const duplicate = vm.refresh();
    expect(api.inspect).toHaveBeenCalledOnce();
    expect(vm.getSnapshot().busy).toBe(true);
    inspect.resolve(inspection);
    tasks.resolve({ items: [task(1)], cursor: "tasks-next" });
    entries.resolve({ items: [entry(1)], cursor: "entries-next" });
    await Promise.all([target, duplicate]);
    expect(vm.getSnapshot()).toMatchObject({
      inspection,
      tasks: [task(1)],
      entries: [entry(1)],
      busy: false,
      error: null,
    });
    vm.dispose();
  });

  it("appends unique pages, refreshes matching IDs and preserves older loaded history and selected task", async () => {
    const { api, vm } = fixture();
    api.listTasks.mockResolvedValueOnce({
      items: [task(3), task(2)],
      cursor: "tasks-old",
    });
    api.listEntries.mockResolvedValueOnce({
      items: [entry(3), entry(2)],
      cursor: "entries-old",
    });
    await vm.setTarget(scope, conversationId);
    api.listTasks.mockResolvedValueOnce({
      items: [task(2), task(1)],
      cursor: null,
    });
    api.listEntries.mockResolvedValueOnce({
      items: [entry(2), entry(1)],
      cursor: null,
    });
    await vm.loadMoreTasks();
    await vm.loadMoreEntries();
    expect(api.listTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "tasks-old", conversationId }),
      scope,
    );
    expect(api.listEntries).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "entries-old", conversationId }),
      scope,
    );
    expect(vm.getSnapshot().tasks.map((task) => task.id)).toEqual([3, 2, 1]);
    expect(vm.getSnapshot().entries.map((entry) => entry.id)).toEqual([
      3, 2, 1,
    ]);
    api.getTask.mockResolvedValueOnce(task(1));
    await vm.selectTask(task(1).id);
    expect(vm.getSnapshot().selectedTask).toEqual(task(1));
    api.listTasks.mockResolvedValueOnce({
      items: [task(3, "terminal"), task(2, "terminal"), task(1, "terminal")],
      cursor: null,
    });
    api.listEntries.mockResolvedValueOnce({
      items: [entry(3, "Refreshed entry"), entry(2)],
      cursor: "entries-old",
    });
    await vm.refresh();
    expect(vm.getSnapshot().tasks.map((task) => task.id)).toEqual([3, 2, 1]);
    expect(vm.getSnapshot().selectedTask).toEqual(task(1, "terminal"));
    expect(vm.getSnapshot().entries).toEqual([
      entry(3, "Refreshed entry"),
      entry(2),
      entry(1),
    ]);
    api.listTasks.mockResolvedValueOnce({
      items: [task(3, "terminal")],
      cursor: null,
    });
    await vm.refresh();
    expect(vm.getSnapshot().selectedTask?.id).toBe(task(1).id);
    vm.dispose();
  });

  it("keeps Pi descending order when newly observed IDs arrive after loading older pages", async () => {
    const { api, vm } = fixture();
    api.listTasks.mockResolvedValueOnce({
      items: [task(3), task(2)],
      cursor: "older-tasks",
    });
    api.listEntries.mockResolvedValueOnce({
      items: [entry(3), entry(2)],
      cursor: "older-entries",
    });
    await vm.setTarget(scope, conversationId);
    api.listTasks.mockResolvedValueOnce({ items: [task(1)], cursor: null });
    api.listEntries.mockResolvedValueOnce({ items: [entry(1)], cursor: null });
    await vm.loadMoreTasks();
    await vm.loadMoreEntries();
    api.listTasks.mockResolvedValueOnce({
      items: [task(4), task(3, "terminal")],
      cursor: "older-tasks",
    });
    api.listEntries.mockResolvedValueOnce({
      items: [entry(4), entry(3, "Updated entry")],
      cursor: "older-entries",
    });
    await vm.refresh();
    expect(vm.getSnapshot().tasks.map((task) => task.id)).toEqual([4, 3, 2, 1]);
    expect(vm.getSnapshot().entries).toEqual([
      entry(4),
      entry(3, "Updated entry"),
      entry(2),
      entry(1),
    ]);
    expect(vm.getSnapshot().taskCursor).toBeNull();
    expect(vm.getSnapshot().entryCursor).toBeNull();
    vm.dispose();
  });

  it("does not request exhausted pages and avoids duplicate pagination in flight", async () => {
    const { api, vm } = fixture();
    api.listTasks.mockResolvedValueOnce({ items: [task(1)], cursor: "next" });
    api.listEntries.mockResolvedValueOnce({
      items: [entry(1)],
      cursor: "next",
    });
    await vm.setTarget(scope, conversationId);
    const tasks = deferred<RuntimePage<RuntimeTask>>();
    api.listTasks.mockReturnValueOnce(tasks.promise);
    const loading = vm.loadMoreTasks();
    const duplicate = vm.loadMoreTasks();
    await vi.waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(2));
    expect(api.listTasks).toHaveBeenCalledTimes(2);
    tasks.resolve({ items: [], cursor: null });
    await Promise.all([loading, duplicate]);
    const entries = deferred<RuntimePage<RuntimeEntry>>();
    api.listEntries.mockReturnValueOnce(entries.promise);
    const reading = vm.loadMoreEntries();
    const repeat = vm.loadMoreEntries();
    await vi.waitFor(() => expect(api.listEntries).toHaveBeenCalledTimes(2));
    expect(api.listEntries).toHaveBeenCalledTimes(2);
    entries.resolve({ items: [], cursor: null });
    await Promise.all([reading, repeat]);
    await vm.loadMoreTasks();
    await vm.loadMoreEntries();
    expect(api.listTasks).toHaveBeenCalledTimes(2);
    expect(api.listEntries).toHaveBeenCalledTimes(2);
    vm.dispose();
  });

  it("clears old pages and ignores late results and errors after switching a complete scope or conversation", async () => {
    for (const target of ["scope", "conversation"] as const) {
      const { api, vm } = fixture();
      api.listTasks.mockResolvedValueOnce({ items: [task(1)], cursor: "old" });
      api.listEntries.mockResolvedValueOnce({
        items: [entry(1)],
        cursor: "old",
      });
      await vm.setTarget(scope, conversationId);
      const late = deferred<RuntimePage<RuntimeTask>>();
      api.listTasks.mockReturnValueOnce(late.promise);
      const pending = vm.loadMoreTasks();
      await vi.waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(2));
      const nextScope =
        target === "scope"
          ? {
              ...scope,
              projectId: "other-project",
              environmentId: "other-environment",
              squadId: "other-squad",
              harnessId: "other-harness",
            }
          : scope;
      const nextConversation =
        target === "conversation"
          ? (18 as typeof conversationId)
          : conversationId;
      const switching = vm.setTarget(nextScope, nextConversation);
      expect(vm.getSnapshot()).toMatchObject({
        scope: nextScope,
        conversationId: nextConversation,
        tasks: [],
        entries: [],
        taskCursor: null,
        entryCursor: null,
      });
      await switching;
      const snapshot = vm.getSnapshot();
      late.reject(new Error("Old target failure"));
      await expect(pending).resolves.toBeUndefined();
      expect(vm.getSnapshot()).toBe(snapshot);
      expect(vm.getSnapshot().error).toBeNull();
      vm.dispose();
    }
  });

  it("ignores obsolete task selection results and clears an explicitly missing selected task", async () => {
    const { api, vm } = fixture();
    await vm.setTarget(scope, conversationId);
    const first = deferred<RuntimeTask | undefined>();
    api.getTask
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(task(2));
    const old = vm.selectTask(task(1).id);
    await vi.waitFor(() => expect(api.getTask).toHaveBeenCalledOnce());
    const next = vm.selectTask(task(2).id);
    try {
      await vi.waitFor(() => expect(api.getTask).toHaveBeenCalledTimes(2));
    } finally {
      first.resolve(task(1));
      await Promise.all([old, next]);
    }
    expect(vm.getSnapshot().selectedTask).toEqual(task(2));
    await vm.selectTask(task(3).id);
    expect(vm.getSnapshot().selectedTask).toBeUndefined();
    vm.dispose();
  });

  it("reports failed reads without throwing, retains known pages and clears errors after recovery", async () => {
    const { api, vm } = fixture();
    api.listTasks.mockResolvedValueOnce({ items: [task(1)], cursor: "next" });
    api.listEntries.mockResolvedValueOnce({
      items: [entry(1)],
      cursor: "next",
    });
    await vm.setTarget(scope, conversationId);
    api.listTasks.mockRejectedValueOnce(new Error("Task page unavailable"));
    await expect(vm.loadMoreTasks()).resolves.toBeUndefined();
    expect(vm.getSnapshot()).toMatchObject({
      tasks: [task(1)],
      busy: false,
      error: expect.anything(),
    });
    api.listEntries.mockRejectedValueOnce({
      message: "Entry page unavailable",
    });
    await expect(vm.loadMoreEntries()).resolves.toBeUndefined();
    expect(vm.getSnapshot().entries).toEqual([entry(1)]);
    api.getTask.mockRejectedValueOnce("Task unavailable");
    await expect(vm.selectTask(task(1).id)).resolves.toBeUndefined();
    expect(vm.getSnapshot().error).not.toBeNull();
    await vm.refresh();
    expect(vm.getSnapshot()).toMatchObject({ busy: false, error: null });
    vm.dispose();
  });

  it("reuses an identical target and preserves a newer selected task when a refresh returns late", async () => {
    const { api, vm } = fixture();
    await vm.selectTask(task(1).id);
    expect(api.getTask).not.toHaveBeenCalled();
    await vm.setTarget(scope, conversationId);
    const before = vm.getSnapshot();
    await vm.setTarget({ ...scope }, conversationId);
    expect(vm.getSnapshot()).toBe(before);
    expect(api.inspect).toHaveBeenCalledOnce();
    api.getTask.mockResolvedValueOnce(task(1));
    await vm.selectTask(task(1).id);
    const pending = deferred<RuntimeInspection>();
    api.inspect.mockReturnValueOnce(pending.promise);
    api.getTask.mockResolvedValueOnce(task(1, "terminal"));
    const refreshing = vm.refresh();
    await vi.waitFor(() => expect(api.inspect).toHaveBeenCalledTimes(2));
    api.getTask.mockResolvedValueOnce(task(2));
    await vm.selectTask(task(2).id);
    pending.resolve(inspection);
    await refreshing;
    expect(vm.getSnapshot().selectedTask).toEqual(task(2));
    vm.dispose();
  });

  it("loads task pages without a conversation and ignores obsolete entry pages and task-selection errors", async () => {
    const { api, vm } = fixture();
    api.listTasks.mockResolvedValueOnce({
      items: [task(1)],
      cursor: "task-page",
    });
    await vm.setTarget(scope);
    api.listTasks.mockResolvedValueOnce({ items: [task(2)], cursor: null });
    await vm.loadMoreTasks();
    expect(api.listTasks).toHaveBeenLastCalledWith(
      { cursor: "task-page" },
      scope,
    );
    const listener = vi.fn();
    const release = vm.subscribe(listener);
    release();
    await vm.refresh();
    expect(listener).not.toHaveBeenCalled();
    api.listEntries.mockResolvedValueOnce({
      items: [entry(1)],
      cursor: "entry-page",
    });
    await vm.setTarget(scope, conversationId);
    const entries = deferred<RuntimePage<RuntimeEntry>>();
    api.listEntries.mockReturnValueOnce(entries.promise);
    const loading = vm.loadMoreEntries();
    await vi.waitFor(() => expect(api.listEntries).toHaveBeenCalledTimes(2));
    await vm.setTarget({ ...scope, harnessId: "new-harness" }, conversationId);
    const snapshot = vm.getSnapshot();
    entries.resolve({ items: [entry(999)], cursor: null });
    await loading;
    expect(vm.getSnapshot()).toBe(snapshot);
    const oldTask = deferred<RuntimeTask | undefined>();
    api.getTask
      .mockReturnValueOnce(oldTask.promise)
      .mockResolvedValueOnce(task(2));
    const pending = vm.selectTask(task(1).id);
    await vi.waitFor(() => expect(api.getTask).toHaveBeenCalledOnce());
    await vm.selectTask(task(2).id);
    oldTask.reject(new Error("Obsolete task error"));
    await pending;
    expect(vm.getSnapshot()).toMatchObject({
      selectedTask: task(2),
      error: null,
      busy: false,
    });
    vm.dispose();
  });

  it("cancels new I/O when a subscriber disposes the ViewModel at the busy transition", async () => {
    const { api, vm } = fixture();
    vm.subscribe(() => {
      if (vm.getSnapshot().busy) vm.dispose();
    });
    await vm.setTarget(scope, conversationId);
    for (const method of Object.values(api))
      expect(method).not.toHaveBeenCalled();
  });

  it("does not publish late requests or issue new I/O after disposal and releases subscriptions", async () => {
    const { api, vm } = fixture();
    const pending = deferred<RuntimeInspection>();
    api.inspect.mockReturnValueOnce(pending.promise);
    const listener = vi.fn();
    const release = vm.subscribe(listener);
    const starting = vm.setTarget(scope, conversationId);
    await vi.waitFor(() => expect(api.inspect).toHaveBeenCalledOnce());
    vm.dispose();
    vm.dispose();
    const snapshot = vm.getSnapshot();
    const notifications = listener.mock.calls.length;
    pending.reject(new Error("Late inspection error"));
    await expect(starting).resolves.toBeUndefined();
    await vm.refresh();
    await vm.loadMoreEntries();
    await vm.loadMoreTasks();
    await vm.selectTask(task(1).id);
    await vm.setTarget({ ...scope, harnessId: "ignored" }, conversationId);
    vm.subscribe(listener)();
    release();
    release();
    expect(vm.getSnapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledTimes(notifications);
    expect(api.inspect).toHaveBeenCalledOnce();
    expect(api.listTasks).toHaveBeenCalledOnce();
    expect(api.listEntries).toHaveBeenCalledOnce();
    expect(api.getTask).not.toHaveBeenCalled();
  });
});
