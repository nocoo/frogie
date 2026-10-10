import type { DefinitionBundle } from "@frogie/core/definitions";
import type { RuntimeDescription, RuntimeScope } from "@frogie/core/protocol";
import { Combobox } from "@nocoo/basalt/components/combobox";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRuntimeClient } from "./models/localClient.js";
import { AppView, type AppViewProps } from "./views/AppView.js";
import { ChatView } from "./views/ChatView.js";
import { DefinitionView } from "./views/DefinitionView.js";

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

function definition(): DefinitionBundle {
  return {
    schemaVersion: 1,
    squadId: "zeppelin",
    projectId: "frogie",
    title: "Zeppelin",
    rootRoleId: "command",
    content: "Fleet mission.",
    roles: [],
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
  const client: LocalRuntimeClient = {
    context: { instanceId: "instance-1", scope, description },
    caller: { id: "local-user" },
    listSquads: vi.fn(async () => [
      { id: "zeppelin", projectId: "frogie", title: "Zeppelin" },
    ]),
    loadDefinition: vi.fn(async () => definition()),
    saveDefinition: vi.fn(async (_squadId, draft) => ({
      ...definition(),
      files: definition().files.map((file) =>
        file.path === draft.path ? { ...file, content: draft.content } : file,
      ),
    })),
    describe: vi.fn(async () => description),
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
    observe: vi.fn((input, listener) => {
      observers.set(input.conversationId, listener as (frame: never) => void);
      listener({
        type: "snapshot",
        scope,
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
  };
  return findElement([props.children, props.conversationSelector], component);
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
    expect(client.listConversations).toHaveBeenCalledWith({});
    expect(client.listSquads).toHaveBeenCalledOnce();
  });

  it("shows E2E from the connected runtime scope without a mount override", async () => {
    const e2eScope = { ...scope, environmentId: "e2e" };
    const e2eDescription = { ...description, scope: e2eScope };
    const { client } = createClient({
      context: {
        instanceId: "e2e-instance",
        scope: e2eScope,
        description: e2eDescription,
      },
      describe: vi.fn(async () => e2eDescription),
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

  it("resumes the existing session when the startup fragment is absent", async () => {
    vi.stubGlobal("document", { getElementById: () => elements[0] });
    vi.stubGlobal("location", { hash: "", origin, pathname: "/", search: "" });
    vi.stubGlobal("history", { replaceState: vi.fn() });
    const root = makeRoot();
    const element = { nodeType: 1 } as HTMLElement;
    elements.push(element);
    rootMock.connect.mockResolvedValue(createClient().client);

    mount(element);
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.busy).toBe(false),
    );
    expect(rootMock.connect).toHaveBeenCalledWith({ origin });
    expect(currentApp(root.render).props.error).toBeNull();
  });

  it("clears the default token fragment before connecting", async () => {
    makeRoot();
    const connected = createClient().client;
    rootMock.connect.mockResolvedValue(connected);
    const replaceState = vi.fn();
    const element = { nodeType: 1 } as HTMLElement;
    elements.push(element);
    vi.stubGlobal("document", { getElementById: () => element });
    vi.stubGlobal("location", {
      hash: "#token=one-time-secret",
      origin,
      pathname: "/",
      search: "?keep=1",
    });
    vi.stubGlobal("history", { replaceState });
    mount(element);
    await vi.waitFor(() => expect(rootMock.connect).toHaveBeenCalledOnce());
    expect(rootMock.connect).toHaveBeenCalledWith(
      expect.objectContaining({ token: "one-time-secret" }),
    );
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?keep=1");
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
    expect(client.submit).toHaveBeenCalledWith({
      conversationId,
      submission: expect.objectContaining({
        type: "input",
        content: "User request",
      }),
    });
    await chat?.props.onStop();
    expect(client.cancel).toHaveBeenCalledWith({ conversationId });
    await chat?.props.onCompact();
    expect(client.compact).toHaveBeenCalledWith({ conversationId });
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
    const records = await client.listConversations({});
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
      findElement(currentApp(root.render).props.children, Combobox)?.props;
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
    const selector = findElement(app.children, Combobox)?.props;
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

  it("exposes connection failures and keeps unfinished pages honest", async () => {
    const root = makeRoot();
    mount({ nodeType: 1 } as HTMLElement, {
      connect: async () => {
        throw "offline";
      },
    });
    await vi.waitFor(() =>
      expect(currentApp(root.render).props.error).toBeTruthy(),
    );
    currentApp(root.render).props.onPageChange("workflows");
    expect(JSON.stringify(currentApp(root.render).props.children)).toContain(
      "功能尚未接入",
    );
    currentApp(root.render).props.onPageChange("evals");
    expect(JSON.stringify(currentApp(root.render).props.children)).toContain(
      "功能尚未接入",
    );
    currentApp(root.render).props.onPageChange("chat");
    const chat = findElement(
      currentApp(root.render).props.children,
      ChatView,
    )?.props;
    expect(chat?.canSend).toBe(false);
    findElement(
      currentApp(root.render).props.children,
      Combobox,
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
    expect(client.createConversation).toHaveBeenCalledWith({
      roleId: "command",
    });
    expect(client.submit).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId }),
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
