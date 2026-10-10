import type { Context, JsonValue } from "@earendil-works/chord";
import {
  AssistantEntry,
  type ConversationId,
  defineTool,
  type Extension,
  type ToolExecutionApi,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import type { ConversationBinding } from "@frogie/core/protocol";
import {
  configureRuntimeRole,
  type RuntimeConfiguration,
  readRuntimeRole,
} from "@frogie/core/runtime";
import { Type } from "typebox";
import {
  type ArtifactStore,
  contentDigest,
  localFailure,
  objectId,
  utf8Content,
} from "./artifacts.js";
import { canonicalJSON, type createScriptRunner } from "./scriptRunner.js";

const id = Type.Integer({ minimum: 1 });
const text = Type.String({ minLength: 1, maxLength: 1024 * 1024 });
const identifier = Type.String({ pattern: "^[a-z][a-z0-9-]*$" });
const object = <T extends Record<string, import("typebox").TSchema>>(
  properties: T,
) => Type.Object(properties, { additionalProperties: false });

function result(value: JsonValue): ToolExecutionResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function safeFailure(error: unknown): ToolExecutionResult {
  const known = [
    "forbidden",
    "not_found",
    "invalid_request",
    "conflict",
    "binding_mismatch",
    "capability_missing",
    "script_failed",
    "output_limit",
    "deadline_exceeded",
    "cancelled",
  ];
  const code =
    error instanceof Error && error.name === "AbortError"
      ? "cancelled"
      : error instanceof Error &&
          "code" in error &&
          typeof error.code === "string" &&
          known.includes(error.code)
        ? error.code
        : "runtime_unavailable";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          code,
          message: "Local tool operation could not complete",
        }),
      },
    ],
    diagnostics: [
      {
        severity: "error",
        code,
        message: "Local tool operation could not complete",
      },
    ],
  };
}

export function createLocalTools(options: {
  runtime: RuntimeConfiguration;
  artifacts: ArtifactStore;
  scripts: ReturnType<typeof createScriptRunner>;
}): Extension {
  const runtime = options.runtime;
  const authorize = async (
    api: ToolExecutionApi,
    name: string,
    context: Context,
  ): Promise<ConversationBinding> => {
    const binding = await readRuntimeRole(
      api,
      runtime,
      api.conversationId,
      context,
    );
    const role = runtime.definition.roles.find(
      ({ id }) => id === binding.roleId,
    );
    const workflow =
      binding.workflowId === undefined
        ? undefined
        : runtime.definition.workflows.find(
            ({ id }) => id === binding.workflowId,
          );
    const agent = await api.agent(context);
    if (
      !role?.extensions.includes("frogie") ||
      !role.tools.includes(name) ||
      !agent.tools.some((tool) => tool.name === name) ||
      (binding.workflowId !== undefined &&
        (!workflow ||
          (workflow.tools !== undefined && !workflow.tools.includes(name))))
    )
      throw localFailure(
        "forbidden",
        "Tool is not allowed for this role and workflow",
      );
    return binding;
  };
  const protect = async (
    action: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> => {
    try {
      return await action();
    } catch (error) {
      return safeFailure(error);
    }
  };
  const read = defineTool({
    name: "read_artifact",
    description:
      "Read an immutable artifact explicitly granted to this conversation.",
    replay: "safe",
    parameters: object({ id: Type.String({ minLength: 1, maxLength: 256 }) }),
    execute: (args, api, context) =>
      protect(async () => {
        await authorize(api, "read_artifact", context);
        const artifact = await options.artifacts.read(
          args.id,
          api.conversationId,
        );
        return result({
          ref: artifact.ref as unknown as JsonValue,
          content: artifact.content,
        });
      }),
  });
  const write = defineTool({
    name: "write_artifact",
    description:
      "Save an immutable UTF-8 result up to one MiB; names are display metadata, not paths.",
    replay: "safe",
    parameters: object({
      name: Type.String({ minLength: 1, maxLength: 256 }),
      content: Type.String({ maxLength: 1024 * 1024 }),
      mediaType: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    }),
    execute: (args, api, context) =>
      protect(async () => {
        await authorize(api, "write_artifact", context);
        const artifact = await options.artifacts.write({
          conversationId: api.conversationId,
          taskId: api.taskId,
          operationId: `tool:${api.taskId}`,
          name: args.name,
          content: args.content,
          mediaType: args.mediaType ?? "text/markdown",
        });
        await api.details(
          { artifact: artifact as unknown as JsonValue },
          context,
        );
        return result(artifact as unknown as JsonValue);
      }),
  });
  const script = defineTool({
    name: "run_script",
    description:
      "Execute an approved pure-computation Skill script in the local network-free sandbox.",
    replay: "safe",
    parameters: object({
      skillId: identifier,
      scriptId: identifier,
      input: Type.Unknown(),
    }),
    execute: (args, api, context) =>
      protect(async () => {
        const binding = await authorize(api, "run_script", context);
        const output = await options.scripts.run(
          {
            conversationId: api.conversationId,
            taskId: api.taskId,
            roleId: binding.roleId,
            ...(binding.workflowId === undefined
              ? {}
              : { workflowId: binding.workflowId }),
            skillId: args.skillId,
            scriptId: args.scriptId,
            input: args.input as JsonValue,
          },
          context,
        );
        await api.details(
          { artifact: output.artifact as unknown as JsonValue },
          context,
        );
        return result(output as unknown as JsonValue);
      }),
  });
  const delegate = defineTool({
    name: "delegate",
    description:
      "Delegate a task to one direct child role and wait for its real Pi submission result.",
    replay: "safe",
    executionMode: "parallel",
    parameters: object({
      roleId: identifier,
      task: text,
      artifacts: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
          maxItems: 100,
          uniqueItems: true,
        }),
      ),
    }),
    execute: (args, api, context) =>
      protect(async () => {
        const binding = await authorize(api, "delegate", context);
        const target = runtime.definition.roles.find(
          ({ id }) => id === args.roleId,
        );
        if (!target || target.parentRoleId !== binding.roleId)
          throw localFailure(
            "forbidden",
            "Delegation is limited to direct child roles",
          );
        utf8Content(args.task);
        const artifacts = [...(args.artifacts ?? [])].sort();
        const normalized = canonicalJSON({
          roleId: args.roleId,
          task: args.task,
          artifacts,
          workflowId: binding.workflowId ?? null,
        });
        const digest = contentDigest(normalized);
        const existing = await api.memo(
          "frogie.delegate.input",
          digest,
          context,
        );
        if (existing !== digest)
          throw localFailure(
            "conflict",
            "Delegation task identifies different input",
          );
        for (const artifact of artifacts)
          await options.artifacts.read(artifact, api.conversationId);
        const conversationId = await api.commit(async (tx) => {
          const owned = await tx.scanConversations(
            { ownerTaskId: api.taskId },
            2,
          );
          if (owned.items.length > 1 || owned.next !== undefined)
            throw localFailure(
              "binding_mismatch",
              "Delegation task owns more than one conversation",
            );
          const previous = owned.items[0];
          if (previous) {
            if (previous.owner?.conversationId !== api.conversationId)
              throw localFailure(
                "binding_mismatch",
                "Delegation conversation ownership does not match",
              );
            return previous.id;
          }
          const created = await tx.createConversation({
            ownership: { kind: "task", taskId: api.taskId },
          });
          await configureRuntimeRole(
            tx,
            runtime,
            created.id,
            args.roleId,
            binding.workflowId === undefined
              ? {}
              : { workflowId: binding.workflowId },
          );
          return created.id;
        }, context);
        const childBinding = await readRuntimeRole(
          api,
          runtime,
          conversationId,
          context,
        );
        if (
          childBinding.roleId !== args.roleId ||
          childBinding.workflowId !== binding.workflowId
        )
          throw localFailure(
            "binding_mismatch",
            "Delegated role binding does not match",
          );
        await options.artifacts.grant(
          artifacts,
          api.conversationId,
          conversationId,
        );
        const child = await api.conversation(conversationId, context);
        if (!child)
          throw localFailure(
            "not_found",
            "Delegated conversation was not found",
          );
        const submission = await child.submit(
          {
            type: "input",
            requestId: `frogie.delegate:${api.taskId}`,
            content: `${args.task}${artifacts.length ? `\n\nInput artifact IDs:\n${artifacts.join("\n")}` : ""}`,
          },
          context,
        );
        await api.details(
          { conversationId, submissionId: submission.id, roleId: args.roleId },
          context,
        );
        const settled = await submission.wait(context);
        if (settled.type !== "input" || settled.status !== "done")
          return {
            isError: true,
            ...result({
              conversationId,
              submissionId: submission.id,
              status: settled.status,
              code: "child_unanswered",
            }),
          };
        const answer = await api.commit(
          (tx) => tx.entry(AssistantEntry, settled.answer),
          context,
        );
        if (!answer || answer.conversationId !== conversationId)
          throw localFailure(
            "binding_mismatch",
            "Delegated answer does not match its conversation",
          );
        const content = (answer.model ?? [])
          .flatMap((message) =>
            message.role === "assistant"
              ? message.content
                  .filter((block) => block.type === "text")
                  .map((block) => block.text)
              : [],
          )
          .join("\n");
        utf8Content(content);
        const outputs = (await options.artifacts.list(conversationId)).filter(
          (artifact) => !artifacts.includes(artifact.id),
        );
        await options.artifacts.grant(
          outputs.map(({ id }) => id),
          conversationId,
          api.conversationId,
        );
        const details = {
          conversationId,
          submissionId: submission.id,
          status: settled.status,
          answerEntryId: settled.answer,
          content,
          artifacts: outputs as unknown as JsonValue,
        };
        await api.details(details, context);
        return result(details);
      }),
  });
  const history = defineTool({
    name: "read_history",
    description:
      "Read a bounded page of this conversation's committed history without starting model work.",
    replay: "safe",
    parameters: object({
      conversationId: Type.Optional(id),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    }),
    execute: (args, api, context) =>
      protect(async () => {
        await authorize(api, "read_history", context);
        const conversationId = args.conversationId ?? api.conversationId;
        objectId(conversationId);
        const limit = args.limit ?? 100;
        objectId(limit);
        if (limit > 100)
          throw localFailure(
            "invalid_request",
            "History page limit exceeds 100 entries",
          );
        if (conversationId !== api.conversationId)
          throw localFailure(
            "forbidden",
            "History access is limited to the current conversation",
          );
        let upper: number | undefined;
        if (args.cursor !== undefined) {
          if (!/^\d+$/u.test(args.cursor))
            throw localFailure("invalid_request", "History cursor is invalid");
          upper = Number(args.cursor);
          objectId(upper);
        }
        const page = await api.commit(
          (tx) =>
            tx.scanEntries(
              {
                conversationId: conversationId as ConversationId,
                order: "descending",
                ...(upper === undefined
                  ? {}
                  : {
                      maxEntryId:
                        upper as import("@earendil-works/pi-durable").EntryId,
                    }),
              },
              limit,
            ),
          context,
        );
        const entries: JsonValue[] = [];
        let byteLength = 0;
        for (const entry of page.items) {
          const value: JsonValue = {
            id: entry.id,
            conversationId: entry.conversationId,
            kind: entry.kind,
            ...(entry.model === undefined
              ? {}
              : { model: entry.model as unknown as JsonValue }),
            ...(entry.head === undefined ? {} : { head: entry.head }),
            ...(entry.byTaskId === undefined
              ? {}
              : { byTaskId: entry.byTaskId }),
          };
          const length = Buffer.byteLength(JSON.stringify(value), "utf8");
          if (byteLength + length > 1024 * 1024 - 4096) break;
          byteLength += length;
          entries.push(value);
        }
        if (!entries.length && page.items.length)
          throw localFailure(
            "output_limit",
            "A history entry exceeds the page byte limit",
          );
        const last = page.items[entries.length - 1];
        const hasMore =
          entries.length < page.items.length || page.next !== undefined;
        return result({
          conversationId,
          entries,
          cursor: hasMore && last && last.id > 1 ? String(last.id - 1) : null,
        });
      }),
  });
  return {
    name: "frogie",
    tools: [delegate, read, write, script, history],
    sections: [
      {
        key: "frogie-local-tools",
        render: async (input, context) => {
          const binding = await readRuntimeRole(
            input.read,
            runtime,
            input.conversationId,
            context,
          );
          const role = runtime.definition.roles.find(
            ({ id }) => id === binding.roleId,
          );
          const children = runtime.definition.roles
            .filter(({ parentRoleId }) => parentRoleId === binding.roleId)
            .map(({ id, title }) => `${id}: ${title}`);
          return `Delegate only to direct child roles: ${children.join("; ") || "none"}. Each delegation waits for its child result.\nApproved role script IDs: ${role?.scripts.join(", ") || "none"}. Use skillId and scriptId, never a command or path.\nArtifacts are immutable references. Pass input IDs when delegating; read only explicitly granted IDs. write_artifact names are display labels. read_history reads only the current conversation.\nAvailable selected tools: ${input.agent.tools.map(({ name }) => name).join(", ") || "none"}.`;
        },
      },
    ],
  };
}
