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
import { createExecutionViewModel } from "./viewmodels/ExecutionViewModel.js";
import { createProjectViewModel } from "./viewmodels/ProjectViewModel.js";
import { projectChat } from "./viewmodels/projectChat.js";
import { createWorkflowViewModel } from "./viewmodels/WorkflowViewModel.js";
import { AppView, type Page } from "./views/AppView.js";
import { ChatView } from "./views/ChatView.js";
import { DefinitionView } from "./views/DefinitionView.js";
import { ExecutionView } from "./views/ExecutionView.js";
import { ProjectOverviewView } from "./views/ProjectOverviewView.js";
import { WorkflowView } from "./views/WorkflowView.js";

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
  let workflows: ReturnType<typeof createWorkflowViewModel> | undefined;
  let execution: ReturnType<typeof createExecutionViewModel> | undefined;
  let executionKey: string | undefined;
  let executionPoll: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeExecution: (() => void) | undefined;
  let unsubscribeWorkflows: (() => void) | undefined;
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
      syncExecution();
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
    if (workflows?.getSnapshot().dirty || vm.store.getSnapshot().drafts.size) {
      error = "请先保存当前定义草稿，再切换项目。";
      return;
    }
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

  function releaseExecution() {
    clearTimeout(executionPoll);
    unsubscribeExecution?.();
    execution?.dispose();
    execution = undefined;
    executionKey = undefined;
  }

  async function pollExecution(
    current: ReturnType<typeof createExecutionViewModel>,
  ) {
    await current.refresh();
    if (!disposed && execution === current)
      executionPoll = setTimeout(() => void pollExecution(current), 1000);
  }

  function syncExecution() {
    const snapshot = vm?.store.getSnapshot();
    const scope = snapshot?.scope;
    const project = projects
      ?.getSnapshot()
      .projects.find((item) => item.projectId === scope?.projectId);
    if (
      disposed ||
      page !== "chat" ||
      !client ||
      !scope ||
      !snapshot?.definition ||
      project?.state !== "running"
    ) {
      releaseExecution();
      return;
    }
    const conversationId =
      selectedConversationId ?? snapshot.conversations.keys().next().value;
    const key = JSON.stringify([
      scope.projectId,
      scope.environmentId,
      scope.squadId,
      scope.harnessId,
      conversationId,
    ]);
    if (executionKey === key) return;
    releaseExecution();
    const current = createExecutionViewModel(client);
    execution = current;
    executionKey = key;
    unsubscribeExecution = current.subscribe(render);
    void current.setTarget(scope, conversationId).then(() => {
      if (!disposed && execution === current)
        executionPoll = setTimeout(() => void pollExecution(current), 1000);
    });
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
    const workflow = workflows?.getSnapshot();
    const executionModel = execution;
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
    } else if (page === "workflows") {
      content = (
        <WorkflowView
          workflow={definition ? workflow?.workflow : undefined}
          workflows={definition ? (workflow?.workflows ?? []) : []}
          roles={definition?.roles ?? []}
          selectedNodeId={workflow?.selectedNodeId ?? null}
          busy={
            connecting || snapshot?.busy === true || workflow?.busy === true
          }
          dirty={workflow?.dirty === true}
          error={viewError ?? workflow?.error ?? null}
          onSelectWorkflow={(id) => workflows?.selectWorkflow(id)}
          onSelectNode={(id) => workflows?.selectNode(id)}
          onMoveNode={(id, position) => workflows?.moveNode(id, position)}
          onConnect={(source, target) => workflows?.connect(source, target)}
          onAddNode={(roleId) => workflows?.addNode(roleId)}
          onRemoveNode={(id) => workflows?.removeNode(id)}
          onSave={() =>
            act(async () => {
              await workflows?.save();
            })
          }
          onEditRole={(roleId) => {
            if (disposed) return;
            const path = files.find(
              (item) =>
                item.path.startsWith("roles/") &&
                item.path.endsWith(`/${roleId}/ROLE.md`),
            )?.path;
            if (path) {
              selectedPath = path;
              page = "definitions";
              render();
            }
          }}
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
                  syncExecution();
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
          details={
            executionModel && (
              <ExecutionView
                snapshot={executionModel.getSnapshot()}
                onRefresh={executionModel.refresh}
                onSelectTask={executionModel.selectTask}
                onLoadMoreTasks={executionModel.loadMoreTasks}
                onLoadMoreEntries={executionModel.loadMoreEntries}
              />
            )
          }
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
          projectSnapshot?.busy === true ||
          workflow?.busy === true
        }
        error={page === "chat" || page === "definitions" ? null : viewError}
        canCreateSquad={false}
        canChangeMode={false}
        onPageChange={(next) => {
          if (!disposed) {
            if (next === "workflows" && snapshot?.drafts.size) {
              error = "请先保存定义源码，再进入工作流画布。";
              render();
              return;
            }
            page = next;
            syncExecution();
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
    unsubscribeWorkflows?.();
    clearTimeout(projectPoll);
    releaseExecution();
    projects?.dispose();
    workflows?.dispose();
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
      unsubscribeProjects = projects.subscribe(() => {
        syncExecution();
        render();
      });
      const api = createLocalDashboardApi(client, (failure) => {
        if (!disposed) {
          error = failure.message;
          render();
        }
      });
      vm = createDashboardViewModel(api, client.caller);
      workflows = createWorkflowViewModel({
        async saveFile(scope, draft, requestId) {
          const definition = await api.saveFile(scope, draft, requestId);
          vm?.adoptDefinition(scope, definition);
          return definition;
        },
      });
      unsubscribeWorkflows = workflows.subscribe(render);
      unsubscribe = vm.store.subscribe(() => {
        const snapshot = vm?.store.getSnapshot();
        if (snapshot?.scope && snapshot.definition)
          workflows?.setDefinition(snapshot.scope, snapshot.definition);
        syncExecution();
        render();
      });
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
