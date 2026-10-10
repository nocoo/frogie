import type { RuntimeEntry, RuntimeTask } from "@frogie/core/protocol";
import { Badge, Button, DescriptionList, LayerCard, Text } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { CodeBlock } from "@nocoo/basalt/components/code";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nocoo/basalt/components/collapsible";
import { ScrollArea } from "@nocoo/basalt/components/scroll-area";
import type { ExecutionSnapshot } from "../viewmodels/ExecutionViewModel.js";

export interface ExecutionViewProps {
  snapshot: ExecutionSnapshot;
  onRefresh(): void | Promise<void>;
  onSelectTask(id: RuntimeTask["id"]): void | Promise<void>;
  onLoadMoreTasks(): void | Promise<void>;
  onLoadMoreEntries(): void | Promise<void>;
}

function TaskDetails({ task }: { task: RuntimeTask }) {
  return (
    <div className="frogie-execution-stack">
      <DescriptionList columns={2}>
        <DescriptionList.Item term="Task ID">
          <Text variant="mono" size="xs">
            {task.id}
          </Text>
        </DescriptionList.Item>
        <DescriptionList.Item term="Conversation ID">
          <Text variant="mono" size="xs">
            {task.conversationId}
          </Text>
        </DescriptionList.Item>
        <DescriptionList.Item term="Owner">
          <Text variant="mono" size="xs">
            {task.owner === undefined
              ? `Conversation ${task.conversationId}`
              : `Task ${task.owner}`}
          </Text>
        </DescriptionList.Item>
        <DescriptionList.Item term="Phase">
          {task.state.phase ?? "未提供"}
        </DescriptionList.Item>
        <DescriptionList.Item term="Waits">
          <Text variant="mono" size="xs">
            {task.state.on?.join(", ") || "无"}
          </Text>
        </DescriptionList.Item>
        <DescriptionList.Item term="Outcome">
          {task.state.outcome ?? "未提供"}
        </DescriptionList.Item>
        <DescriptionList.Item term="Background">
          {String(task.background)}
        </DescriptionList.Item>
        <DescriptionList.Item term="Abort requested">
          {String(task.abortRequested)}
        </DescriptionList.Item>
        {task.startedAt !== undefined && (
          <DescriptionList.Item term="Started at">
            <Text variant="mono" size="xs">
              {task.startedAt}
            </Text>
          </DescriptionList.Item>
        )}
        {task.endedAt !== undefined && (
          <DescriptionList.Item term="Ended at">
            <Text variant="mono" size="xs">
              {task.endedAt}
            </Text>
          </DescriptionList.Item>
        )}
      </DescriptionList>
      {task.tool !== undefined && (
        <Collapsible defaultOpen>
          <CollapsibleTrigger>Tool · {task.tool.name}</CollapsibleTrigger>
          <CollapsibleContent unstyled className="frogie-execution-stack">
            <Text
              variant="mono"
              size="xs"
              tone="muted"
              className="frogie-execution-detail"
            >
              Call ID: {task.tool.callId}
              {task.tool.entryId === undefined
                ? ""
                : ` · Entry ID: ${task.tool.entryId}`}
            </Text>
            {task.tool.isError !== undefined && (
              <Badge variant={task.tool.isError ? "error" : "secondary"}>
                isError: {String(task.tool.isError)}
              </Badge>
            )}
            <CodeBlock
              title={
                task.tool.argumentsSource === "requested"
                  ? "请求参数（非最终执行参数）"
                  : "执行参数"
              }
              className="frogie-execution-code"
            >
              {JSON.stringify(task.tool.arguments, null, 2)}
            </CodeBlock>
            {task.tool.output !== undefined && (
              <CodeBlock title="Tool output" className="frogie-execution-code">
                {task.tool.output}
              </CodeBlock>
            )}
            {task.tool.details !== undefined && (
              <CodeBlock title="Tool details" className="frogie-execution-code">
                {JSON.stringify(task.tool.details, null, 2)}
              </CodeBlock>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function EntryDetails({ entry }: { entry: RuntimeEntry }) {
  return (
    <Collapsible>
      <CollapsibleTrigger>
        Entry {entry.id} · {entry.kind}
      </CollapsibleTrigger>
      <CollapsibleContent unstyled className="frogie-execution-stack">
        <DescriptionList columns={2}>
          <DescriptionList.Item term="来源 Conversation ID">
            <Text variant="mono" size="xs">
              {entry.conversationId}
            </Text>
          </DescriptionList.Item>
          {entry.byTaskId !== undefined && (
            <DescriptionList.Item term="By Task ID">
              <Text variant="mono" size="xs">
                {entry.byTaskId}
              </Text>
            </DescriptionList.Item>
          )}
          {entry.head !== undefined && (
            <DescriptionList.Item term="Head Entry ID">
              <Text variant="mono" size="xs">
                {entry.head}
              </Text>
            </DescriptionList.Item>
          )}
        </DescriptionList>
        {entry.messages.map((message, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Committed entry messages have immutable order and no individual IDs.
          <div key={`${entry.id}-${index}`} className="frogie-execution-stack">
            <CodeBlock
              title={`${message.role}${message.toolName === undefined ? "" : ` · ${message.toolName}`}`}
              className="frogie-execution-code"
            >
              {message.content}
            </CodeBlock>
            {message.toolCallId !== undefined && (
              <Text
                variant="mono"
                size="xs"
                className="frogie-execution-detail"
              >
                Call ID: {message.toolCallId}
              </Text>
            )}
            {message.isError !== undefined && (
              <Badge variant={message.isError ? "error" : "secondary"}>
                isError: {String(message.isError)}
              </Badge>
            )}
            {message.toolCalls?.map((call) => (
              <CodeBlock
                key={call.id}
                title={`请求参数 · ${call.name} · ${call.id}`}
                className="frogie-execution-code"
              >
                {JSON.stringify(call.arguments, null, 2)}
              </CodeBlock>
            ))}
            {message.details !== undefined && (
              <CodeBlock
                title="Message details"
                className="frogie-execution-code"
              >
                {JSON.stringify(message.details, null, 2)}
              </CodeBlock>
            )}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ExecutionView({ snapshot, ...actions }: ExecutionViewProps) {
  const inspection = snapshot.inspection;
  return (
    <LayerCard
      aria-label="Pi 执行详情"
      aria-busy={snapshot.busy}
      className="frogie-execution-view"
    >
      <LayerCard.Header className="frogie-execution-task-heading">
        <Text as="h2" size="sm" bold>
          Pi 执行
        </Text>
        <Button
          size="sm"
          variant="outline"
          disabled={snapshot.busy || snapshot.scope === undefined}
          onClick={actions.onRefresh}
        >
          刷新
        </Button>
      </LayerCard.Header>
      <ScrollArea
        className="frogie-execution-scroll"
        aria-label="Pi 执行观察内容"
        viewportClassName="frogie-execution-viewport"
      >
        <LayerCard.Body className="frogie-execution-stack">
          {snapshot.error !== null && (
            <Banner
              role="alert"
              variant="error"
              title="执行观察失败"
              description={snapshot.error}
            />
          )}
          {snapshot.scope !== undefined && (
            <Text
              variant="mono"
              size="xs"
              tone="muted"
              className="frogie-execution-detail"
            >
              {snapshot.scope.projectId} / {snapshot.scope.environmentId} /{" "}
              {snapshot.scope.squadId} / {snapshot.scope.harnessId}
              {snapshot.conversationId === undefined
                ? ""
                : ` · Conversation ${snapshot.conversationId}`}
            </Text>
          )}
          {inspection === undefined ? (
            <LayerCard.Empty
              title={snapshot.busy ? "加载执行观察" : "暂无执行投影"}
              description="从当前 Harness 读取真实 Pi 状态。"
            />
          ) : (
            <>
              <div className="frogie-execution-task-heading">
                <Badge variant="secondary">调度 {inspection.scheduling}</Badge>
                <Badge
                  variant={
                    Object.keys(inspection.graph.tasks).length === 0
                      ? "secondary"
                      : "default"
                  }
                >
                  {Object.keys(inspection.graph.tasks).length === 0
                    ? "idle"
                    : `${Object.keys(inspection.graph.tasks).length} 个 live task`}
                </Badge>
              </div>
              <Collapsible>
                <CollapsibleTrigger>Harness live TaskGraph</CollapsibleTrigger>
                <CollapsibleContent unstyled className="frogie-execution-stack">
                  <CodeBlock
                    title="Pi TaskGraph（当前 Harness）"
                    className="frogie-execution-code"
                  >
                    {JSON.stringify(inspection.graph, null, 2)}
                  </CodeBlock>
                </CollapsibleContent>
              </Collapsible>
              <Collapsible>
                <CollapsibleTrigger>Usage tokens · 费用未知</CollapsibleTrigger>
                <CollapsibleContent unstyled className="frogie-execution-stack">
                  <Text size="sm" tone="muted">
                    Provider 成本可能尚未配置；0 不代表免费。以下保留 Pi 原始
                    token 用量。
                  </Text>
                  {(["models", "tools"] as const).map((bucket) => (
                    <div key={bucket} className="frogie-execution-stack">
                      <Text as="h3" size="sm" bold>
                        {bucket}
                      </Text>
                      {Object.entries(inspection.usage[bucket]).length ===
                        0 && (
                        <Text size="sm" tone="muted">
                          尚无用量记录
                        </Text>
                      )}
                      {Object.entries(inspection.usage[bucket]).map(
                        ([id, usage]) => (
                          <LayerCard key={id} padding="sm">
                            <Text
                              variant="mono"
                              size="xs"
                              className="frogie-execution-detail"
                            >
                              {id}
                            </Text>
                            <DescriptionList columns={2}>
                              <DescriptionList.Item term="Input tokens">
                                {usage.input}
                              </DescriptionList.Item>
                              <DescriptionList.Item term="Output tokens">
                                {usage.output}
                              </DescriptionList.Item>
                              <DescriptionList.Item term="Cache read tokens">
                                {usage.cacheRead}
                              </DescriptionList.Item>
                              <DescriptionList.Item term="Cache write tokens">
                                {usage.cacheWrite}
                              </DescriptionList.Item>
                              <DescriptionList.Item term="Total tokens">
                                {usage.totalTokens}
                              </DescriptionList.Item>
                              {usage.reasoning !== undefined && (
                                <DescriptionList.Item term="Reasoning tokens">
                                  {usage.reasoning}
                                </DescriptionList.Item>
                              )}
                            </DescriptionList>
                          </LayerCard>
                        ),
                      )}
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
          <Text as="h3" size="sm" bold>
            Tasks
          </Text>
          {snapshot.tasks.length === 0 && (
            <Text size="sm" tone="muted">
              当前目标暂无任务记录。
            </Text>
          )}
          <div className="frogie-execution-tasks">
            {snapshot.tasks.map((task) => (
              <LayerCard
                key={task.id}
                padding="sm"
                className="frogie-execution-task"
              >
                <div className="frogie-execution-task-heading">
                  <Button
                    size="sm"
                    variant={
                      snapshot.selectedTask?.id === task.id
                        ? "default"
                        : "ghost"
                    }
                    disabled={snapshot.busy}
                    aria-pressed={snapshot.selectedTask?.id === task.id}
                    onClick={() => actions.onSelectTask(task.id)}
                  >
                    {task.tool?.name ?? task.kind} · {task.id}
                  </Button>
                  <Badge
                    variant={
                      task.state.outcome === "failed" ||
                      task.state.outcome === "faulted"
                        ? "error"
                        : "secondary"
                    }
                  >
                    {task.state.status}
                  </Badge>
                </div>
                <Text
                  size="sm"
                  tone="muted"
                  className="frogie-execution-detail"
                >
                  Owner:{" "}
                  {task.owner === undefined
                    ? `Conversation ${task.conversationId}`
                    : `Task ${task.owner}`}{" "}
                  · Phase: {task.state.phase ?? "未提供"}
                  {task.state.on === undefined
                    ? ""
                    : ` · Waits: ${task.state.on.join(", ") || "无"}`}
                </Text>
              </LayerCard>
            ))}
          </div>
          {snapshot.taskCursor !== null && (
            <Button
              variant="outline"
              disabled={snapshot.busy}
              onClick={actions.onLoadMoreTasks}
            >
              加载更多 Tasks
            </Button>
          )}
          {snapshot.selectedTask !== undefined && (
            <LayerCard padding="sm">
              <Text as="h3" size="sm" bold>
                Task {snapshot.selectedTask.id} 详情
              </Text>
              <TaskDetails task={snapshot.selectedTask} />
            </LayerCard>
          )}
          <Text as="h3" size="sm" bold>
            Entries
          </Text>
          {snapshot.conversationId === undefined ? (
            <Text size="sm" tone="muted">
              选择 Conversation 后查看 Entry 历史。
            </Text>
          ) : (
            snapshot.entries.length === 0 && (
              <Text size="sm" tone="muted">
                当前会话暂无 Entry 记录。
              </Text>
            )
          )}
          {snapshot.entries.map((entry) => (
            <EntryDetails key={entry.id} entry={entry} />
          ))}
          {snapshot.entryCursor !== null && (
            <Button
              variant="outline"
              disabled={snapshot.busy}
              onClick={actions.onLoadMoreEntries}
            >
              加载更多 Entries
            </Button>
          )}
        </LayerCard.Body>
      </ScrollArea>
    </LayerCard>
  );
}
