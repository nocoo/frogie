import { Button, LayerCard, Text } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { ChatBubble } from "@nocoo/basalt/components/chat-bubble";
import { ChatComposer } from "@nocoo/basalt/components/chat-composer";
import { ChatHeader } from "@nocoo/basalt/components/chat-header";
import { ChatMarkdown } from "@nocoo/basalt/components/chat-markdown";
import { Loader } from "@nocoo/basalt/components/loader";

export interface ChatViewEntry {
  id: string;
  variant: "user" | "assistant" | "system";
  content: string;
  author?: string;
  streaming?: boolean;
}

export interface ChatViewProps {
  title: string;
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
  return (
    <LayerCard aria-label={props.title}>
      <ChatHeader title={props.title}>
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
      </ChatHeader>
      <LayerCard.Body className="space-y-basalt-layout">
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
          <LayerCard.Empty title="暂无消息" description="发送消息开始对话。" />
        )}
        {props.entries.map((entry) => (
          <ChatBubble
            key={entry.id}
            variant={entry.variant}
            streaming={entry.streaming ?? false}
          >
            {entry.author !== undefined && (
              <Text as="span" size="sm" tone="muted">
                {entry.author}
              </Text>
            )}
            {entry.variant === "user" ? (
              <Text className="whitespace-pre-wrap text-basalt-primary-foreground">
                {entry.content}
              </Text>
            ) : (
              <ChatMarkdown
                content={entry.content}
                streaming={entry.streaming ?? false}
              />
            )}
          </ChatBubble>
        ))}
      </LayerCard.Body>
      <LayerCard.Footer>
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
          className="w-full"
        />
      </LayerCard.Footer>
    </LayerCard>
  );
}
