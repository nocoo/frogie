import type { JsonValue } from "@earendil-works/chord";
import type {
  ConversationId,
  EntryId,
  TaskGraph,
  TaskId,
  UsageState,
} from "@earendil-works/pi-durable";
import type { RuntimeBudgetSnapshot } from "./budget.js";
import type { RuntimeScope } from "./index.js";

export interface RuntimeMessage {
  readonly role: "user" | "assistant" | "toolResult";
  readonly content: string;
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: JsonValue;
  }[];
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly details?: JsonValue;
}

export interface RuntimeEntry {
  readonly id: EntryId;
  readonly conversationId: ConversationId;
  readonly kind: string;
  readonly byTaskId?: TaskId;
  readonly head?: EntryId;
  readonly messages: readonly RuntimeMessage[];
}

export interface RuntimeTask {
  readonly id: TaskId;
  readonly conversationId: ConversationId;
  readonly kind: string;
  readonly owner?: TaskId;
  readonly background: boolean;
  readonly abortRequested: boolean;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly state: {
    readonly status:
      | "pending"
      | "running"
      | "waiting"
      | "completing"
      | "terminal";
    readonly phase?: string;
    readonly on?: readonly TaskId[];
    readonly outcome?:
      | "completed"
      | "failed"
      | "aborted"
      | "orphaned"
      | "faulted";
  };
  readonly tool?: {
    readonly callId: string;
    readonly name: string;
    readonly arguments: JsonValue;
    readonly argumentsSource: "requested" | "execution";
    readonly output?: string;
    readonly details?: JsonValue;
    readonly isError?: boolean;
    readonly entryId?: EntryId;
  };
}

export interface RuntimeInspection {
  readonly scope: RuntimeScope;
  readonly scheduling: "paused" | "running" | "closing";
  readonly graph: TaskGraph;
  readonly usage: UsageState;
  readonly budget?: RuntimeBudgetSnapshot;
}

export interface RuntimePage<T> {
  readonly items: readonly T[];
  readonly cursor: string | null;
}

export interface ListEntriesInput {
  readonly conversationId: ConversationId;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ListTasksInput {
  readonly conversationId?: ConversationId;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface GetTaskInput {
  readonly taskId: TaskId;
}

export type InspectInput = Record<string, never>;
