import "./styles.css";
import type { SubmitInput } from "@frogie/core/protocol";
import { Field, LayerCard, Text } from "@nocoo/basalt";
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
import { projectChat } from "./viewmodels/projectChat.js";
import { AppView, type Page } from "./views/AppView.js";
import { ChatView } from "./views/ChatView.js";
import { DefinitionView } from "./views/DefinitionView.js";

const mounted = new WeakMap<HTMLElement, () => void>();

export interface MountDashboardOptions {
  readonly connect?: () => Promise<LocalRuntimeClient>;
  readonly mode?: "local" | "e2e" | "prod";
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
  let unsubscribe: (() => void) | undefined;
  let selectedPath: string | null = null;
  let selectedConversationId: SubmitInput["conversationId"] | undefined;
  const chatDrafts = new Map<SubmitInput["conversationId"] | "new", string>();
  let newConversationId: SubmitInput["conversationId"] | undefined;
  let sending = false;
  let stopping = false;
  let compacting = false;
  let saving = false;

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

  function render() {
    if (disposed) return;
    const snapshot = vm?.store.getSnapshot();
    const definition = snapshot?.definition;
    const viewError = error ?? snapshot?.error?.message ?? null;
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
        <>
          <Field label="会话">
            <Combobox
              aria-label="选择会话"
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
          </Field>
          <ChatView
            title={
              conversationId === undefined ? "新对话" : `会话 ${conversationId}`
            }
            entries={chat.entries}
            draft={chatDrafts.get(draftKey) ?? ""}
            loading={connecting}
            sending={sending}
            running={chat.running}
            compacting={compacting || chat.compacting}
            canSend={vm !== undefined && definition !== undefined && !sending}
            canStop={conversationId !== undefined && !stopping}
            canCompact={
              conversationId !== undefined && !compacting && !chat.compacting
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
                if (!vm || !definition || sending) return;
                sending = true;
                chatDrafts.set(draftKey, text);
                render();
                try {
                  const id =
                    conversationId ??
                    (await vm.createConversation({
                      roleId: definition.rootRoleId,
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
        </>
      );
    } else {
      content =
        definition && page === "overview" ? (
          <LayerCard>
            <LayerCard.Header>{definition.title}</LayerCard.Header>
            <LayerCard.Body>
              <Text>{definition.content}</Text>
            </LayerCard.Body>
          </LayerCard>
        ) : (
          <LayerCard.Empty
            title={
              connecting
                ? "连接中"
                : page === "workflows" || page === "evals"
                  ? "功能尚未接入"
                  : "尚未连接工作区"
            }
            description={
              connecting
                ? "正在连接本地服务并加载定义与会话。"
                : "当前仅接入定义编辑与真实对话；未加载假数据。"
            }
          />
        );
    }
    root.render(
      <AppView
        version={version}
        logoSrc={logoSrc}
        page={page}
        mode={options?.mode ?? "local"}
        squads={snapshot?.squads.map(({ id, title }) => ({ id, title })) ?? []}
        selectedSquadId={snapshot?.scope?.squadId ?? null}
        busy={connecting || snapshot?.busy === true}
        error={viewError}
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
          if (!disposed && client && id !== client.context.scope.squadId) {
            error = "当前连接固定到此 Squad，切换需要重新连接本地服务。";
            render();
          }
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
      const api = createLocalDashboardApi(client, (failure) => {
        if (!disposed) {
          error = failure.message;
          render();
        }
      });
      vm = createDashboardViewModel(api, client.caller);
      unsubscribe = vm.store.subscribe(render);
      await Promise.all([
        vm.refreshSquads(),
        vm.setScope(client.context.scope),
      ]);
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
