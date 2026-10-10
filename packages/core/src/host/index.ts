import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  AssistantEntry,
  type ConversationId,
  type Cursor,
  configure,
  createRegistry,
  defineDoc,
  defineExtension,
  defineTool,
  type JsonObject,
  MemoryStorage,
  type Tx,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { TSchema } from "typebox";
import Value from "typebox/value";
import type { DefinitionDefaults } from "../definitions/types.js";
import {
  configureRuntimeRole,
  openRuntime,
  type RuntimeOptions,
} from "../runtime/index.js";
import { contextModels } from "./context.js";
import { setHostInternals, unwrapModels } from "./internal.js";
import type {
  Host,
  HostOptions,
  HostRoleChange,
  HostRunResult,
  HostTool,
} from "./types.js";

export { CONTEXT_BLOCKED } from "./context.js";
export { inspectDatabase, type ToolDiagnostic } from "./diagnostics.js";
export { configuredModels, type HostProviderConfig } from "./models.js";
export type * from "./types.js";

export function defineHostTool<Schema extends TSchema>(
  tool: HostTool<Schema>,
): HostTool<Schema> {
  return tool;
}

interface HostState extends JsonObject {
  roles: Record<string, string>;
  requests: Record<string, string>;
}
const State = defineDoc<HostState>({
  kind: "frogie.host",
  version: 1,
  scope: "session",
  initial: () => ({ roles: {}, requests: {} }),
});
const context = BACKGROUND_CONTEXT;
const conversationId = (id: number): ConversationId => {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error("Invalid conversation ID");
  return id as ConversationId;
};

export async function openAgentHost<Business extends object>(
  options: HostOptions<Business>,
): Promise<Host<Business>> {
  if (
    options.state.kind.startsWith("pi.") ||
    options.state.kind.startsWith("frogie.")
  )
    throw new Error("Business state kind is reserved");
  const business = defineDoc<JsonObject>({
    kind: options.state.kind,
    version: 1,
    scope: "session",
    initial: () => options.state.initial() as JsonObject,
  });
  const registry = createRegistry();
  const names = new Set<string>();
  const tools = options.tools.map((tool) => {
    if (names.has(tool.name))
      throw new Error(`Duplicate host tool: ${tool.name}`);
    names.add(tool.name);
    return defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      replay: tool.replay,
      execute: async (args, api, executionContext) => {
        if (!Value.Check(tool.parameters, args))
          throw new Error("Invalid tool arguments");
        return tool.execute(args, {
          conversationId: api.conversationId,
          taskId: api.taskId,
          signal: executionContext.abortSignal ?? new AbortController().signal,
        });
      },
    });
  });
  if (options.execution) registry.install(CodingTools);
  const extensions = new Set(
    options.definition.roles.flatMap((role) => role.extensions),
  );
  for (const name of extensions) {
    if (name === CodingTools.name) continue;
    const selected = new Set(
      options.definition.roles
        .filter((role) => role.extensions.includes(name))
        .flatMap((role) => role.tools),
    );
    registry.install(
      defineExtension({
        name,
        tools: tools.filter((tool) => selected.has(tool.name)),
      }),
    );
  }
  const roleDefaults: Record<string, DefinitionDefaults> = {};
  for (const role of options.definition.roles) {
    const selected = options.roles[role.id];
    if (!selected) throw new Error(`Missing role selection: ${role.id}`);
    roleDefaults[role.id] = {
      model: { provider: selected.provider, modelId: selected.modelId },
      thinkingLevel: selected.thinkingLevel,
    };
  }
  const environments = new Map<number, Promise<NodeExecutionEnv>>();
  const cleanupEnvironments = async (): Promise<unknown[]> => {
    const results = await Promise.allSettled(
      [...environments.values()].map(async (environment) =>
        (await environment).cleanup(context),
      ),
    );
    environments.clear();
    return results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
  };
  const models = contextModels(
    unwrapModels(options.models),
    options.summaryPrompt,
  );
  const execution = options.execution;
  const runtimeOptions: RuntimeOptions = {
    runtimeId: options.runtimeId,
    definition: options.definition,
    binding: {
      projectId: options.definition.projectId,
      scope: options.scope,
      definition: { contentHash: options.definition.contentHash },
    },
    storage: options.databasePath
      ? await openNodeSqliteStorage(options.databasePath)
      : new MemoryStorage(),
    models,
    registry,
    roleDefaults,
    resume: false,
    authorization: async () => true,
    harness: {
      settings: { extensions: [], toolExecution: "sequential" },
      ...(options.onReport ? { onReport: options.onReport } : {}),
      ...(execution
        ? {
            env: async (target) => {
              let environment = environments.get(target.conversationId);
              if (!environment) {
                const directory = join(
                  execution.directory,
                  createHash("sha256")
                    .update(JSON.stringify(target.conversationId))
                    .digest("hex"),
                );
                environment = mkdir(directory, {
                  recursive: true,
                  mode: 0o700,
                }).then(
                  () =>
                    new NodeExecutionEnv({
                      cwd: directory,
                      shellEnv: execution.shellEnv,
                    }),
                );
                environments.set(target.conversationId, environment);
                void environment.catch(() =>
                  environments.delete(target.conversationId),
                );
              }
              return environment;
            },
          }
        : {}),
    },
  };
  const runtime = await openRuntime(runtimeOptions, context);
  const { harness } = runtime;
  let closed = false;
  let resumed = false;
  let staging: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const runs = new Map<
    number,
    { requestId: string; fingerprint: string; promise: Promise<HostRunResult> }
  >();
  const checkOpen = () => {
    if (closed) throw new Error("Host is closed");
  };
  const configureRole = async (
    tx: Tx,
    id: number,
    change: HostRoleChange,
  ): Promise<void> => {
    const state = await tx.doc(State);
    const existing = state.roles[id];
    if (!existing) throw new Error("Conversation does not belong to this host");
    const roleId = change.roleId ?? existing;
    const { roleId: _roleId, ...selection } = change;
    await configureRuntimeRole(
      tx,
      runtimeOptions,
      conversationId(id),
      roleId,
      selection,
    );
    state.roles[id] = roleId;
  };
  const conversation = async (id: number) => {
    checkOpen();
    const state = await harness.snapshot(State, context);
    if (!state?.roles[id])
      throw new Error("Conversation does not belong to this host");
    const value = await harness.conversation(conversationId(id), context);
    if (!value) throw new Error("Conversation was not found");
    return value;
  };
  try {
    await harness.commit(async (tx) => {
      const state = await tx.doc(State);
      state.roles[runtime.root.id] = options.definition.rootRoleId;
      await tx.doc(business);
    }, context);
  } catch (error) {
    const errors: unknown[] = [error];
    try {
      await runtime.close(context);
    } catch (closeError) {
      errors.push(closeError);
    }
    errors.push(...(await cleanupEnvironments()));
    if (errors.length > 1)
      throw new AggregateError(errors, "Host startup and cleanup failed");
    throw error;
  }
  const host: Host<Business> = {
    rootId: runtime.root.id,
    async resume() {
      checkOpen();
      while (staging) await staging;
      checkOpen();
      if (resumed) return;
      harness.resume();
      resumed = true;
    },
    async pendingSubmissions() {
      checkOpen();
      if (resumed)
        throw new Error("Recovery inspection requires a paused host");
      const state = await harness.snapshot(State, context);
      const pending: import("./types.js").HostPendingSubmission[] = [];
      for (const status of ["queued", "placed"] as const) {
        let cursor: Cursor | undefined;
        do {
          const page = await runtimeOptions.storage.scanSubmissions(
            { status },
            256,
            cursor,
            context,
          );
          for (const submission of page.items) {
            if (!state?.roles[submission.conversationId]) continue;
            pending.push({
              conversationId: submission.conversationId,
              status,
              ...(submission.requestId === undefined
                ? {}
                : { requestId: submission.requestId }),
            });
          }
          cursor = page.next;
        } while (cursor !== undefined);
      }
      return pending;
    },
    stageAbort(ids) {
      checkOpen();
      if (resumed)
        return Promise.reject(
          new Error("Recovery cancellation requires a paused host"),
        );
      const previous = staging;
      const task = (async () => {
        await previous;
        checkOpen();
        if (resumed)
          throw new Error("Recovery cancellation requires a paused host");
        const state = await harness.snapshot(State, context);
        const selected = [...new Set(ids)].map((id) => {
          const parsed = conversationId(id);
          if (!state?.roles[id])
            throw new Error("Conversation does not belong to this host");
          return parsed;
        });
        for (const id of selected) {
          let cursor: Cursor | undefined;
          do {
            const page = await runtimeOptions.storage.scanTasks(
              { conversationId: id },
              256,
              cursor,
              context,
            );
            for (const task of page.items) {
              if (task.state.status !== "terminal")
                await harness.abortTask(task.id, context);
            }
            cursor = page.next;
          } while (cursor !== undefined);
          do {
            const page = await runtimeOptions.storage.scanSubmissions(
              { conversationId: id, status: "queued" },
              256,
              cursor,
              context,
            );
            for (const submission of page.items)
              await harness.abortSubmission(submission.id, context, id);
            cursor = page.next;
          } while (cursor !== undefined);
        }
      })().finally(() => {
        if (staging === task) staging = undefined;
      });
      staging = task;
      return task;
    },
    async snapshot() {
      checkOpen();
      return (await harness.snapshot(business, context)) as Business;
    },
    async transact(action) {
      checkOpen();
      return harness.commit(
        (tx) =>
          action({
            state: async () => (await tx.doc(business)) as Business,
            create: async (change) => {
              const state = await tx.doc(State);
              const id = (
                await tx.createConversation({
                  ownership: { kind: "ownerless" },
                })
              ).id;
              state.roles[id] = change.roleId;
              await configureRole(tx, id, change);
              return id;
            },
            configure: (id, change) => configureRole(tx, id, change),
          }),
        context,
      );
    },
    async configure(id, change) {
      const target = await conversation(id);
      await target.configure({ instructions: change.instructions }, context);
    },
    run(id, input) {
      checkOpen();
      if (
        !input.requestId ||
        !Number.isFinite(input.timeoutMs) ||
        input.timeoutMs <= 0
      )
        return Promise.reject(new Error("Invalid host run input"));
      const fingerprint = createHash("sha256")
        .update(JSON.stringify([input.content, input.instructions]))
        .digest("hex");
      const active = runs.get(id);
      if (active)
        return active.requestId === input.requestId &&
          active.fingerprint === fingerprint
          ? active.promise
          : Promise.reject(new Error("Conversation is busy"));
      const promise = (async () => {
        const target = await conversation(id);
        await harness.commit(async (tx) => {
          const state = await tx.doc(State);
          const key = `${id}:${input.requestId}`;
          const previous = state.requests[key];
          if (previous && previous !== fingerprint)
            throw new Error("Request ID identifies different input");
          if (!previous) {
            if (input.instructions !== undefined)
              await configure(tx, conversationId(id), {
                instructions: input.instructions,
              });
            state.requests[key] = fingerprint;
          }
        }, context);
        await host.resume();
        const submission = await target.submit(
          {
            type: "input",
            requestId: input.requestId,
            content: input.content,
            whenBusy: "reject",
          },
          context,
        );
        const timer = setTimeout(() => {
          void target.abort(context).catch(() => options.onReport?.());
        }, input.timeoutMs);
        try {
          const result = await submission.wait(context);
          let text = "";
          if (result.status === "done" && result.type === "input") {
            const entry = await harness.commit(
              (tx) => tx.entry(AssistantEntry, result.answer),
              context,
            );
            const message = entry?.model?.[0];
            if (message?.role === "assistant")
              text = message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n")
                .trim();
          }
          return {
            status: result.status,
            ...("detail" in result && typeof result.detail === "string"
              ? { detail: result.detail }
              : {}),
            text,
          };
        } finally {
          clearTimeout(timer);
        }
      })().finally(() => runs.delete(id));
      runs.set(id, { requestId: input.requestId, fingerprint, promise });
      return promise;
    },
    async abort(id) {
      const target = await conversation(id);
      await host.resume();
      await target.abort(context);
    },
    async cleanup(id) {
      await (await environments.get(id))?.cleanup(context);
      environments.delete(id);
    },
    close() {
      closing ??= (async () => {
        closed = true;
        const errors: unknown[] = [];
        try {
          await runtime.close(context);
        } catch (error) {
          errors.push(error);
        }
        await Promise.allSettled([...runs.values()].map((run) => run.promise));
        errors.push(...(await cleanupEnvironments()));
        if (errors.length)
          throw new AggregateError(errors, "Host execution cleanup failed");
      })();
      return closing;
    },
  };
  setHostInternals(host, {
    runtime,
    harness,
    registry,
    tools: options.tools,
    context,
    options: runtimeOptions,
  });
  return host;
}
