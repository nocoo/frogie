import { Button, Field, LayerCard, Text } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { ChatBubble } from "@nocoo/basalt/components/chat-bubble";
import { ChatComposer } from "@nocoo/basalt/components/chat-composer";
import { ChatMarkdown } from "@nocoo/basalt/components/chat-markdown";
import { Loader } from "@nocoo/basalt/components/loader";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { type ReactNode, useState } from "react";

export interface ChatViewEntry {
  id: string;
  variant: "user" | "assistant" | "system";
  content: string;
  author?: string;
  streaming?: boolean;
}

export interface ChatViewProps {
  title: string;
  conversationSelector?: ReactNode;
  roleSelector?: ReactNode;
  onNewConversation?(): void | Promise<void>;
  canCreateConversation?: boolean;
  details?: ReactNode;
  entries: readonly ChatViewEntry[];
  draft: string;
  loading: boolean;
  sending: boolean;
  running: boolean;
  compacting: boolean;
  canSend: boolean;
  canStop: boolean;
  canCompact: boolean;
  error: string | null;
  onDraftChange(value: string): void;
  onSend(text: string): void | Promise<void>;
  onStop(): void | Promise<void>;
  onCompact(): void | Promise<void>;
}

export function ChatView(props: ChatViewProps) {
  const [detailsOpen, setDetailsOpen] = useState(
    () =>
      typeof matchMedia === "undefined" ||
      matchMedia("(min-width: 1200px)").matches,
  );
  const chat = (
    <LayerCard aria-label="对话消息" className="frogie-chat">
      <LayerCard.Body
        className="frogie-chat-messages"
        role="log"
        aria-label="消息记录"
        aria-live="polite"
      >
        {props.error !== null && (
          <Banner
            role="alert"
            variant="error"
            title="对话操作失败"
            description={props.error}
          />
        )}
        {(props.loading ||
          props.sending ||
          props.running ||
          props.compacting) && (
          <Text role="status" aria-live="polite" size="sm" tone="muted">
            {props.loading && <Loader label="加载中" />}
            {props.sending && "发送中 "}
            {props.running && "运行中 "}
            {props.compacting && "压缩中"}
          </Text>
        )}
        {props.entries.length === 0 && !props.loading && (
          <LayerCard.Empty
            className="frogie-chat-empty"
            title="暂无消息"
            description="发送消息开始对话。"
          />
        )}
        {props.entries.map((entry) => (
          <ChatBubble
            key={entry.id}
            variant={entry.variant}
            streaming={entry.streaming ?? false}
            {...(entry.variant === "user"
              ? { className: "frogie-chat-user" }
              : {})}
          >
            {entry.author !== undefined && (
              <Text as="span" size="sm" tone="muted">
                {entry.author}
              </Text>
            )}
            {entry.variant === "user" ? (
              <Text className="frogie-message-text">{entry.content}</Text>
            ) : (
              <ChatMarkdown
                content={entry.content}
                streaming={entry.streaming ?? false}
              />
            )}
          </ChatBubble>
        ))}
      </LayerCard.Body>
      <LayerCard.Footer className="frogie-chat-footer">
        <ChatComposer
          value={props.draft}
          onValueChange={props.onDraftChange}
          onSend={props.onSend}
          onCancel={props.onStop}
          streaming={props.running}
          disabled={
            props.running
              ? !props.canStop
              : props.loading ||
                props.compacting ||
                props.sending ||
                !props.canSend
          }
          label="消息"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          sendLabel="发送消息"
          cancelLabel="停止当前工作"
          className="frogie-chat-composer"
        />
      </LayerCard.Footer>
    </LayerCard>
  );
  return (
    <>
      <PageHeader
        title={props.title}
        actions={
          <div className="frogie-chat-actions">
            {props.details != null && (
              <Button
                variant="outline"
                aria-expanded={detailsOpen}
                aria-controls="execution-details"
                onClick={() => setDetailsOpen(!detailsOpen)}
              >
                执行详情
              </Button>
            )}
            <Button
              variant="outline"
              aria-label="压缩上下文"
              disabled={
                !props.canCompact ||
                props.loading ||
                props.sending ||
                props.compacting
              }
              onClick={props.onCompact}
            >
              压缩上下文
            </Button>
            {props.onNewConversation !== undefined && (
              <Button
                aria-label="新建角色会话"
                disabled={
                  props.canCreateConversation !== true ||
                  props.loading ||
                  props.sending ||
                  props.compacting
                }
                onClick={props.onNewConversation}
              >
                新建角色会话
              </Button>
            )}
          </div>
        }
        filters={
          (props.conversationSelector != null ||
            props.roleSelector != null) && (
            <div className="frogie-chat-filters">
              {props.conversationSelector != null && (
                <Field label="选择会话" htmlFor="chat-conversation" required>
                  {props.conversationSelector}
                </Field>
              )}
              {props.roleSelector != null && (
                <Field label="选择角色" htmlFor="chat-role" required>
                  {props.roleSelector}
                </Field>
              )}
            </div>
          )
        }
      />
      <div
        className={
          props.details != null && detailsOpen
            ? "frogie-chat-workspace"
            : "frogie-chat-workspace frogie-chat-workspace-single"
        }
      >
        {chat}
        {props.details != null && (
          <section
            id="execution-details"
            className="frogie-chat-details"
            aria-label="任务详情"
            hidden={!detailsOpen}
          >
            {props.details}
          </section>
        )}
      </div>
    </>
  );
}
