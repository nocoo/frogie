import type { Context, JsonValue } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  type Conversation,
  type ConversationId,
  type Cursor,
  type EntryId,
  type EntryRecord,
  type Harness,
  LiveDoc,
  type Page,
  type Storage,
  type TaskId,
  type TaskRecord,
  ToolResultEntry,
} from "@earendil-works/pi-durable";
import type {
  ListEntriesInput,
  ListTasksInput,
  RuntimeEntry,
  RuntimeInspection,
  RuntimeMessage,
  RuntimePage,
  RuntimeScope,
  RuntimeTask,
} from "../protocol/index.js";

const byteLimit = 1024 * 1024;
type NativeTask = TaskRecord<JsonValue, JsonValue, unknown>;

function publicJSON(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function fail(code: string): Error {
  return Object.assign(new Error("Runtime inspection could not complete"), {
    code,
    retryable: false,
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(content: Message["content"]): string {
  return typeof content === "string"
    ? content
    : content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}

function message(value: Message): RuntimeMessage | undefined {
  if (value.role === "system") return undefined;
  if (value.role === "user")
    return { role: "user", content: text(value.content) };
  if (value.role === "assistant") {
    const toolCalls = value.content.flatMap((block) =>
      block.type === "toolCall"
        ? [
            {
              id: block.id,
              name: block.name,
              arguments: publicJSON(block.arguments),
            },
          ]
        : [],
    );
    return {
      role: "assistant",
      content: text(value.content),
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  }
  return {
    role: "toolResult",
    content: text(value.content),
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    isError: value.isError,
    ...(value.details === undefined
      ? {}
      : { details: publicJSON(value.details) }),
  };
}

function entry(value: EntryRecord): RuntimeEntry {
  return {
    id: value.id,
    conversationId: value.conversationId,
    kind: value.kind,
    ...(value.byTaskId === undefined ? {} : { byTaskId: value.byTaskId }),
    ...(value.head === undefined ? {} : { head: value.head }),
    messages: (value.model ?? []).flatMap((item) => {
      const projected = message(item);
      return projected ? [projected] : [];
    }),
  };
}

function bounded<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > byteLimit)
    throw fail("output_limit");
  return value;
}

function encode(key: string, position: Cursor | undefined): string | null {
  return position === undefined
    ? null
    : Buffer.from(JSON.stringify({ version: 1, key, position })).toString(
        "base64url",
      );
}

function decode(key: string, cursor: string | undefined): Cursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    if (!cursor.length || cursor.length > 4096 || !/^[\w-]+$/u.test(cursor))
      throw fail("invalid_request");
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) throw fail("invalid_request");
    const value = record(JSON.parse(bytes.toString("utf8")));
    const position = record(value?.position);
    if (
      value?.version !== 1 ||
      value.key !== key ||
      !position ||
      !Number.isSafeInteger(position.after) ||
      (position.after as number) <= 0 ||
      position.order !== "descending" ||
      Object.keys(position).length !== 2
    )
      throw fail("invalid_request");
    return position as Cursor;
  } catch {
    throw fail("invalid_request");
  }
}

async function page<T, N>(options: {
  key: string;
  limit?: number;
  cursor?: string;
  context: Context;
  scan(cursor: Cursor | undefined): Promise<Page<N, Cursor>>;
  project(value: N): Promise<T | undefined>;
}): Promise<RuntimePage<T>> {
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw fail("invalid_request");
  let position = decode(options.key, options.cursor);
  const items: T[] = [];
  for (;;) {
    options.context.abortSignal?.throwIfAborted();
    const native = await options.scan(position);
    const value = native.items[0];
    if (value === undefined) return { items, cursor: null };
    const projected = await options.project(value);
    const cursor = encode(options.key, native.next);
    if (projected !== undefined) {
      bounded({ items: [projected], cursor });
      if (
        Buffer.byteLength(
          JSON.stringify({ items: [...items, projected], cursor }),
          "utf8",
        ) > byteLimit
      )
        return bounded({ items, cursor: encode(options.key, position) });
      items.push(projected);
    }
    position = native.next;
    if (position === undefined || items.length === limit)
      return bounded({ items, cursor });
  }
}

export function createRuntimeInspection(options: {
  harness: Harness;
  storage: Storage;
  scope: RuntimeScope;
  conversation(id: ConversationId, context: Context): Promise<Conversation>;
  owns(id: ConversationId, context: Context): Promise<boolean>;
}): {
  inspect(context: Context): Promise<RuntimeInspection>;
  listEntries(
    input: ListEntriesInput,
    context: Context,
  ): Promise<RuntimePage<RuntimeEntry>>;
  listTasks(
    input: ListTasksInput,
    context: Context,
  ): Promise<RuntimePage<RuntimeTask>>;
  getTask(id: TaskId, context: Context): Promise<RuntimeTask | undefined>;
} {
  const key = (kind: string, conversationId?: ConversationId) =>
    JSON.stringify([
      options.scope.projectId,
      options.scope.environmentId,
      options.scope.squadId,
      options.scope.harnessId,
      kind,
      conversationId ?? null,
    ]);
  const task = async (
    value: NativeTask,
    context: Context,
  ): Promise<RuntimeTask> => {
    const state = value.state;
    const checkpoint =
      "checkpoint" in state ? record(state.checkpoint) : undefined;
    const projected: RuntimeTask = {
      id: value.id,
      conversationId: value.conversationId,
      kind: value.kind,
      ...(value.owner === undefined ? {} : { owner: value.owner }),
      background: value.background,
      abortRequested: value.abortRequested,
      ...(value.startedAt === undefined ? {} : { startedAt: value.startedAt }),
      ...(value.endedAt === undefined ? {} : { endedAt: value.endedAt }),
      state: {
        status: state.status,
        ...(typeof checkpoint?.phase === "string"
          ? { phase: checkpoint.phase }
          : {}),
        ...(state.status === "waiting" ? { on: [...state.on] } : {}),
        ...(state.outcome === undefined
          ? {}
          : { outcome: state.outcome.status }),
      },
    };
    if (value.kind !== "pi.tool") return projected;
    const input = record(value.input);
    if (
      !Number.isSafeInteger(input?.assistant) ||
      typeof input?.callId !== "string"
    )
      throw fail("binding_mismatch");
    const assistant = await options.storage.entry(
      value.conversationId,
      input.assistant as EntryId,
      context,
    );
    if (!AssistantEntry.is(assistant?.entry)) throw fail("binding_mismatch");
    const call = assistant.entry.model
      ?.flatMap((item) => (item.role === "assistant" ? item.content : []))
      .find((block) => block.type === "toolCall" && block.id === input.callId);
    if (call?.type !== "toolCall") throw fail("binding_mismatch");
    const execution = checkpoint?.phase === "execute";
    if (execution && !record(checkpoint.arguments))
      throw fail("binding_mismatch");
    const tool: NonNullable<RuntimeTask["tool"]> = {
      callId: call.id,
      name: call.name,
      arguments: publicJSON(execution ? checkpoint.arguments : call.arguments),
      argumentsSource: execution ? "execution" : "requested",
    };
    if (state.outcome !== undefined) {
      const result = record(state.outcome.result);
      if (result?.entryId !== undefined) {
        if (!Number.isSafeInteger(result.entryId))
          throw fail("binding_mismatch");
        const stored = await options.storage.entry(
          result.entryId as EntryId,
          context,
        );
        if (
          !ToolResultEntry.is(stored?.entry) ||
          stored.entry.conversationId !== value.conversationId ||
          (stored.entry.byTaskId !== undefined &&
            stored.entry.byTaskId !== value.id)
        )
          throw fail("binding_mismatch");
        const output = stored.entry.model?.find(
          (item) =>
            item.role === "toolResult" &&
            item.toolCallId === call.id &&
            item.toolName === call.name,
        );
        if (output?.role !== "toolResult") throw fail("binding_mismatch");
        return {
          ...projected,
          tool: {
            ...tool,
            output: text(output.content),
            isError: output.isError,
            entryId: stored.entry.id,
            ...(output.details === undefined
              ? {}
              : { details: publicJSON(output.details) }),
          },
        };
      }
    } else {
      const live = await options.harness.snapshot(
        LiveDoc,
        value.conversationId,
        context,
      );
      const slot = live?.tools?.find(
        (item) =>
          item.taskId === value.id &&
          item.callId === call.id &&
          item.name === call.name,
      );
      if (slot)
        return {
          ...projected,
          tool: {
            ...tool,
            ...(slot.output === undefined ? {} : { output: slot.output }),
            ...(slot.details === undefined
              ? {}
              : { details: publicJSON(slot.details) }),
          },
        };
    }
    return { ...projected, tool };
  };
  return {
    inspect: async (context) => {
      const native = await options.harness.inspect(context);
      const graph = await options.harness.taskGraph(context);
      try {
        return {
          scope: options.scope,
          scheduling: native.scheduling,
          graph: structuredClone(graph.value),
          usage: await options.harness.usage(context),
        };
      } finally {
        graph.dispose();
      }
    },
    listEntries: async (input, context) => {
      const conversation = await options.conversation(
        input.conversationId,
        context,
      );
      return page({
        ...input,
        key: key("entries", input.conversationId),
        context,
        scan: (cursor) =>
          conversation.entries({ order: "descending" }, 1, cursor, context),
        project: async (value) => entry(value),
      });
    },
    listTasks: async (input, context) => {
      if (input.conversationId !== undefined)
        await options.conversation(input.conversationId, context);
      return page({
        ...input,
        key: key("tasks", input.conversationId),
        context,
        scan: (cursor) =>
          options.storage.scanTasks(
            {
              order: "descending",
              ...(input.conversationId === undefined
                ? {}
                : { conversationId: input.conversationId }),
            },
            1,
            cursor,
            context,
          ),
        project: async (value) =>
          (await options.owns(value.conversationId, context))
            ? task(value, context)
            : undefined,
      });
    },
    getTask: async (id, context) => {
      if (!Number.isSafeInteger(id) || id <= 0) throw fail("invalid_request");
      const value = await options.harness.getTask(id, context);
      if (!value) return undefined;
      await options.conversation(value.conversationId, context);
      return bounded(await task(value, context));
    },
  };
}
