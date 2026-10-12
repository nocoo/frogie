import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DefinitionBundle,
  loadDefinition,
} from "@frogie/core/definitions";
import type {
  DaemonProject,
  RuntimeBudgetSnapshot,
  RuntimeDescription,
  RuntimeInspection,
  RuntimeScope,
  RuntimeTask,
} from "@frogie/core/protocol";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRuntimeClient } from "./models/localClient.js";
import { AppView, type AppViewProps } from "./views/AppView.js";
import { ChatView } from "./views/ChatView.js";
import { DefinitionView } from "./views/DefinitionView.js";
import { ExecutionView } from "./views/ExecutionView.js";
import { ProjectOverviewView } from "./views/ProjectOverviewView.js";
import { SelectionField } from "./views/SelectionField.js";
import { WorkflowView } from "./views/WorkflowView.js";

const rootMock = vi.hoisted(() => ({
  createRoot: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  createRoot: rootMock.createRoot,
}));
vi.mock("./models/localClient.js", () => ({
  connectLocalRuntime: rootMock.connect,
}));

import { mountDashboard } from "./main.js";

type Connect = () => Promise<LocalRuntimeClient>;
type ConversationId = Parameters<
  LocalRuntimeClient["observe"]
>[0]["conversationId"];
type ConversationRecord = Awaited<
  ReturnType<LocalRuntimeClient["listConversations"]>
>[number]["conversation"];
type MountOptions = { connect?: Connect; mode?: "local" | "e2e" };
const origin = "http://127.0.0.1:4321";
const workflowFixture = fileURLToPath(
  new URL("../../../tests/fixtures/minimal-squad", import.meta.url),
);

function mount(element: HTMLElement, options?: MountOptions): () => void {
  const dispose = mountDashboard(element, options);
  disposers.push(dispose);
  return dispose;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

const scope: RuntimeScope = {
  projectId: "frogie",
  environmentId: "local-env-id",
  squadId: "zeppelin",
  harnessId: "harness-1",
};
const description: RuntimeDescription = {
  protocolVersion: 1,
  runtimeId: "runtime-1",
  scope,
  bindingHash: "binding-hash",
  piVersion: "1.1.0",
  hostVersion: "0.1.0",
  models: [],
  tools: [],
  extensions: [],
  operations: [],
};
const conversationId = 17 as ConversationId;
const otherScope: RuntimeScope = {
  projectId: "other-project",
  environmentId: "other-environment",
  squadId: "other-squad",
  harnessId: "other-harness",
};

function project(selectedScope: RuntimeScope = scope): DaemonProject {
  return {
    projectId: selectedScope.projectId,
    title: selectedScope.squadId === "zeppelin" ? "Zeppelin" : "Other Squad",
    scope: selectedScope,
    enabled: true,
    state: "running",
    definitionHash: "definition-hash",
    rootConversationId: conversationId,
  };
}

function definition(selectedScope: RuntimeScope = scope): DefinitionBundle {
  return {
    schemaVersion: 1,
    squadId: selectedScope.squadId,
    projectId: selectedScope.projectId,
    title: selectedScope.squadId === "zeppelin" ? "Zeppelin" : "Other Squad",
    rootRoleId: "command",
    content: "Fleet mission.",
    roles: ["command", "reviewer"].map((id) => ({
      id,
      title: id === "command" ? "Command" : "Reviewer",
      parentRoleId: id === "command" ? null : "command",
      content: "Work on the mission.",
      skills: [],
      extensions: [],
      tools: [],
      scripts: [],
    })),
    skills: [],
    workflows: [],
    files: [
      {
        path: "SQUAD.md",
        content: "# Mission\nOriginal body.",
        encoding: "utf8",
        mode: 0o644,
      },
    ],
    contentHash: "definition-hash",
  };
}

function createClient(overrides: Partial<LocalRuntimeClient> = {}) {
  const observers = new Map<number, (frame: never) => void>();
  const released: number[] = [];
  let directory = overrides.context?.projects ?? [project()];
  const client: LocalRuntimeClient = {
    context: { instanceId: "instance-1", mode: "local", projects: directory },
    listProjects: vi.fn(async () => directory),
    setProjectEnabled: vi.fn(async (id, enabled) => {
      directory = directory.map((item) =>
        item.projectId === id
          ? {
              ...item,
              enabled,
              state: enabled ? ("running" as const) : ("stopped" as const),
            }
          : item,
      );
      const changed = directory.find((item) => item.projectId === id);
      if (!changed) throw new Error("Project is not registered");
      return changed;
    }),
    registerProject: vi.fn(async (squadId) => {
      const registered = project({ ...otherScope, squadId });
      directory = [...directory, registered];
      return registered;
    }),
    bindDefinition: vi.fn(async (id) => {
      directory = directory.map((item) =>
        item.projectId === id
          ? {
              ...item,
              scope: { ...item.scope, harnessId: "rebound-harness" },
              definitionHash: "rebound-hash",
            }
          : item,
      );
      const changed = directory.find((item) => item.projectId === id);
      if (!changed) throw new Error("Project is not registered");
      return changed;
    }),
    caller: { id: "local-user" },
    listSquads: vi.fn(async () => [
      { id: "zeppelin", projectId: "frogie", title: "Zeppelin" },
    ]),
    loadDefinition: vi.fn(async (squadId) =>
      definition(
        directory.find((item) => item.scope.squadId === squadId)?.scope ??
          scope,
      ),
    ),
    saveDefinition: vi.fn(async (_squadId, draft) => ({
      ...definition(),
      files: definition().files.map((file) =>
        file.path === draft.path ? { ...file, content: draft.content } : file,
      ),
    })),
    describe: vi.fn(async () => description),
    inspect: vi.fn(
      async (_input, requestedScope): Promise<RuntimeInspection> => ({
        scope: requestedScope,
        scheduling: "running",
        graph: { tasks: {} },
        usage: { models: {}, tools: {} },
      }),
    ),
    listTasks: vi.fn(async () => ({ items: [], cursor: null })),
    getTask: vi.fn<LocalRuntimeClient["getTask"]>(async () => undefined),
    listEntries: vi.fn<LocalRuntimeClient["listEntries"]>(async () => ({
      items: [],
      cursor: null,
    })),
    extendBudget: vi.fn<LocalRuntimeClient["extendBudget"]>(async () => ({
      limits: { modelRequests: 12, toolEntries: 24, modelConcurrency: 2 },
      consumed: { modelRequests: 3, toolEntries: 5 },
    })),
    listConversations: vi.fn(async () => [
      {
        conversation: { id: conversationId } as ConversationRecord,
        binding: {
          conversationId,
          roleId: "command",
          definitionHash: "definition-hash",
          configHash: "config-hash",
          title: "Command",
        },
      },
    ]),
    createConversation: vi.fn(async () => ({
      conversationId,
      binding: {
        conversationId,
        roleId: "command",
        definitionHash: "definition-hash",
        configHash: "config-hash",
        title: "Command",
      },
    })),
    submit: vi.fn(async () => 23 as never),
    getSubmission: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    compact: vi.fn(
      async () => 42 as Awaited<ReturnType<LocalRuntimeClient["compact"]>>,
    ),
    observe: vi.fn((input, listener, _onError, requestedScope) => {
      observers.set(input.conversationId, listener as (frame: never) => void);
      listener({
        type: "snapshot",
        scope: requestedScope,
        conversationId: input.conversationId,
        value: {
          conversation: { id: input.conversationId } as ConversationRecord,
          entries: [],
          docs: {},
        },
      });
      return () => released.push(input.conversationId);
    }),
    dispose: vi.fn(),
    ...overrides,
  };
  return { client, observers, released };
}

function makeRoot() {
  const render = vi.fn();
  const unmount = vi.fn();
  rootMock.createRoot.mockReturnValue({ render, unmount });
  return { render, unmount };
}

function currentApp(
  render: ReturnType<typeof makeRoot>["render"],
): ReactElement<AppViewProps> {
  const element = render.mock.calls.at(-1)?.[0];
  if (!isValidElement<AppViewProps>(element) || element.type !== AppView)
    throw new Error("Expected AppView root element");
  return element;
}

function findElement<T>(
  node: ReactNode,
  component: (props: T) => ReactNode,
): ReactElement<T> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, component);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  if (node.type === component) return node as ReactElement<T>;
  const props = node.props as {
    children?: ReactNode;
    conversationSelector?: ReactNode;
    roleSelector?: ReactNode;
    details?: ReactNode;
  };
  return findElement(
    [
      props.children,
      props.conversationSelector,
      props.roleSelector,
      props.details,
    ],
    component,
  );
}

const elements: HTMLElement[] = [];
const disposers: Array<() => void> = [];

beforeEach(() => {
  vi.resetAllMocks();
  elements.length = 0;
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mountDashboard execution wiring", () => {
  it("reads and renders actual execution data in chat without starting conversation work", async () => {
    const native: RuntimeTask = {
      id: 42 as never,
      conversationId,
      kind: "pi.tool",
      background: false,
      abortRequested: false,
      state: { status: "terminal", outcome: "completed" },
      tool: {
        callId: "tool-call",
        name: "read_artifact",
        arguments: { id: "artifact" },
        argumentsSource: "requested",
        output: "Actual public result",
      },
    };
    const historyEntry = {
      id: 1 as never,
      conversationId,
      kind: "pi.user",
      messages: [{ role: "user" as const, content: "Actual paged entry" }],
    };
    const { client } = createClient({
      listTasks: vi.fn(async () => ({ items: [native], cursor: "more-tasks" })),
      listEntries: vi.fn(async () => ({
        items: [historyEntry],
        cursor: "more-entries",
      })),
    });
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    currentApp(root.render).props.onPageChange("chat");
    await vi.waitFor(() =>
      expect(client.inspect).toHaveBeenCalledWith({}, scope),
    );
    expect(client.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId }),
      scope,
    );
    expect(client.listEntries).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId }),
      scope,
    );
    await vi.waitFor(() =>
      expect(
        findElement(currentApp(root.render).props.children, ExecutionView)
          ?.props.snapshot.busy,
      ).toBe(false),
    );
    const view = findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    );
    expect(view).toBeDefined();
    expect(JSON.stringify(view?.props)).toContain("read_artifact");
    expect(JSON.stringify(view?.props)).toContain("Actual public result");
    expect(view?.props.snapshot).toMatchObject({
      scope,
      conversationId,
      tasks: [native],
      busy: false,
      error: null,
    });
    vi.mocked(client.getTask).mockResolvedValueOnce(native);
    await view?.props.onSelectTask(native.id);
    expect(client.getTask).toHaveBeenCalledWith({ taskId: native.id }, scope);
    expect(
      findElement(currentApp(root.render).props.children, ExecutionView)?.props
        .snapshot.selectedTask,
    ).toEqual(native);
    await findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    )?.props.onRefresh();
    expect(client.inspect).toHaveBeenCalledTimes(2);
    await findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    )?.props.onLoadMoreTasks();
    expect(client.listTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId, cursor: "more-tasks" }),
      scope,
    );
    await findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    )?.props.onLoadMoreEntries();
    expect(client.listEntries).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId, cursor: "more-entries" }),
      scope,
    );
    expect(client.submit).not.toHaveBeenCalled();
    expect(client.compact).not.toHaveBeenCalled();
  });
});

describe("mountDashboard execution lifecycle", () => {
  it("budget grant in flight blocks conversation, project and page changes until acknowledgement", async () => {
    vi.useFakeTimers();
    const budget: RuntimeBudgetSnapshot = {
      limits: { modelRequests: 12, toolEntries: 24, modelConcurrency: 2 },
      consumed: { modelRequests: 3, toolEntries: 5 },
    };
    const grant = deferred<RuntimeBudgetSnapshot>();
    const { client } = createClient({
      context: {
        instanceId: "instance-1",
        mode: "local",
        projects: [project(), project(otherScope)],
      },
      inspect: vi.fn<LocalRuntimeClient["inspect"]>(
        async (_input, requestedScope) => ({
          scope: requestedScope,
          scheduling: "running",
          graph: { tasks: {} },
          usage: { models: {}, tools: {} },
          budget,
        }),
      ),
      extendBudget: vi.fn<LocalRuntimeClient["extendBudget"]>(
        () => grant.promise,
      ),
    });
    const records = await client.listConversations({}, scope);
    const first = records[0];
    if (!first) throw new Error("Missing conversation fixture");
    vi.mocked(client.listConversations).mockResolvedValue([
      first,
      {
        ...first,
        conversation: { id: 18 as ConversationId } as ConversationRecord,
      },
    ]);
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.advanceTimersByTimeAsync(0);
    currentApp(root.render).props.onPageChange("chat");
    await vi.advanceTimersByTimeAsync(0);
    const previous = findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    )?.props;
    if (!previous) throw new Error("Missing budget callbacks");
    previous.onBudgetDraftChange("modelRequests", "4");
    const saving = previous.onExtendBudget();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(client.extendBudget).toHaveBeenCalledOnce();
      const app = currentApp(root.render);
      const chat = findElement(app.props.children, ChatView)?.props;
      if (!chat) throw new Error("Missing chat while granting budget");
      expect(chat.canSend).toBe(false);
      await chat.onSend("Do not submit while the grant is unconfirmed");
      expect(client.submit).not.toHaveBeenCalled();
      expect(client.createConversation).not.toHaveBeenCalled();
      const selector = findElement(
        chat?.conversationSelector,
        SelectionField,
      )?.props;
      selector?.onValueChange?.("18");
      await vi.advanceTimersByTimeAsync(0);
      expect(
        findElement(currentApp(root.render).props.children, ExecutionView)
          ?.props.snapshot.conversationId,
      ).toBe(conversationId);
      currentApp(root.render).props.onSquadChange(otherScope.squadId);
      await vi.advanceTimersByTimeAsync(0);
      expect(
        findElement(currentApp(root.render).props.children, ExecutionView)
          ?.props.snapshot.scope,
      ).toEqual(scope);
      currentApp(root.render).props.onPageChange("overview");
      await vi.advanceTimersByTimeAsync(0);
      expect(currentApp(root.render).props.page).toBe("chat");
      expect(
        findElement(currentApp(root.render).props.children, ExecutionView)
          ?.props.snapshot.budgetSaving,
      ).toBe(true);
      expect(client.submit).not.toHaveBeenCalled();
      expect(client.createConversation).not.toHaveBeenCalled();
    } finally {
      grant.resolve(budget);
      await saving;
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(
      findElement(currentApp(root.render).props.children, ExecutionView)?.props
        .snapshot.budgetDraft,
    ).toEqual({ modelRequests: "", toolEntries: "", minutes: "" });
    const chat = findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props;
    findElement(
      chat?.conversationSelector,
      SelectionField,
    )?.props.onValueChange?.("18");
    await vi.advanceTimersByTimeAsync(0);
    expect(
      findElement(currentApp(root.render).props.children, ExecutionView)?.props
        .snapshot.conversationId,
    ).toBe(18);
    currentApp(root.render).props.onSquadChange(otherScope.squadId);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      findElement(currentApp(root.render).props.children, ExecutionView)?.props
        .snapshot.scope,
    ).toEqual(otherScope);
    currentApp(root.render).props.onPageChange("overview");
    expect(currentApp(root.render).props.page).toBe("overview");
  });
  it("budget UI callbacks grant only their rendered target and cannot mutate a replacement scope", async () => {
    vi.useFakeTimers();
    const budget: RuntimeBudgetSnapshot = {
      limits: { modelRequests: 12, toolEntries: 24, modelConcurrency: 2 },
      consumed: { modelRequests: 3, toolEntries: 5 },
    };
    const { client } = createClient({
      context: {
        instanceId: "instance-1",
        mode: "local",
        projects: [project(), project(otherScope)],
      },
      inspect: vi.fn<LocalRuntimeClient["inspect"]>(
        async (_input, requestedScope) => ({
          scope: requestedScope,
          scheduling: "running",
          graph: { tasks: {} },
          usage: { models: {}, tools: {} },
          budget,
        }),
      ),
    });
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.advanceTimersByTimeAsync(0);
    currentApp(root.render).props.onPageChange("chat");
    await vi.advanceTimersByTimeAsync(0);
    const previous = findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    )?.props;
    if (!previous) throw new Error("Missing budget view callbacks");
    previous.onBudgetDraftChange("modelRequests", "4");
    await previous.onExtendBudget();
    expect(client.extendBudget).toHaveBeenCalledWith(
      { requestId: expect.any(String), modelRequests: 4 },
      scope,
    );
    expect(
      findElement(currentApp(root.render).props.children, ExecutionView)?.props
        .snapshot.budgetDraft,
    ).toEqual({ modelRequests: "", toolEntries: "", minutes: "" });
    currentApp(root.render).props.onSquadChange(otherScope.squadId);
    await vi.advanceTimersByTimeAsync(0);
    const current = findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    )?.props;
    expect(current?.snapshot.scope).toEqual(otherScope);
    const calls = vi.mocked(client.extendBudget).mock.calls.length;
    previous.onBudgetDraftChange("toolEntries", "99");
    await previous.onExtendBudget();
    expect(client.extendBudget).toHaveBeenCalledTimes(calls);
    expect(
      findElement(currentApp(root.render).props.children, ExecutionView)?.props
        .snapshot.budgetDraft,
    ).toEqual({ modelRequests: "", toolEntries: "", minutes: "" });
    current?.onBudgetDraftChange("toolEntries", "2");
    await current?.onExtendBudget();
    expect(client.extendBudget).toHaveBeenLastCalledWith(
      { requestId: expect.any(String), toolEntries: 2 },
      otherScope,
    );
    expect(client.submit).not.toHaveBeenCalled();
    expect(client.cancel).not.toHaveBeenCalled();
    expect(client.compact).not.toHaveBeenCalled();
    expect(client.createConversation).not.toHaveBeenCalled();
  });
  it("refreshes execution serially and stops polling and late updates on dispose", async () => {
    vi.useFakeTimers();
    const { client, released } = createClient();
    const pending = deferred<RuntimeInspection>();
    vi.mocked(client.inspect).mockReturnValueOnce(pending.promise);
    const root = makeRoot();
    const dispose = mount({ nodeType: 1 } as HTMLElement, {
      connect: async () => client,
    });
    await vi.advanceTimersByTimeAsync(0);
    currentApp(root.render).props.onPageChange("chat");
    await vi.advanceTimersByTimeAsync(0);
    expect(client.inspect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.inspect).toHaveBeenCalledOnce();
    pending.resolve({
      scope,
      scheduling: "paused",
      graph: { tasks: {} },
      usage: { models: {}, tools: {} },
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.inspect).toHaveBeenCalledTimes(2);
    const late = deferred<RuntimeInspection>();
    vi.mocked(client.inspect).mockReturnValueOnce(late.promise);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.inspect).toHaveBeenCalledTimes(3);
    dispose();
    const renders = root.render.mock.calls.length;
    late.resolve({
      scope,
      scheduling: "running",
      graph: { tasks: {} },
      usage: { models: {}, tools: {} },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.inspect).toHaveBeenCalledTimes(3);
    expect(root.render).toHaveBeenCalledTimes(renders);
    expect(released).toContain(conversationId);
    expect(vi.getTimerCount()).toBe(0);
    expect(client.submit).not.toHaveBeenCalled();
  });

  it("does not inspect a stopped project while its definitions remain available", async () => {
    const stopped = { ...project(), enabled: false, state: "stopped" as const };
    const { client } = createClient({
      context: { instanceId: "instance-1", mode: "local", projects: [stopped] },
    });
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    currentApp(root.render).props.onPageChange("chat");
    expect(client.inspect).not.toHaveBeenCalled();
    expect(client.listTasks).not.toHaveBeenCalled();
    expect(client.listEntries).not.toHaveBeenCalled();
    currentApp(root.render).props.onPageChange("definitions");
    expect(
      findElement(currentApp(root.render).props.children, DefinitionView)?.props
        .files,
    ).toHaveLength(1);
  });

  it("does not route retained execution callbacks into a newly selected project with overlapping Task IDs", async () => {
    vi.useFakeTimers();
    const { client } = createClient({
      context: {
        instanceId: "instance-1",
        mode: "local",
        projects: [project(), project(otherScope)],
      },
      listTasks: vi.fn(async () => ({ items: [], cursor: "more-tasks" })),
      listEntries: vi.fn(async () => ({ items: [], cursor: "more-entries" })),
    });
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.advanceTimersByTimeAsync(0);
    currentApp(root.render).props.onPageChange("chat");
    await vi.advanceTimersByTimeAsync(0);
    const previous = findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    )?.props;
    if (!previous) throw new Error("Missing previous execution callbacks");
    currentApp(root.render).props.onSquadChange(otherScope.squadId);
    await vi.advanceTimersByTimeAsync(0);
    const current = findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    )?.props;
    expect(current?.snapshot.scope).toEqual(otherScope);
    const methods = [
      client.inspect,
      client.listTasks,
      client.listEntries,
      client.getTask,
    ];
    const calls = methods.map((method) => vi.mocked(method).mock.calls.length);
    await previous.onRefresh();
    await previous.onSelectTask(42 as never);
    await previous.onLoadMoreTasks();
    await previous.onLoadMoreEntries();
    expect(
      methods.map((method) => vi.mocked(method).mock.calls.length),
    ).toEqual(calls);
    expect(client.submit).not.toHaveBeenCalled();
    expect(client.compact).not.toHaveBeenCalled();
  });

  it("drops old execution results when changing conversation or complete project scope", async () => {
    const { client } = createClient({
      context: {
        instanceId: "instance-1",
        mode: "local",
        projects: [project(), project(otherScope)],
      },
    });
    const records = await client.listConversations({}, scope);
    const first = records[0];
    if (!first) throw new Error("Missing fixture conversation");
    vi.mocked(client.listConversations)
      .mockClear()
      .mockResolvedValue([
        first,
        {
          ...first,
          conversation: { id: 18 as ConversationId } as ConversationRecord,
        },
      ]);
    const old = deferred<RuntimeInspection>();
    vi.mocked(client.inspect).mockReturnValueOnce(old.promise);
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    currentApp(root.render).props.onPageChange("chat");
    await vi.waitFor(() => expect(client.inspect).toHaveBeenCalledOnce());
    const chat = findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props;
    findElement(
      chat?.conversationSelector,
      SelectionField,
    )?.props.onValueChange?.("18");
    await vi.waitFor(() =>
      expect(client.listEntries).toHaveBeenLastCalledWith(
        expect.objectContaining({ conversationId: 18 }),
        scope,
      ),
    );
    old.resolve({
      scope,
      scheduling: "closing",
      graph: { tasks: {} },
      usage: { models: {}, tools: {} },
    });
    await Promise.resolve();
    const next = findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    )?.props.snapshot;
    expect(next?.conversationId).toBe(18);
    expect(next?.inspection?.scheduling).not.toBe("closing");
    const late = deferred<RuntimeInspection>();
    vi.mocked(client.inspect).mockReturnValueOnce(late.promise);
    const refreshing = findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    )?.props.onRefresh();
    currentApp(root.render).props.onSquadChange(otherScope.squadId);
    await vi.waitFor(() =>
      expect(client.listEntries).toHaveBeenLastCalledWith(
        expect.objectContaining({ conversationId }),
        otherScope,
      ),
    );
    late.resolve({
      scope,
      scheduling: "closing",
      graph: { tasks: {} },
      usage: { models: {}, tools: {} },
    });
    await refreshing;
    const current = findElement(
      currentApp(root.render).props.children,
      ExecutionView,
    )?.props.snapshot;
    expect(current?.scope).toEqual(otherScope);
    expect(current?.inspection?.scheduling).not.toBe("closing");
  });
});

describe("mountDashboard client wiring", () => {
  it("shows loading, then loads the connected runtime scope through the real ViewModel", async () => {
    const pending = deferred<LocalRuntimeClient>();
    const connect = vi.fn<Connect>(() => pending.promise);
    const element = { nodeType: 1 } as HTMLElement;
    const root = makeRoot();
    elements.push(element);

    mount(element, { connect, mode: "e2e" });
    expect(connect).toHaveBeenCalledOnce();
    expect(currentApp(root.render).props).toMatchObject({
      mode: "e2e",
      busy: true,
      squads: [],
      selectedSquadId: null,
    });

    const { client } = createClient();
    pending.resolve(client);
    await vi.waitFor(() =>
      expect(currentApp(root.render).props).toMatchObject({
        mode: "e2e",
        squads: [{ id: "zeppelin", title: "Zeppelin" }],
        selectedSquadId: "zeppelin",
        busy: false,
        error: null,
      }),
    );
    expect(client.loadDefinition).toHaveBeenCalledWith("zeppelin");
    expect(client.listConversations).toHaveBeenCalledWith({}, scope);
    expect(client.listSquads).toHaveBeenCalledOnce();
  });

  it("shows E2E from daemon mode rather than interpreting the environment ID", async () => {
    const { client } = createClient({
      context: {
        instanceId: "e2e-instance",
        mode: "e2e",
        projects: [project()],
      },
    });
    const root = makeRoot();
    const element = { nodeType: 1 } as HTMLElement;
    elements.push(element);
    mount(element, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props).toMatchObject({
        mode: "e2e",
        busy: false,
        selectedSquadId: "zeppelin",
        error: null,
      }),
    );
  });

  it("starts directly without reading or clearing URL fragments or forwarding tokens", async () => {
    const connected = createClient().client;
    rootMock.connect.mockResolvedValue(connected);
    const hash = vi.fn(() => "#token=must-not-be-read");
    const replaceState = vi.fn();
    const element = { nodeType: 1 } as HTMLElement;
    elements.push(element);
    vi.stubGlobal("document", { getElementById: () => element });
    vi.stubGlobal("location", {
      get hash() {
        return hash();
      },
      origin,
    });
    vi.stubGlobal("history", { replaceState });

    const root = makeRoot();
    mount(element);
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    expect(rootMock.connect).toHaveBeenCalledWith({ origin });
    expect(hash).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(currentApp(root.render).props.error).toBeNull();
  });

  it("drives definition draft/save callbacks from the connected VM and renders the refreshed definition", async () => {
    const { client } = createClient();
    const connect = vi.fn<Connect>().mockResolvedValue(client);
    const root = makeRoot();
    const element = { nodeType: 1 } as HTMLElement;
    elements.push(element);
    const dispose = mount(element, { connect });
    await vi.waitFor(() =>
      expect(client.loadDefinition).toHaveBeenCalledOnce(),
    );
    currentApp(root.render).props.onPageChange("definitions");
    const definitionView = findElement(
      currentApp(root.render).props.children,
      DefinitionView,
    );
    expect(definitionView).toBeDefined();
    definitionView?.props.onDraftChange("# Mission\nUpdated body.");
    const afterEdit = findElement(
      currentApp(root.render).props.children,
      DefinitionView,
    );
    expect(afterEdit?.props.dirty).toBe(true);
    expect(afterEdit?.props.draft).toBe("# Mission\nUpdated body.");
    await afterEdit?.props.onSave();
    expect(client.saveDefinition).toHaveBeenCalledWith(
      "zeppelin",
      {
        path: "SQUAD.md",
        content: "# Mission\nUpdated body.",
        baseContent: "# Mission\nOriginal body.",
      },
      expect.any(String),
    );
    expect(
      findElement(currentApp(root.render).props.children, DefinitionView)?.props
        .dirty,
    ).toBe(false);
    dispose();
  });

  it("wires Chat send, stop and compact using a title derived from the Pi conversation ID", async () => {
    const { client } = createClient();
    const connect = vi.fn<Connect>().mockResolvedValue(client);
    const root = makeRoot();
    const element = { nodeType: 1 } as HTMLElement;
    elements.push(element);
    const dispose = mount(element, { connect });
    await vi.waitFor(() =>
      expect(client.listConversations).toHaveBeenCalledOnce(),
    );
    currentApp(root.render).props.onPageChange("chat");
    const chat = findElement(currentApp(root.render).props.children, ChatView);
    expect(chat?.props.title).toBe(`会话 ${conversationId}`);
    await chat?.props.onSend("User request");
    expect(client.submit).toHaveBeenCalledWith(
      {
        conversationId,
        submission: expect.objectContaining({
          type: "input",
          content: "User request",
        }),
      },
      scope,
    );
    await chat?.props.onStop();
    expect(client.cancel).toHaveBeenCalledWith({ conversationId }, scope);
    await chat?.props.onCompact();
    expect(client.compact).toHaveBeenCalledWith({ conversationId }, scope);
    dispose();
  });

  it("disposes VM subscriptions and client after unmount", async () => {
    const { client, released } = createClient();
    const connect = vi.fn<Connect>().mockResolvedValue(client);
    const root = makeRoot();
    const element = { nodeType: 1 } as HTMLElement;
    elements.push(element);
    const dispose = mount(element, { connect });
    await vi.waitFor(() =>
      expect(client.listConversations).toHaveBeenCalledOnce(),
    );
    dispose();
    expect(client.dispose).toHaveBeenCalledOnce();
    expect(released).toContain(conversationId);
    expect(root.unmount).toHaveBeenCalledOnce();
  });

  it("disposes a client that connects after the mount is disposed and does not render late", async () => {
    const pending = deferred<LocalRuntimeClient>();
    const connect = vi.fn<Connect>(() => pending.promise);
    const root = makeRoot();
    const element = { nodeType: 1 } as HTMLElement;
    elements.push(element);
    const dispose = mount(element, { connect });
    const rendersAtDispose = root.render.mock.calls.length;
    dispose();
    const { client } = createClient();
    pending.resolve(client);
    await vi.waitFor(() => expect(client.dispose).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(root.render).toHaveBeenCalledTimes(rendersAtDispose);
    expect(client.listSquads).not.toHaveBeenCalled();
    expect(client.loadDefinition).not.toHaveBeenCalled();
  });

  it("ignores pending VM loads and releases the connected client on dispose", async () => {
    const { client } = createClient();
    const pendingDefinition = deferred<DefinitionBundle>();
    vi.mocked(client.loadDefinition).mockReturnValue(pendingDefinition.promise);
    const connect = vi.fn<Connect>().mockResolvedValue(client);
    const root = makeRoot();
    const element = { nodeType: 1 } as HTMLElement;
    elements.push(element);
    const dispose = mount(element, { connect });
    await vi.waitFor(() =>
      expect(client.loadDefinition).toHaveBeenCalledOnce(),
    );
    dispose();
    const rendersAtDispose = root.render.mock.calls.length;
    pendingDefinition.resolve(definition());
    await Promise.resolve();
    expect(root.render).toHaveBeenCalledTimes(rendersAtDispose);
    expect(client.dispose).toHaveBeenCalledOnce();
  });

  it("retains independent drafts when switching conversations", async () => {
    const { client } = createClient();
    const records = await client.listConversations({}, scope);
    const first = records[0];
    if (!first) throw new Error("Missing fixture conversation");
    vi.mocked(client.listConversations).mockResolvedValue([
      first,
      {
        ...first,
        conversation: { ...first.conversation, id: 18 as ConversationId },
      },
    ]);
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() => expect(client.observe).toHaveBeenCalledTimes(2));
    currentApp(root.render).props.onPageChange("chat");
    const chat = () =>
      findElement(currentApp(root.render).props.children, ChatView)?.props;
    const selector = () =>
      findElement(currentApp(root.render).props.children, SelectionField)
        ?.props;
    chat()?.onDraftChange("First draft");
    selector()?.onValueChange?.("18");
    expect(chat()?.draft).toBe("");
    chat()?.onDraftChange("Second draft");
    selector()?.onValueChange?.("17");
    expect(chat()?.draft).toBe("First draft");
    selector()?.onValueChange?.("18");
    expect(chat()?.draft).toBe("Second draft");
  });

  it("preserves a failed send for retry and suppresses duplicate in-flight sends", async () => {
    const { client } = createClient();
    const pending =
      deferred<Awaited<ReturnType<LocalRuntimeClient["submit"]>>>();
    vi.mocked(client.submit).mockReturnValueOnce(pending.promise);
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() => expect(client.observe).toHaveBeenCalledOnce());
    currentApp(root.render).props.onPageChange("chat");
    const props = findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props;
    const sending = props?.onSend("Retry this");
    await props?.onSend("Retry this");
    expect(client.submit).toHaveBeenCalledOnce();
    const failedSend = expect(sending).rejects.toThrow(
      "Connection interrupted",
    );
    pending.reject(new Error("Connection interrupted"));
    await failedSend;
    const failed = findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props;
    expect(failed).toMatchObject({
      draft: "Retry this",
      error: "Connection interrupted",
      sending: false,
    });
    expect(currentApp(root.render).props.error).toBeNull();
    await failed?.onSend("Retry this");
    expect(client.submit).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(client.submit).mock.calls;
    expect(calls[0]?.[0].submission.requestId).toBe(
      calls[1]?.[0].submission.requestId,
    );
    expect(
      findElement(currentApp(root.render).props.children, ChatView)?.props
        .draft,
    ).toBe("");
  });

  it("rejects invalid roots, deduplicates mounts and ignores retained callbacks after disposal", async () => {
    expect(() => mountDashboard(undefined as unknown as HTMLElement)).toThrow();
    const { client } = createClient();
    const root = makeRoot();
    const element = { nodeType: 1 } as HTMLElement;
    const dispose = mount(element, { connect: async () => client });
    expect(mountDashboard(element)).toBe(dispose);
    await vi.waitFor(() => expect(client.observe).toHaveBeenCalledOnce());
    currentApp(root.render).props.onPageChange("chat");
    const app = currentApp(root.render).props;
    const chat = findElement(app.children, ChatView)?.props;
    const selector = findElement(app.children, SelectionField)?.props;
    currentApp(root.render).props.onPageChange("definitions");
    const definition = findElement(
      currentApp(root.render).props.children,
      DefinitionView,
    )?.props;
    dispose();
    dispose();
    const count = root.render.mock.calls.length;
    app.onPageChange("definitions");
    app.onSquadChange("other");
    app.onModeChange("e2e");
    app.onCreateSquad();
    chat?.onDraftChange("ignored");
    selector?.onValueChange?.("17");
    definition?.onFileSelect("SQUAD.md");
    vi.mocked(client.observe).mock.calls[0]?.[2]({
      code: "runtime_unavailable",
      message: "Late error",
      retryable: true,
    });
    await chat?.onSend("ignored");
    expect(root.render).toHaveBeenCalledTimes(count);
    expect(root.unmount).toHaveBeenCalledOnce();
    expect(client.submit).not.toHaveBeenCalled();
    mount(element, { connect: async () => createClient().client });
    expect(rootMock.createRoot).toHaveBeenCalledTimes(2);
  });

  it("preserves connection failures in an empty Workflow view and keeps unfinished evals honest", async () => {
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, {
      connect: async () => {
        throw new Error("offline");
      },
    });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.error).toBe("offline"),
    );
    currentApp(root.render).props.onPageChange("workflows");
    const workflow = findElement(
      currentApp(root.render).props.children,
      WorkflowView,
    )?.props;
    expect(workflow).toMatchObject({
      workflow: undefined,
      workflows: [],
      roles: [],
      selectedNodeId: null,
      busy: false,
      dirty: false,
      error: "offline",
    });
    expect(currentApp(root.render).props.error).toBe("offline");
    currentApp(root.render).props.onPageChange("evals");
    expect(JSON.stringify(currentApp(root.render).props.children)).toContain(
      "功能尚未接入",
    );
    expect(currentApp(root.render).props.error).toBe("offline");
    currentApp(root.render).props.onPageChange("chat");
    const chat = findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props;
    expect(chat?.canSend).toBe(false);
    findElement(
      currentApp(root.render).props.children,
      SelectionField,
    )?.props.onValueChange?.("missing");
    await chat?.onSend("ignored");
    await chat?.onStop();
    await chat?.onCompact();
    currentApp(root.render).props.onPageChange("definitions");
    const definition = findElement(
      currentApp(root.render).props.children,
      DefinitionView,
    )?.props;
    definition?.onDraftChange("ignored");
    await definition?.onSave();
    await definition?.onCreate();
  });

  it("shows observation errors without changing the bound scope", async () => {
    const { client } = createClient();
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() => expect(client.observe).toHaveBeenCalledOnce());
    currentApp(root.render).props.onSquadChange("zeppelin");
    expect(currentApp(root.render).props.error).toBeNull();
    currentApp(root.render).props.onSquadChange("other");
    expect(currentApp(root.render).props.selectedSquadId).toBe("zeppelin");
    expect(currentApp(root.render).props.error).toBeTruthy();
    vi.mocked(client.observe).mock.calls[0]?.[2]({
      code: "runtime_unavailable",
      message: "Disconnected",
      retryable: true,
    });
    expect(currentApp(root.render).props.error).toBe("Disconnected");
  });

  it("creates the root role conversation on the first message", async () => {
    const { client } = createClient({
      listConversations: vi.fn(async () => []),
    });
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    currentApp(root.render).props.onPageChange("chat");
    const chat = findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props;
    expect(chat?.title).toBe("新对话");
    chat?.onDraftChange("First message");
    await chat?.onSend("First message");
    expect(client.createConversation).toHaveBeenCalledWith(
      {
        roleId: "command",
      },
      scope,
    );
    expect(client.submit).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId }),
      scope,
    );
    expect(
      findElement(currentApp(root.render).props.children, ChatView)?.props
        .title,
    ).toBe(`会话 ${conversationId}`);
  });

  it("selects another Markdown file and preserves the source after a failed save", async () => {
    const second = {
      path: "roles/ROLE.md",
      content: "# Role",
      encoding: "utf8" as const,
      mode: 0o644,
    };
    const { client } = createClient({
      loadDefinition: vi.fn(async () => ({
        ...definition(),
        files: [...definition().files, second],
      })),
    });
    vi.mocked(client.saveDefinition).mockRejectedValueOnce(
      new Error("External edit conflict"),
    );
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() => expect(client.observe).toHaveBeenCalledOnce());
    currentApp(root.render).props.onPageChange("definitions");
    const props = () =>
      findElement(currentApp(root.render).props.children, DefinitionView)
        ?.props;
    props()?.onFileSelect(second.path);
    expect(props()?.draft).toBe(second.content);
    props()?.onDraftChange("New role body");
    await props()?.onSave();
    expect(props()).toMatchObject({
      dirty: true,
      draft: "New role body",
      error: "External edit conflict",
    });
  });

  it("keeps text entered while a send is pending and ignores late rejection after unmount", async () => {
    const { client } = createClient();
    const pending =
      deferred<Awaited<ReturnType<LocalRuntimeClient["submit"]>>>();
    vi.mocked(client.submit).mockReturnValueOnce(pending.promise);
    const root = makeRoot();
    const dispose = mount({ nodeType: 1 } as HTMLElement, {
      connect: async () => client,
    });
    await vi.waitFor(() => expect(client.observe).toHaveBeenCalledOnce());
    currentApp(root.render).props.onPageChange("chat");
    const props = () =>
      findElement(currentApp(root.render).props.children, ChatView)?.props;
    const sending = props()?.onSend("First input");
    props()?.onDraftChange("Next input");
    pending.resolve(23 as Awaited<ReturnType<LocalRuntimeClient["submit"]>>);
    await sending;
    expect(props()?.draft).toBe("Next input");
    const second =
      deferred<Awaited<ReturnType<LocalRuntimeClient["submit"]>>>();
    vi.mocked(client.submit).mockReturnValueOnce(second.promise);
    const late = props()?.onSend("Next input");
    const lateFailure = expect(late).rejects.toThrow("Late network failure");
    dispose();
    const count = root.render.mock.calls.length;
    second.reject(new Error("Late network failure"));
    await lateFailure;
    expect(root.render).toHaveBeenCalledTimes(count);
  });

  it("selects the first running project and shows stopped projects in the global overview", async () => {
    const stopped = {
      ...project(otherScope),
      enabled: false,
      state: "stopped" as const,
    };
    const running = project();
    const { client } = createClient({
      context: {
        instanceId: "daemon-directory",
        mode: "e2e",
        projects: [stopped, running],
      },
    });
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    const overview = findElement(
      currentApp(root.render).props.children,
      ProjectOverviewView,
    )?.props;
    expect(overview).toMatchObject({
      projects: [stopped, running],
      selectedProjectId: scope.projectId,
    });
    expect(currentApp(root.render).props.selectedSquadId).toBe(scope.squadId);
    expect(client.loadDefinition).toHaveBeenCalledWith(scope.squadId);
    expect(client.listConversations).toHaveBeenCalledWith({}, scope);
  });

  it("switches registered projects without reconnecting and keeps drafts separate for colliding Pi conversation IDs", async () => {
    const { client, released } = createClient({
      context: {
        instanceId: "daemon-directory",
        mode: "local",
        projects: [project(), project(otherScope)],
      },
    });
    const connect = vi.fn<Connect>().mockResolvedValue(client);
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    currentApp(root.render).props.onPageChange("chat");
    const chat = () =>
      findElement(currentApp(root.render).props.children, ChatView)?.props;
    chat()?.onDraftChange("Alpha draft");
    currentApp(root.render).props.onSquadChange(otherScope.squadId);
    await vi.waitFor(() =>
      expect(currentApp(root.render).props).toMatchObject({
        selectedSquadId: otherScope.squadId,
        busy: false,
      }),
    );
    expect(released).toContain(conversationId);
    expect(chat()?.draft).toBe("");
    chat()?.onDraftChange("Beta draft");
    expect(client.listConversations).toHaveBeenLastCalledWith({}, otherScope);
    expect(vi.mocked(client.observe).mock.calls.at(-1)?.[3]).toEqual(
      otherScope,
    );
    const oldObservation = vi.mocked(client.observe).mock.calls[0];
    oldObservation?.[1]({
      type: "update",
      scope,
      conversationId,
      value: {
        conversation: { id: conversationId } as ConversationRecord,
        entries: [
          {
            id: 99 as never,
            conversationId,
            kind: "pi.user",
            model: [
              {
                role: "user",
                content: "Old project frame must not leak",
                timestamp: 1,
              },
            ],
          },
        ],
        docs: {},
      },
    });
    expect(chat()?.entries).toEqual([]);
    currentApp(root.render).props.onSquadChange(scope.squadId);
    await vi.waitFor(() =>
      expect(currentApp(root.render).props).toMatchObject({
        selectedSquadId: scope.squadId,
        busy: false,
      }),
    );
    expect(chat()?.draft).toBe("Alpha draft");
    currentApp(root.render).props.onSquadChange(otherScope.squadId);
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    expect(chat()?.draft).toBe("Beta draft");
    expect(connect).toHaveBeenCalledOnce();
    expect(client.dispose).not.toHaveBeenCalled();
    expect(client.cancel).not.toHaveBeenCalled();
    expect(client.setProjectEnabled).not.toHaveBeenCalled();
    expect(client.bindDefinition).not.toHaveBeenCalled();
  });

  it("keeps a pending chat request in its original scope and blocks both project selection routes", async () => {
    const { client } = createClient({
      context: {
        instanceId: "daemon-directory",
        mode: "local",
        projects: [project(), project(otherScope)],
      },
    });
    const pending =
      deferred<Awaited<ReturnType<LocalRuntimeClient["submit"]>>>();
    vi.mocked(client.submit).mockReturnValueOnce(pending.promise);
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    currentApp(root.render).props.onPageChange("chat");
    const chat = findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props;
    const sending = chat?.onSend("Do not change projects during submission");
    currentApp(root.render).props.onSquadChange(otherScope.squadId);
    currentApp(root.render).props.onPageChange("overview");
    findElement(
      currentApp(root.render).props.children,
      ProjectOverviewView,
    )?.props.onSelect(otherScope.projectId);
    expect(client.listConversations).toHaveBeenCalledTimes(1);
    expect(currentApp(root.render).props.selectedSquadId).toBe(scope.squadId);
    expect(vi.mocked(client.submit).mock.calls[0]?.[1]).toEqual(scope);
    pending.resolve(23 as Awaited<ReturnType<LocalRuntimeClient["submit"]>>);
    await sending;
    currentApp(root.render).props.onSquadChange(otherScope.squadId);
    await vi.waitFor(() =>
      expect(client.listConversations).toHaveBeenLastCalledWith({}, otherScope),
    );
  });

  it("opens a stopped project's definitions while keeping all chat execution unavailable", async () => {
    const stopped = {
      ...project(otherScope),
      enabled: false,
      state: "stopped" as const,
    };
    const { client } = createClient({
      context: {
        instanceId: "daemon-directory",
        mode: "local",
        projects: [project(), stopped],
      },
    });
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    findElement(
      currentApp(root.render).props.children,
      ProjectOverviewView,
    )?.props.onSelect(stopped.projectId);
    await vi.waitFor(() =>
      expect(currentApp(root.render).props).toMatchObject({
        selectedSquadId: otherScope.squadId,
        busy: false,
      }),
    );
    expect(client.loadDefinition).toHaveBeenLastCalledWith(otherScope.squadId);
    expect(client.listConversations).toHaveBeenCalledOnce();
    currentApp(root.render).props.onPageChange("definitions");
    expect(
      findElement(currentApp(root.render).props.children, DefinitionView)
        ?.props,
    ).toMatchObject({
      files: [{ path: "SQUAD.md" }],
      markdown: "# Mission\nOriginal body.",
    });
    currentApp(root.render).props.onPageChange("chat");
    const chat = findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props;
    expect(chat).toMatchObject({
      canSend: false,
      canStop: false,
      canCompact: false,
      canCreateConversation: false,
    });
    await chat?.onSend("Cannot execute stopped project");
    await chat?.onNewConversation?.();
    await chat?.onStop();
    await chat?.onCompact();
    expect(client.submit).not.toHaveBeenCalled();
    expect(client.createConversation).not.toHaveBeenCalled();
    expect(client.cancel).not.toHaveBeenCalled();
    expect(client.compact).not.toHaveBeenCalled();
  });

  it("creates an independently observed conversation for a selected non-root Role", async () => {
    const { client } = createClient();
    const freshId = 18 as ConversationId;
    vi.mocked(client.createConversation).mockResolvedValueOnce({
      conversationId: freshId,
      binding: {
        conversationId: freshId,
        roleId: "reviewer",
        definitionHash: "definition-hash",
        configHash: "config-hash",
        title: "Reviewer",
      },
    });
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    currentApp(root.render).props.onPageChange("chat");
    const chat = () =>
      findElement(currentApp(root.render).props.children, ChatView)?.props;
    const roleSelector = findElement(
      chat()?.roleSelector,
      SelectionField,
    )?.props;
    expect(roleSelector?.items).toEqual([
      { value: "command", label: "Command" },
      { value: "reviewer", label: "Reviewer" },
    ]);
    roleSelector?.onValueChange?.("reviewer");
    await chat()?.onNewConversation?.();
    expect(client.createConversation).toHaveBeenCalledWith(
      { roleId: "reviewer" },
      scope,
    );
    expect(chat()?.title).toBe("会话 18");
    expect(client.observe).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.observe).mock.calls.at(-1)?.[0]).toEqual({
      conversationId: freshId,
    });
    expect(client.submit).not.toHaveBeenCalled();
    expect(client.cancel).not.toHaveBeenCalled();
  });

  it("changes active project availability only through management and refreshes its directory", async () => {
    const { client } = createClient();
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    const overview = () =>
      findElement(currentApp(root.render).props.children, ProjectOverviewView)
        ?.props;
    await overview()?.onToggle(scope.projectId, false);
    expect(client.setProjectEnabled).toHaveBeenCalledWith(
      scope.projectId,
      false,
    );
    expect(client.listProjects).toHaveBeenCalledOnce();
    expect(overview()?.projects[0]).toMatchObject({
      enabled: false,
      state: "stopped",
      scope,
    });
    currentApp(root.render).props.onPageChange("chat");
    expect(
      findElement(currentApp(root.render).props.children, ChatView)?.props
        .canSend,
    ).toBe(false);
    currentApp(root.render).props.onPageChange("overview");
    await overview()?.onToggle(scope.projectId, true);
    expect(client.listProjects).toHaveBeenCalledTimes(2);
    expect(client.listConversations).toHaveBeenLastCalledWith({}, scope);
    currentApp(root.render).props.onPageChange("chat");
    expect(
      findElement(currentApp(root.render).props.children, ChatView)?.props
        .canSend,
    ).toBe(true);
  });

  it("saves source before an explicit bind changes the active Harness and leaves another binding untouched", async () => {
    const { client } = createClient({
      context: {
        instanceId: "daemon-directory",
        mode: "local",
        projects: [project(), project(otherScope)],
      },
    });
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    currentApp(root.render).props.onPageChange("definitions");
    const definitionView = () =>
      findElement(currentApp(root.render).props.children, DefinitionView)
        ?.props;
    definitionView()?.onDraftChange("# Revised source");
    await definitionView()?.onSave();
    expect(client.saveDefinition).toHaveBeenCalledWith(
      scope.squadId,
      expect.objectContaining({ content: "# Revised source" }),
      expect.any(String),
    );
    expect(client.bindDefinition).not.toHaveBeenCalled();
    expect(vi.mocked(client.observe).mock.calls.at(-1)?.[3]).toEqual(scope);
    currentApp(root.render).props.onPageChange("chat");
    findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props.onDraftChange("Old Harness draft");
    currentApp(root.render).props.onPageChange("overview");
    await findElement(
      currentApp(root.render).props.children,
      ProjectOverviewView,
    )?.props.onBind(scope.projectId);
    expect(client.bindDefinition).toHaveBeenCalledWith(scope.projectId);
    expect(client.listProjects).toHaveBeenCalledOnce();
    const rebound = { ...scope, harnessId: "rebound-harness" };
    expect(client.listConversations).toHaveBeenLastCalledWith({}, rebound);
    expect(vi.mocked(client.observe).mock.calls.at(-1)?.[3]).toEqual(rebound);
    const directory = findElement(
      currentApp(root.render).props.children,
      ProjectOverviewView,
    )?.props.projects;
    expect(
      directory?.find((item) => item.projectId === otherScope.projectId),
    ).toEqual(project(otherScope));
    expect(client.cancel).not.toHaveBeenCalled();
    expect(client.dispose).not.toHaveBeenCalled();
    currentApp(root.render).props.onPageChange("chat");
    expect(
      findElement(currentApp(root.render).props.children, ChatView)?.props
        .draft,
    ).toBe("");
    await findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props.onSend("Bound definition request");
    expect(vi.mocked(client.submit).mock.calls.at(-1)?.[1]).toEqual(rebound);
  });

  it("resets the selected conversation when entering another project", async () => {
    const { client } = createClient({
      context: {
        instanceId: "daemon-directory",
        mode: "local",
        projects: [project(), project(otherScope)],
      },
    });
    const first = (await client.listConversations({}, scope))[0];
    if (!first) throw new Error("Missing fixture root");
    vi.mocked(client.listConversations)
      .mockClear()
      .mockImplementation(async (_input, selectedScope) =>
        selectedScope.projectId === scope.projectId
          ? [
              first,
              {
                ...first,
                conversation: {
                  ...first.conversation,
                  id: 18 as ConversationId,
                },
              },
            ]
          : [first],
      );
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    currentApp(root.render).props.onPageChange("chat");
    const chat = () =>
      findElement(currentApp(root.render).props.children, ChatView)?.props;
    findElement(
      chat()?.conversationSelector,
      SelectionField,
    )?.props.onValueChange?.("18");
    expect(chat()?.title).toBe("会话 18");
    currentApp(root.render).props.onSquadChange(otherScope.squadId);
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    expect(chat()?.title).toBe("会话 17");
  });

  it("blocks project switching while a new Role conversation is being created", async () => {
    const { client } = createClient({
      context: {
        instanceId: "daemon-directory",
        mode: "local",
        projects: [project(), project(otherScope)],
      },
    });
    const pending =
      deferred<Awaited<ReturnType<LocalRuntimeClient["createConversation"]>>>();
    vi.mocked(client.createConversation).mockReturnValueOnce(pending.promise);
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    currentApp(root.render).props.onPageChange("chat");
    const initialChat = findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props;
    const running = initialChat?.onNewConversation?.();
    try {
      await initialChat?.onNewConversation?.();
      expect(client.createConversation).toHaveBeenCalledOnce();
      currentApp(root.render).props.onSquadChange(otherScope.squadId);
      expect(currentApp(root.render).props.selectedSquadId).toBe(scope.squadId);
      expect(client.listConversations).toHaveBeenCalledOnce();
    } finally {
      pending.resolve({
        conversationId: 18 as ConversationId,
        binding: {
          conversationId: 18 as ConversationId,
          roleId: "command",
          title: "Command",
          definitionHash: "definition-hash",
          configHash: "config-hash",
        },
      });
      await running;
    }
  });

  it("manages an inactive project without resetting the current project's observations or chat draft", async () => {
    const { client, released } = createClient({
      context: {
        instanceId: "daemon-directory",
        mode: "local",
        projects: [project(), project(otherScope)],
      },
    });
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    currentApp(root.render).props.onPageChange("chat");
    findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props.onDraftChange("Keep current project draft");
    currentApp(root.render).props.onPageChange("overview");
    await findElement(
      currentApp(root.render).props.children,
      ProjectOverviewView,
    )?.props.onToggle(otherScope.projectId, false);
    expect(client.setProjectEnabled).toHaveBeenCalledWith(
      otherScope.projectId,
      false,
    );
    expect(client.listConversations).toHaveBeenCalledOnce();
    expect(released).toEqual([]);
    expect(currentApp(root.render).props.selectedSquadId).toBe(scope.squadId);
    currentApp(root.render).props.onPageChange("chat");
    expect(
      findElement(currentApp(root.render).props.children, ChatView)?.props
        .draft,
    ).toBe("Keep current project draft");
  });

  it("shows a management failure without discarding the selected project or its original binding", async () => {
    const { client } = createClient();
    vi.mocked(client.bindDefinition).mockRejectedValueOnce(
      new Error("Definition is invalid"),
    );
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, { connect: async () => client });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    await findElement(
      currentApp(root.render).props.children,
      ProjectOverviewView,
    )?.props.onBind(scope.projectId);
    expect(currentApp(root.render).props).toMatchObject({
      selectedSquadId: scope.squadId,
      busy: false,
      error: "Definition is invalid",
    });
    expect(
      findElement(currentApp(root.render).props.children, ProjectOverviewView)
        ?.props.projects,
    ).toEqual([project()]);
    expect(client.listProjects).not.toHaveBeenCalled();
    expect(client.listConversations).toHaveBeenCalledOnce();
  });

  it("stops directory polling and ignores an in-flight poll after disposal", async () => {
    vi.useFakeTimers();
    const { client } = createClient();
    const root = makeRoot();
    const dispose = mount({ nodeType: 1 } as HTMLElement, {
      connect: async () => client,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(currentApp(root.render).props.busy).toBe(false);
    expect(client.listProjects).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.listProjects).toHaveBeenCalledOnce();
    const pending = deferred<readonly DaemonProject[]>();
    vi.mocked(client.listProjects).mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.listProjects).toHaveBeenCalledTimes(2);
    dispose();
    const count = root.render.mock.calls.length;
    pending.resolve([project(otherScope)]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.listProjects).toHaveBeenCalledTimes(2);
    expect(root.render).toHaveBeenCalledTimes(count);
    expect(client.dispose).toHaveBeenCalledOnce();
    expect(root.unmount).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    "bootstraps only when a root is present (%s)",
    async (present) => {
      const element = { nodeType: 1 } as HTMLElement;
      const root = makeRoot();
      vi.stubGlobal("document", {
        getElementById: () => (present ? element : null),
      });
      vi.stubGlobal("location", { hash: "", pathname: "/", search: "" });
      vi.stubGlobal("history", { replaceState: vi.fn() });
      vi.resetModules();
      const module = await import("./main.js");
      expect(rootMock.createRoot).toHaveBeenCalledTimes(present ? 1 : 0);
      if (present) {
        module.mountDashboard(element)();
        expect(root.unmount).toHaveBeenCalledOnce();
      }
    },
  );
});

describe("mountDashboard Workflow wiring", () => {
  async function workflowMount() {
    let bundle = {
      ...loadDefinition(workflowFixture),
      squadId: scope.squadId,
      projectId: scope.projectId,
    };
    const { client, released } = createClient({
      context: {
        instanceId: "workflow-directory",
        mode: "local",
        projects: [project(), project(otherScope)],
      },
      loadDefinition: vi.fn(async () => bundle),
      saveDefinition: vi.fn(async (_squadId, draft) => {
        const directory = await mkdtemp(
          join(tmpdir(), "frogie-main-workflow-"),
        );
        try {
          await cp(workflowFixture, directory, { recursive: true });
          for (const file of bundle.files)
            if (file.encoding === "utf8")
              await writeFile(join(directory, file.path), file.content);
          await writeFile(join(directory, draft.path), draft.content);
          bundle = {
            ...loadDefinition(directory),
            squadId: scope.squadId,
            projectId: scope.projectId,
          };
          return bundle;
        } finally {
          await rm(directory, { recursive: true });
        }
      }),
    });
    const root = makeRoot();
    const dispose = mount({ nodeType: 1 } as HTMLElement, {
      connect: async () => client,
    });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    const app = () => currentApp(root.render).props;
    const workflow = () => {
      const view = findElement(app().children, WorkflowView);
      if (!view) throw new Error("Missing public WorkflowView");
      return view.props;
    };
    const source = () => {
      const view = findElement(app().children, DefinitionView);
      if (!view) throw new Error("Missing public DefinitionView");
      return view.props;
    };
    app().onPageChange("workflows");
    return {
      client,
      released,
      dispose,
      app,
      workflow,
      source,
      getBundle: () => bundle,
    };
  }

  it("ignores an unknown Role and releases old graph callbacks on disposal", async () => {
    const { client, app, workflow, dispose } = await workflowMount();
    const callbacks = workflow();
    callbacks.onEditRole("missing-role");
    expect(app().page).toBe("workflows");
    expect(workflow().error).toBeNull();
    dispose();
    callbacks.onEditRole("reviewer");
    callbacks.onMoveNode("inspect", { x: 30, y: 40 });
    callbacks.onAddNode("reviewer");
    await callbacks.onSave();
    expect(client.saveDefinition).not.toHaveBeenCalled();
    expect(client.dispose).toHaveBeenCalledOnce();
  });

  it("routes public graph callbacks through the real Workflow VM and saves the original file base without rebinding conversations", async () => {
    const { client, released, app, workflow, source, getBundle } =
      await workflowMount();
    expect(workflow()).toMatchObject({
      workflow: getBundle().workflows[0],
      workflows: getBundle().workflows,
      roles: getBundle().roles,
      selectedNodeId: null,
      dirty: false,
    });
    const original = getBundle().files.find(
      (file) => file.path === "workflows/review.md",
    );
    workflow().onSelectWorkflow("review");
    workflow().onSelectNode("inspect");
    expect(workflow().selectedNodeId).toBe("inspect");
    workflow().onMoveNode("inspect", { x: 220, y: 80 });
    workflow().onConnect("report", "inspect");
    workflow().onAddNode("reviewer");
    const added = workflow().workflow?.nodes.find(
      (node) => !["inspect", "report"].includes(node.id),
    );
    if (!added) throw new Error("Missing public add callback result");
    workflow().onRemoveNode(added.id);
    expect(workflow().workflow?.nodes).toHaveLength(2);
    expect(workflow().workflow?.edges).toContainEqual({
      source: "report",
      target: "inspect",
    });
    const graph = structuredClone(workflow().workflow);
    vi.mocked(client.saveDefinition).mockRejectedValueOnce(
      new Error("Workflow save interrupted"),
    );
    await Promise.resolve(workflow().onSave()).catch(() => undefined);
    await vi.waitFor(() =>
      expect(workflow()).toMatchObject({
        busy: false,
        dirty: true,
        error: "Workflow save interrupted",
      }),
    );
    expect(workflow().workflow).toEqual(graph);
    await workflow().onSave();
    await vi.waitFor(() => expect(workflow().dirty).toBe(false));
    const calls = vi.mocked(client.saveDefinition).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([
      scope.squadId,
      {
        path: "workflows/review.md",
        content: expect.any(String),
        baseContent: original?.content,
      },
      expect.any(String),
    ]);
    expect(calls[1]?.[2]).toBe(calls[0]?.[2]);
    expect(
      getBundle().workflows[0]?.nodes.find((node) => node.id === "inspect")
        ?.position,
    ).toEqual({ x: 220, y: 80 });
    app().onPageChange("definitions");
    source().onFileSelect("workflows/review.md");
    expect(source().draft).toBe(calls[1]?.[1].content);
    expect(source().dirty).toBe(false);
    expect(client.bindDefinition).not.toHaveBeenCalled();
    expect(client.listConversations).toHaveBeenCalledOnce();
    expect(client.observe).toHaveBeenCalledOnce();
    expect(released).toEqual([]);
  });

  it("keeps graph drafts while opening the exact nested Role source and blocks both cross-project selection routes", async () => {
    const { client, app, workflow, source } = await workflowMount();
    workflow().onMoveNode("inspect", { x: 200, y: 80 });
    workflow().onEditRole("reviewer");
    expect(app().page).toBe("definitions");
    expect(source()).toMatchObject({
      selectedPath: "roles/command/reviewer/ROLE.md",
    });
    expect(source().draft).toContain("id: reviewer");
    app().onPageChange("workflows");
    expect(workflow()).toMatchObject({ dirty: true });
    expect(
      workflow().workflow?.nodes.find((node) => node.id === "inspect")
        ?.position,
    ).toEqual({ x: 200, y: 80 });
    app().onSquadChange(otherScope.squadId);
    await Promise.resolve();
    expect(app().selectedSquadId).toBe(scope.squadId);
    app().onPageChange("overview");
    findElement(app().children, ProjectOverviewView)?.props.onSelect(
      otherScope.projectId,
    );
    await Promise.resolve();
    expect(app().selectedSquadId).toBe(scope.squadId);
    expect(client.loadDefinition).toHaveBeenCalledOnce();
    expect(client.listConversations).toHaveBeenCalledOnce();
    expect(client.bindDefinition).not.toHaveBeenCalled();
  });

  it("blocks unsaved source-to-graph navigation, then adopts saved label changes without clearing same-hash selection on message renders", async () => {
    const { client, app, workflow, source } = await workflowMount();
    app().onPageChange("definitions");
    source().onFileSelect("workflows/review.md");
    source().onDraftChange(
      source().draft.replace("Return evidence", "Reviewed evidence"),
    );
    app().onPageChange("workflows");
    expect(app().page).toBe("definitions");
    expect(source().dirty).toBe(true);
    await source().onSave();
    app().onPageChange("workflows");
    expect(workflow().workflow?.edges).toContainEqual({
      source: "inspect",
      target: "report",
      label: "Reviewed evidence",
    });
    workflow().onSelectNode("inspect");
    const graph = workflow().workflow;
    vi.mocked(client.observe).mock.calls[0]?.[1]({
      type: "update",
      scope,
      conversationId,
      value: {
        conversation: { id: conversationId } as ConversationRecord,
        entries: [],
        docs: {},
      },
    });
    expect(workflow().selectedNodeId).toBe("inspect");
    expect(workflow().workflow).toBe(graph);
    expect(client.listConversations).toHaveBeenCalledOnce();
    expect(client.bindDefinition).not.toHaveBeenCalled();
  });
});
