import "./styles.css";
import type { DaemonProject, SubmitInput } from "@frogie/core/protocol";
import { LayerCard } from "@nocoo/basalt";
import { Combobox } from "@nocoo/basalt/components/combobox";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { version } from "../../../package.json";
import logoSrc from "../../../packages/web/public/logo-24.png";
import { createLocalDashboardApi } from "./models/dashboardApi.js";
import {
  connectLocalRuntime,
  type LocalRuntimeClient,
} from "./models/localClient.js";
import {
  createDashboardViewModel,
  type DashboardViewModel,
} from "./viewmodels/DashboardViewModel.js";
import { createProjectViewModel } from "./viewmodels/ProjectViewModel.js";
import { projectChat } from "./viewmodels/projectChat.js";
import { AppView, type Page } from "./views/AppView.js";
import { ChatView } from "./views/ChatView.js";
import { DefinitionView } from "./views/DefinitionView.js";
import { ProjectOverviewView } from "./views/ProjectOverviewView.js";

const mounted = new WeakMap<HTMLElement, () => void>();

export interface MountDashboardOptions {
  readonly connect?: () => Promise<LocalRuntimeClient>;
  readonly mode?: "local" | "e2e";
}

export function mountDashboard(
  element: HTMLElement,
  options?: MountDashboardOptions,
): () => void {
  if (element?.nodeType !== 1)
    throw new Error("A dashboard root element is required");
  const existing = mounted.get(element);
  if (existing) return existing;
  const root = createRoot(element);
  let page: Page = "overview";
  let disposed = false;
  let connecting = true;
  let error: string | null = null;
  let client: LocalRuntimeClient | undefined;
  let vm: DashboardViewModel | undefined;
  let projects: ReturnType<typeof createProjectViewModel> | undefined;
  let unsubscribeProjects: (() => void) | undefined;
  let projectPoll: ReturnType<typeof setTimeout> | undefined;
  let selectedRoleId: string | undefined;
  const scopedDrafts = new Map<
    string,
    Map<SubmitInput["conversationId"] | "new", string>
  >();
  let unsubscribe: (() => void) | undefined;
  let selectedPath: string | null = null;
  let selectedConversationId: SubmitInput["conversationId"] | undefined;
  let chatDrafts = new Map<SubmitInput["conversationId"] | "new", string>();
  let newConversationId: SubmitInput["conversationId"] | undefined;
  let sending = false;
  let stopping = false;
  let compacting = false;
  let saving = false;
  let creatingConversation = false;

  async function act(
    action: () => Promise<void>,
    rethrow = false,
  ): Promise<void> {
    if (disposed) return;
    error = null;
    try {
      await action();
    } catch (failure) {
      if (!disposed)
        error = failure instanceof Error ? failure.message : "操作失败";
      if (rethrow) throw failure;
    } finally {
      render();
    }
  }

  async function selectProject(project: DaemonProject) {
    if (
      !vm ||
      disposed ||
      sending ||
      saving ||
      compacting ||
      stopping ||
      creatingConversation
    )
      return;
    const previous = vm.store.getSnapshot().scope;
    if (previous) scopedDrafts.set(JSON.stringify(previous), chatDrafts);
    chatDrafts = scopedDrafts.get(JSON.stringify(project.scope)) ?? new Map();
    selectedConversationId = undefined;
    newConversationId = undefined;
    selectedRoleId = undefined;
    selectedPath = null;
    await vm.setScope(project.scope, project.state === "running");
  }

  async function refreshProjects() {
    await projects?.refresh();
    if (!disposed) projectPoll = setTimeout(() => void refreshProjects(), 3000);
  }

  function render() {
    if (disposed) return;
    const snapshot = vm?.store.getSnapshot();
    const definition = snapshot?.definition;
    const projectSnapshot = projects?.getSnapshot();
    const allProjects = projectSnapshot?.projects ?? [];
    const activeProject = allProjects.find(
      (project) => project.projectId === snapshot?.scope?.projectId,
    );
    const runtimeEnabled = activeProject?.state === "running";
    selectedRoleId ??= definition?.rootRoleId;
    const viewError =
      error ?? snapshot?.error?.message ?? projectSnapshot?.error ?? null;
    const files =
      definition?.files.filter(
        (file) => file.encoding === "utf8" && file.path.endsWith(".md"),
      ) ?? [];
    if (!files.some(({ path }) => path === selectedPath))
      selectedPath = files[0]?.path ?? null;
    const file = files.find(({ path }) => path === selectedPath);
    const draft = file ? snapshot?.drafts.get(file.path) : undefined;
    const conversations = snapshot?.conversations;
    if (selectedConversationId === undefined)
      selectedConversationId = conversations?.keys().next().value;
    const conversationId = selectedConversationId;
    const draftKey = conversationId ?? "new";
    const conversation =
      conversationId === undefined
        ? undefined
        : conversations?.get(conversationId);
    const chat = conversation
      ? projectChat(conversation)
      : { entries: [], running: false, compacting: false };
    let content: ReactNode;
    if (page === "definitions") {
      content = (
        <DefinitionView
          title="定义文件"
          files={files.map(({ path }) => ({ path, title: path }))}
          selectedPath={selectedPath}
          markdown={draft?.content ?? file?.content ?? ""}
          draft={draft?.content ?? file?.content ?? ""}
          dirty={draft !== undefined}
          loading={connecting}
          saving={saving}
          creating={false}
          canSave={draft !== undefined && !snapshot?.busy}
          canCreate={false}
          error={viewError}
          onFileSelect={(path) => {
            if (!disposed) {
              selectedPath = path;
              render();
            }
          }}
          onDraftChange={(value) => {
            if (!disposed && file) vm?.editFile(file.path, value);
          }}
          onSave={() =>
            act(async () => {
              if (!vm || !file) return;
              saving = true;
              render();
              try {
                await vm.saveFile(file.path);
              } finally {
                saving = false;
              }
            })
          }
          onCreate={() => undefined}
        />
      );
    } else if (page === "chat") {
      content = (
        <ChatView
          title={
            conversationId === undefined ? "新对话" : `会话 ${conversationId}`
          }
          conversationSelector={
            <Combobox
              aria-label="选择会话"
              className="frogie-conversation-selector"
              items={[...(conversations?.keys() ?? [])].map((id) => ({
                value: String(id),
                label: `会话 ${id}`,
              }))}
              value={conversationId === undefined ? "" : String(conversationId)}
              disabled={
                connecting ||
                sending ||
                stopping ||
                compacting ||
                !conversations?.size
              }
              placeholder="发送消息创建会话"
              onValueChange={(value) => {
                if (disposed) return;
                const id = [...(conversations?.keys() ?? [])].find(
                  (id) => String(id) === value,
                );
                if (id !== undefined) {
                  selectedConversationId = id;
                  render();
                }
              }}
            />
          }
          roleSelector={
            <Combobox
              aria-label="选择角色"
              items={
                definition?.roles.map((role) => ({
                  value: role.id,
                  label: role.title,
                })) ?? []
              }
              value={selectedRoleId ?? ""}
              disabled={connecting || sending || !runtimeEnabled}
              onValueChange={(id) => {
                if (!disposed) {
                  selectedRoleId = id;
                  render();
                }
              }}
            />
          }
          canCreateConversation={runtimeEnabled && !sending && !snapshot?.busy}
          onNewConversation={() =>
            act(async () => {
              if (
                !vm ||
                !selectedRoleId ||
                !runtimeEnabled ||
                sending ||
                snapshot?.busy
              )
                return;
              if (creatingConversation) return;
              creatingConversation = true;
              try {
                selectedConversationId = await vm.createConversation({
                  roleId: selectedRoleId,
                });
              } finally {
                creatingConversation = false;
              }
            })
          }
          entries={chat.entries}
          draft={chatDrafts.get(draftKey) ?? ""}
          loading={connecting}
          sending={sending}
          running={chat.running}
          compacting={compacting || chat.compacting}
          canSend={
            vm !== undefined &&
            definition !== undefined &&
            runtimeEnabled &&
            !sending
          }
          canStop={runtimeEnabled && conversationId !== undefined && !stopping}
          canCompact={
            runtimeEnabled &&
            conversationId !== undefined &&
            !compacting &&
            !chat.compacting
          }
          error={viewError}
          onDraftChange={(value) => {
            if (!disposed) {
              chatDrafts.set(
                draftKey === "new" ? (newConversationId ?? "new") : draftKey,
                value,
              );
              render();
            }
          }}
          onSend={(text) =>
            act(async () => {
              if (!vm || !definition || !runtimeEnabled || sending) return;
              sending = true;
              chatDrafts.set(draftKey, text);
              render();
              try {
                const id =
                  conversationId ??
                  (await vm.createConversation({
                    roleId: selectedRoleId ?? definition.rootRoleId,
                  }));
                if (draftKey === "new") {
                  newConversationId = id;
                  chatDrafts.set(id, chatDrafts.get("new") ?? text);
                  chatDrafts.delete("new");
                }
                selectedConversationId = id;
                render();
                await vm.submit(id, text);
                if (chatDrafts.get(id) === text) chatDrafts.delete(id);
              } finally {
                sending = false;
              }
            }, true)
          }
          onStop={() =>
            act(async () => {
              if (!vm || conversationId === undefined || stopping) return;
              stopping = true;
              render();
              try {
                await vm.cancel(conversationId);
              } finally {
                stopping = false;
              }
            })
          }
          onCompact={() =>
            act(async () => {
              if (!vm || conversationId === undefined || compacting) return;
              compacting = true;
              render();
              try {
                await vm.compact(conversationId);
              } finally {
                compacting = false;
              }
            })
          }
        />
      );
    } else {
      content =
        page === "overview" && projects ? (
          <ProjectOverviewView
            projects={allProjects}
            selectedProjectId={activeProject?.projectId ?? null}
            busy={projectSnapshot?.busy === true || connecting || sending}
            onSelect={(id) => {
              const project = allProjects.find((item) => item.projectId === id);
              if (project) void act(() => selectProject(project));
            }}
            onToggle={(id, enabled) =>
              act(async () => {
                if (!projects) return;
                await projects.setEnabled(id, enabled);
                const changed = projects
                  .getSnapshot()
                  .projects.find((item) => item.projectId === id);
                if (changed && id === activeProject?.projectId)
                  await selectProject(changed);
              })
            }
            onBind={(id) =>
              act(async () => {
                if (!projects) return;
                await projects.bind(id);
                const changed = projects
                  .getSnapshot()
                  .projects.find((item) => item.projectId === id);
                if (changed && id === activeProject?.projectId)
                  await selectProject(changed);
              })
            }
          />
        ) : (
          <LayerCard.Empty
            title={connecting ? "连接中" : "功能尚未接入"}
            description={
              connecting
                ? "正在连接本地 daemon。"
                : "此入口按实际能力逐步接入。"
            }
          />
        );
    }
    root.render(
      <AppView
        version={version}
        logoSrc={logoSrc}
        page={page}
        mode={options?.mode ?? client?.context.mode ?? "local"}
        squads={allProjects.map((project) => ({
          id: project.scope.squadId,
          title: project.title,
        }))}
        selectedSquadId={snapshot?.scope?.squadId ?? null}
        busy={
          connecting ||
          sending ||
          saving ||
          snapshot?.busy === true ||
          projectSnapshot?.busy === true
        }
        error={page === "chat" || page === "definitions" ? null : viewError}
        canCreateSquad={false}
        canChangeMode={false}
        onPageChange={(next) => {
          if (!disposed) {
            page = next;
            render();
          }
        }}
        onModeChange={() => undefined}
        onSquadChange={(id) => {
          if (disposed || id === snapshot?.scope?.squadId) return;
          const project = allProjects.find((item) => item.scope.squadId === id);
          if (!project) {
            error = "项目未登记";
            render();
            return;
          }
          void act(() => selectProject(project));
        }}
        onCreateSquad={() => undefined}
      >
        {content}
      </AppView>,
    );
  }
  render();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    unsubscribeProjects?.();
    clearTimeout(projectPoll);
    projects?.dispose();
    vm?.dispose();
    client?.dispose();
    root.unmount();
    mounted.delete(element);
  };
  mounted.set(element, dispose);
  void act(async () => {
    try {
      const connect =
        options?.connect ??
        (() => {
          const token = new URLSearchParams(location.hash.slice(1)).get(
            "token",
          );
          history.replaceState(
            null,
            "",
            `${location.pathname}${location.search}`,
          );
          return connectLocalRuntime({
            origin: location.origin,
            ...(token === null ? {} : { token }),
          });
        });
      const connected = await connect();
      if (disposed) {
        connected.dispose();
        return;
      }
      client = connected;
      projects = createProjectViewModel(client);
      unsubscribeProjects = projects.subscribe(render);
      const api = createLocalDashboardApi(client, (failure) => {
        if (!disposed) {
          error = failure.message;
          render();
        }
      });
      vm = createDashboardViewModel(api, client.caller);
      unsubscribe = vm.store.subscribe(render);
      const initial =
        client.context.projects.find(
          (project) => project.state === "running",
        ) ?? client.context.projects[0];
      await Promise.all([
        vm.refreshSquads(),
        initial ? selectProject(initial) : Promise.resolve(),
      ]);
      if (!disposed)
        projectPoll = setTimeout(() => void refreshProjects(), 3000);
    } finally {
      connecting = false;
    }
  });
  return dispose;
}

if (typeof document !== "undefined") {
  const element = document.getElementById("root");
  if (element) mountDashboard(element);
}
