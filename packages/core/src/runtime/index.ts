import { createHash } from "node:crypto";
import type { Context, JsonValue } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import { getSupportedThinkingLevels, type Models } from "@earendil-works/pi-ai";
import type {
  AgentChange,
  Conversation,
  ConversationId,
  Cursor,
  DocumentRecord,
  Extension,
  HarnessOptions,
  JsonObject,
  RegistryReader,
  Storage,
  SubmissionRecord,
  ToolRegistration,
  Tx,
} from "@earendil-works/pi-durable";
import { configure, defineDoc, Harness } from "@earendil-works/pi-durable";
import piDurablePackage from "@earendil-works/pi-durable/package.json" with {
  type: "json",
};
import corePackage from "../../package.json" with { type: "json" };
import type {
  DefinitionDefaults,
  DefinitionModel,
  RoleDefinition,
} from "../definitions/types.js";
import type {
  BindingDiagnostic,
  ConversationBinding,
  ProjectBinding,
  RuntimeAuthorizationCall,
  RuntimeCall,
  RuntimeConversationRecord,
  RuntimeDefinition,
  RuntimeScope,
  RuntimeService,
} from "../protocol/index.js";

interface BindingDocument extends JsonObject {
  [key: string]: JsonValue;
  bindingHash: string;
  runtimeId: string;
  projectId: string;
  environmentId: string;
  squadId: string;
  harnessId: string;
  definitionHash: string;
  configHash: string;
}

interface RoleDocument extends JsonObject {
  [key: string]: JsonValue;
  runtimeId: string;
  roleId: string;
  definitionHash: string;
  configHash: string;
  workflowId?: string;
  title: string;
}

const BindingDoc = defineDoc<BindingDocument>({
  kind: "frogie.binding",
  version: 1,
  scope: "session",
  initial: () => ({
    bindingHash: "",
    runtimeId: "",
    projectId: "",
    environmentId: "",
    squadId: "",
    harnessId: "",
    definitionHash: "",
    configHash: "",
  }),
});

const RoleDoc = defineDoc<RoleDocument>({
  kind: "frogie.role",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({
    runtimeId: "",
    roleId: "",
    definitionHash: "",
    configHash: "",
    title: "",
  }),
});

export interface BindingCapabilities {
  readonly models: Models;
  readonly registry: RegistryReader;
  readonly roleDefaults?: Readonly<Record<string, DefinitionDefaults>>;
}

export interface RuntimeOptions {
  readonly runtimeId: string;
  readonly definition: RuntimeDefinition;
  readonly binding: ProjectBinding;
  readonly storage: Storage;
  readonly models: Models;
  readonly registry: RegistryReader;
  readonly roleDefaults?: Readonly<Record<string, DefinitionDefaults>>;
  readonly harness?: Pick<HarnessOptions, "env" | "onReport" | "settings">;
  readonly resume?: boolean;
  readonly authorization: (
    call: RuntimeAuthorizationCall,
    context: Context,
  ) => Promise<boolean>;
}

export interface RuntimeHandle {
  readonly harness: import("@earendil-works/pi-durable").Harness;
  readonly root: Conversation;
  readonly service: RuntimeService;
  close(context: Context): Promise<void>;
}

export type { BindingDiagnostic, RuntimeScope };

class RuntimeFailure extends Error {
  readonly retryable = false;
  readonly code: string;
  readonly scope?: RuntimeScope;
  readonly objectId?: string;
  readonly field?: string;

  constructor(
    code: string,
    message: string,
    options: { scope?: RuntimeScope; objectId?: string; field?: string } = {},
  ) {
    super(message);
    this.name = "RuntimeFailure";
    this.code = code;
    if (options.scope !== undefined) this.scope = options.scope;
    if (options.objectId !== undefined) this.objectId = options.objectId;
    if (options.field !== undefined) this.field = options.field;
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]),
  );
}

const digest = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
const bindingHash = (binding: ProjectBinding): string =>
  digest({
    projectId: binding.projectId,
    scope: binding.scope,
    definitionHash: binding.definition.contentHash,
    environment: binding.environment,
    authorizationScope: binding.authorizationScope,
  });
const configHash = (options: RuntimeOptions): string =>
  digest(
    options.roleDefaults === undefined
      ? (options.binding.environment ?? {})
      : {
          environment: options.binding.environment,
          roles: options.roleDefaults,
        },
  );
const scopeMatches = (actual: RuntimeScope, expected: RuntimeScope): boolean =>
  actual.projectId === expected.projectId &&
  actual.environmentId === expected.environmentId &&
  actual.squadId === expected.squadId &&
  actual.harnessId === expected.harnessId;
const errorDiagnostic = (
  code: string,
  message: string,
  path: string,
): BindingDiagnostic => ({
  code,
  message,
  path,
  severity: "error",
});

function effectiveDefaults(
  definition: RuntimeDefinition,
  role: RoleDefinition,
  environment?: DefinitionDefaults,
): {
  model?: DefinitionModel;
  thinkingLevel: NonNullable<DefinitionDefaults["thinkingLevel"]>;
} {
  const model = environment?.model ?? role.model ?? definition.defaults?.model;
  return {
    ...(model === undefined ? {} : { model }),
    thinkingLevel:
      environment?.thinkingLevel ??
      role.thinkingLevel ??
      definition.defaults?.thinkingLevel ??
      "medium",
  };
}

function roleResources(
  role: RoleDefinition,
  capabilities: BindingCapabilities,
  workflowTools?: readonly string[],
): { extensions: Extension[]; tools: ToolRegistration[]; missing: string[] } {
  const snapshot = capabilities.registry.snapshot();
  const missing: string[] = [];
  const extensions = role.extensions
    .map((name) => {
      const extension = snapshot.extension(name);
      if (!extension) missing.push(`extension:${name}`);
      return extension;
    })
    .filter((extension): extension is Extension => extension !== undefined);
  const selectedExtensions = new Set(extensions.map(({ name }) => name));
  const availableTools = snapshot
    .tools()
    .filter(({ extension }) => selectedExtensions.has(extension.name));
  const requested =
    workflowTools === undefined
      ? role.tools
      : role.tools.filter((name) => workflowTools.includes(name));
  const tools = requested.flatMap((name) => {
    const matches = availableTools.filter(({ tool }) => tool.name === name);
    if (matches.length !== 1) {
      missing.push(`tool:${name}`);
      return [];
    }
    const match = matches[0];
    return match ? [match.tool as ToolRegistration] : [];
  });
  return { extensions, tools, missing };
}

function workflowInstructions(
  definition: RuntimeDefinition,
  workflowId: string,
): string[] {
  const workflow = definition.workflows.find(({ id }) => id === workflowId);
  if (!workflow) return [];
  const nodes = workflow.nodes.map((node) => {
    const role = definition.roles.find(({ id }) => id === node.role);
    const step = workflow.content
      .match(
        new RegExp(`###\\s+${node.id}\\s*\\n([\\s\\S]*?)(?=\\n###\\s|$)`),
      )?.[1]
      ?.trim();
    return `- ${node.id} (${node.title}, role: ${node.role}${role ? ` / ${role.title}` : ""})${step ? `: ${step}` : ""}`;
  });
  const edges = workflow.edges.map(
    ({ source, target, label }) =>
      `- ${source} → ${target}${label ? `: ${label}` : ""}`,
  );
  return [
    `## Workflow: ${workflow.title}`,
    `Goal: ${
      workflow.content
        .split("## 输入")[0]
        ?.replace(/^## 目标\\s*/u, "")
        .trim() ?? ""
    }`,
    `Entry: ${workflow.entry} (role: ${workflow.entryRole})`,
    "### Steps",
    ...nodes,
    "### Handoffs",
    ...edges,
    workflow.content,
  ];
}

function instructions(
  definition: RuntimeDefinition,
  role: RoleDefinition,
  workflowId?: string,
): string {
  const skills = role.skills.flatMap((id) => {
    const skill = definition.skills.find((item) => item.id === id);
    return skill ? [`## Skill: ${skill.id}\n${skill.content}`] : [];
  });
  return [
    definition.content,
    role.content,
    ...skills,
    ...(workflowId ? workflowInstructions(definition, workflowId) : []),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function workflowTools(
  definition: RuntimeDefinition,
  workflowId?: string,
): readonly string[] | undefined {
  if (workflowId === undefined) return undefined;
  return definition.workflows.find(({ id }) => id === workflowId)?.tools;
}

function conversationBinding(
  options: RuntimeOptions,
  role: RoleDefinition,
  conversationId: ConversationId,
  workflowId?: string,
): ConversationBinding {
  const selected = roleResources(
    role,
    options,
    workflowTools(options.definition, workflowId),
  );
  return {
    conversationId,
    roleId: role.id,
    definitionHash: options.definition.contentHash,
    configHash: digest({
      defaults: effectiveDefaults(
        options.definition,
        role,
        options.roleDefaults?.[role.id] ?? options.binding.environment,
      ),
      extensions: selected.extensions.map(({ name }) => name),
      tools: selected.tools.map(({ name }) => name),
      skills: role.skills,
      workflowId,
    }),
    ...(workflowId === undefined ? {} : { workflowId }),
    title: role.title,
  };
}

function roleAgentChange(
  options: RuntimeOptions,
  role: RoleDefinition,
  workflowId?: string,
): AgentChange {
  const defaults = effectiveDefaults(
    options.definition,
    role,
    options.roleDefaults?.[role.id] ?? options.binding.environment,
  );
  const selected = roleResources(
    role,
    options,
    workflowTools(options.definition, workflowId),
  );
  return {
    ...(defaults.model === undefined ? {} : { model: defaults.model }),
    thinkingLevel: defaults.thinkingLevel,
    extensions: selected.extensions,
    tools: selected.tools,
    instructions: instructions(options.definition, role, workflowId),
  };
}

function recordRole(
  tx: Tx,
  options: RuntimeOptions,
  conversationId: ConversationId,
  role: RoleDefinition,
  workflowId?: string,
): Promise<void> {
  const value = conversationBinding(options, role, conversationId, workflowId);
  return tx.doc(RoleDoc, conversationId).then((doc) => {
    doc.runtimeId = options.runtimeId;
    doc.roleId = value.roleId;
    doc.definitionHash = value.definitionHash;
    doc.configHash = value.configHash;
    doc.title = value.title;
    if (workflowId === undefined) delete doc.workflowId;
    else doc.workflowId = workflowId;
  });
}

export async function configureRuntimeRole(
  tx: Tx,
  options: RuntimeOptions,
  conversationId: ConversationId,
  roleId: string,
  change: DefinitionDefaults & { instructions?: string } = {},
): Promise<void> {
  const source = options.definition.roles.find((role) => role.id === roleId);
  if (!source) throw new RuntimeFailure("not_found", "Role was not found");
  const configured: RuntimeOptions = {
    ...options,
    roleDefaults: {
      ...options.roleDefaults,
      [roleId]: {
        ...effectiveDefaults(
          options.definition,
          source,
          options.roleDefaults?.[roleId] ?? options.binding.environment,
        ),
        ...(change.model === undefined ? {} : { model: change.model }),
        ...(change.thinkingLevel === undefined
          ? {}
          : { thinkingLevel: change.thinkingLevel }),
      },
    },
  };
  const issue = checkBinding(
    { ...options.definition, roles: [source] },
    options.binding,
    configured,
  ).find((item) => item.severity === "error");
  if (issue) throw new RuntimeFailure(issue.code, issue.message);
  await configure(tx, conversationId, {
    ...roleAgentChange(configured, source),
    ...(change.instructions === undefined
      ? {}
      : { instructions: change.instructions }),
  });
  await recordRole(tx, configured, conversationId, source);
}

export function checkBinding(
  definition: RuntimeDefinition,
  binding: ProjectBinding,
  capabilities: BindingCapabilities,
): readonly BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];
  if (
    binding.projectId !== definition.projectId ||
    binding.scope.projectId !== binding.projectId
  ) {
    diagnostics.push(
      errorDiagnostic(
        "binding_mismatch",
        "Project binding does not match the definition",
        "projectId",
      ),
    );
  }
  if (binding.scope.squadId !== definition.squadId) {
    diagnostics.push(
      errorDiagnostic(
        "binding_mismatch",
        "Runtime scope does not match the definition",
        "scope.squadId",
      ),
    );
  }
  if (binding.definition.contentHash !== definition.contentHash) {
    diagnostics.push(
      errorDiagnostic(
        "binding_mismatch",
        "Definition hash does not match the binding",
        "definition.contentHash",
      ),
    );
  }
  for (const role of definition.roles) {
    const defaults = effectiveDefaults(
      definition,
      role,
      capabilities.roleDefaults?.[role.id] ?? binding.environment,
    );
    const path = `roles.${role.id}`;
    if (!defaults.model) {
      diagnostics.push(
        errorDiagnostic(
          "capability_missing",
          "A model must be bound",
          `${path}.model`,
        ),
      );
    } else {
      const model = capabilities.models.getModel(
        defaults.model.provider,
        defaults.model.modelId,
      );
      if (!model) {
        diagnostics.push(
          errorDiagnostic(
            "capability_missing",
            `Model ${defaults.model.provider}/${defaults.model.modelId} is unavailable`,
            `${path}.model`,
          ),
        );
      } else if (
        !getSupportedThinkingLevels(model).includes(defaults.thinkingLevel)
      ) {
        diagnostics.push(
          errorDiagnostic(
            "capability_missing",
            `Thinking level ${defaults.thinkingLevel} is unsupported`,
            `${path}.thinkingLevel`,
          ),
        );
      }
    }
    const resources = roleResources(role, capabilities);
    for (const missing of resources.missing) {
      diagnostics.push(
        errorDiagnostic(
          "capability_missing",
          `Declared ${missing} is unavailable`,
          path,
        ),
      );
    }
  }
  return diagnostics;
}

function assertStoredBinding(
  value: Partial<BindingDocument> | undefined,
  options: RuntimeOptions,
): void {
  if (
    !value ||
    value.bindingHash !== bindingHash(options.binding) ||
    value.runtimeId !== options.runtimeId ||
    value.projectId !== options.binding.projectId ||
    value.environmentId !== options.binding.scope.environmentId ||
    value.squadId !== options.binding.scope.squadId ||
    value.harnessId !== options.binding.scope.harnessId ||
    value.definitionHash !== options.definition.contentHash ||
    value.configHash !== configHash(options)
  ) {
    throw new RuntimeFailure(
      "binding_mismatch",
      "Stored runtime binding does not match the requested binding",
      {
        scope: options.binding.scope,
      },
    );
  }
}

async function closeStorage(
  storage: Storage,
  context: Context,
  error: unknown,
): Promise<never> {
  try {
    await storage.close(withoutAbortSignal(context));
  } catch (closeError) {
    throw new AggregateError(
      [error, closeError],
      "Runtime startup and storage cleanup both failed",
      { cause: error },
    );
  }
  throw error;
}

export async function openRuntime(
  options: RuntimeOptions,
  context: Context,
): Promise<RuntimeHandle> {
  const diagnostics = checkBinding(
    options.definition,
    options.binding,
    options,
  );
  const blocking = diagnostics.find(({ severity }) => severity === "error");
  if (blocking) {
    return closeStorage(
      options.storage,
      context,
      new RuntimeFailure(blocking.code, blocking.message, {
        scope: options.binding.scope,
        ...(blocking.field === undefined ? {} : { field: blocking.field }),
      }),
    );
  }

  let record: DocumentRecord | undefined;
  try {
    record = await options.storage.findDocument(
      { kind: BindingDoc.definition.kind, scope: { kind: "session" } },
      "current",
      context,
    );
    if (record) {
      const stored = await options.storage.document(
        record.id,
        "current",
        context,
      );
      assertStoredBinding(
        stored?.value as Partial<BindingDocument> | undefined,
        options,
      );
    }
  } catch (error) {
    return closeStorage(options.storage, context, error);
  }

  const harnessOptions: HarnessOptions = {
    ...options.harness,
    models: options.models,
    registry: options.registry,
  };
  let harness: import("@earendil-works/pi-durable").Harness;
  try {
    harness = await Harness.open(options.storage, harnessOptions, context);
  } catch (error) {
    return closeStorage(options.storage, context, error);
  }

  let closePromise: Promise<void> | undefined;
  const close = (closeContext: Context): Promise<void> => {
    closePromise ??= harness.close(withoutAbortSignal(closeContext));
    return closePromise;
  };

  try {
    await harness.commit(async (tx) => {
      const stored = await tx.doc(BindingDoc);
      if (stored.bindingHash) assertStoredBinding(stored, options);
      stored.bindingHash = bindingHash(options.binding);
      stored.runtimeId = options.runtimeId;
      stored.projectId = options.binding.projectId;
      stored.environmentId = options.binding.scope.environmentId;
      stored.squadId = options.binding.scope.squadId;
      stored.harnessId = options.binding.scope.harnessId;
      stored.definitionHash = options.definition.contentHash;
      stored.configHash = configHash(options);
    }, context);

    const rootRole = options.definition.roles.find(
      ({ id }) => id === options.definition.rootRoleId,
    );
    if (!rootRole)
      throw new RuntimeFailure("invalid_definition", "Root role is missing");
    const root = await harness.root(context, {
      agent: roleAgentChange(options, rootRole),
      init: (tx, id) => recordRole(tx, options, id, rootRole),
    });

    const ownedConversation = async (
      id: ConversationId,
      callContext: Context,
    ): Promise<Conversation> => {
      if (!Number.isSafeInteger(id)) {
        throw new RuntimeFailure(
          "not_found",
          "Conversation was not found in this runtime",
          { scope: options.binding.scope, objectId: String(id) },
        );
      }
      const conversation = await harness.conversation(id, callContext);
      if (!conversation) {
        throw new RuntimeFailure("not_found", "Conversation was not found", {
          scope: options.binding.scope,
          objectId: String(id),
        });
      }
      const role = await harness.snapshot(RoleDoc, id, callContext);
      if (
        !role ||
        role.runtimeId !== options.runtimeId ||
        role.definitionHash !== options.definition.contentHash
      ) {
        throw new RuntimeFailure(
          "not_found",
          "Conversation was not found in this runtime",
          {
            scope: options.binding.scope,
            objectId: String(id),
          },
        );
      }
      return conversation;
    };

    const authorize = async <TInput>(
      operation: RuntimeAuthorizationCall["operation"],
      call: RuntimeCall<TInput>,
      callContext: Context,
    ): Promise<void> => {
      if (!scopeMatches(call.scope, options.binding.scope)) {
        throw new RuntimeFailure(
          "binding_mismatch",
          "Runtime scope does not match",
          { scope: options.binding.scope },
        );
      }
      if (
        !(await options.authorization(
          { ...call, operation } as RuntimeAuthorizationCall,
          callContext,
        ))
      ) {
        throw new RuntimeFailure("forbidden", "Caller is not authorized", {
          scope: options.binding.scope,
        });
      }
    };

    const service: RuntimeService = {
      createConversation: async (call, callContext) => {
        await authorize("createConversation", call, callContext);
        const workflow = call.input.workflowId
          ? options.definition.workflows.find(
              ({ id }) => id === call.input.workflowId,
            )
          : undefined;
        if (call.input.workflowId && !workflow) {
          throw new RuntimeFailure(
            "not_found",
            `Workflow ${call.input.workflowId} was not found`,
            { scope: options.binding.scope },
          );
        }
        const roleId = workflow?.entryRole ?? call.input.roleId;
        if (workflow && call.input.roleId !== workflow.entryRole) {
          throw new RuntimeFailure(
            "invalid_request",
            "Workflow entry role must match the requested role",
            { scope: options.binding.scope },
          );
        }
        const role = options.definition.roles.find(({ id }) => id === roleId);
        if (!role)
          throw new RuntimeFailure(
            "not_found",
            `Role ${roleId} was not found`,
            { scope: options.binding.scope },
          );
        const conversation = await harness.createConversation(
          {
            ownership: { kind: "ownerless" },
            agent: roleAgentChange(options, role, workflow?.id),
            init: (tx, id) => recordRole(tx, options, id, role, workflow?.id),
          },
          callContext,
        );
        return {
          conversationId: conversation.id,
          binding: conversationBinding(
            options,
            role,
            conversation.id,
            workflow?.id,
          ),
        };
      },
      submit: async (call, callContext) => {
        await authorize("submit", call, callContext);
        const conversation = await ownedConversation(
          call.input.conversationId,
          callContext,
        );
        return (await conversation.submit(call.input.submission, callContext))
          .id;
      },
      getSubmission: async (call, callContext) => {
        await authorize("getSubmission", call, callContext);
        const submission = await harness.submission(
          call.input.submissionId,
          callContext,
        );
        if (!submission) return undefined;
        const result: SubmissionRecord = await submission.status(callContext);
        await ownedConversation(result.conversationId, callContext);
        return result;
      },
      describe: async (call, callContext) => {
        await authorize("describe", call, callContext);
        const models = [
          ...new Map(
            options.definition.roles
              .map(
                (role) =>
                  effectiveDefaults(
                    options.definition,
                    role,
                    options.roleDefaults?.[role.id] ??
                      options.binding.environment,
                  ).model,
              )
              .filter((model): model is DefinitionModel => model !== undefined)
              .map(
                (model) =>
                  [`${model.provider}/${model.modelId}`, model] as const,
              ),
          ).values(),
        ];
        const extensions = [
          ...new Set(
            options.definition.roles.flatMap((role) => role.extensions),
          ),
        ];
        const tools = [
          ...new Set(options.definition.roles.flatMap((role) => role.tools)),
        ];
        const operations = [
          "describe",
          "listConversations",
          "observeConversation",
          "createConversation",
          "submit",
          "getSubmission",
          "cancel",
          "compact",
        ];
        return {
          protocolVersion: 1,
          runtimeId: options.runtimeId,
          scope: options.binding.scope,
          bindingHash: bindingHash(options.binding),
          piVersion: piDurablePackage.version,
          hostVersion: corePackage.version,
          models,
          tools,
          extensions,
          operations,
        };
      },
      listConversations: async (call, callContext) => {
        await authorize("listConversations", call, callContext);
        const result: RuntimeConversationRecord[] = [];
        let cursor: Cursor | undefined;
        do {
          const page = await options.storage.scanConversations(
            {},
            256,
            cursor,
            callContext,
          );
          for (const conversation of page.items) {
            const role = await harness.snapshot(
              RoleDoc,
              conversation.id,
              callContext,
            );
            if (
              !role ||
              role.runtimeId !== options.runtimeId ||
              role.definitionHash !== options.definition.contentHash
            )
              continue;
            result.push({
              conversation,
              binding: {
                conversationId: conversation.id,
                roleId: role.roleId,
                definitionHash: role.definitionHash,
                configHash: role.configHash,
                ...(role.workflowId === undefined
                  ? {}
                  : { workflowId: role.workflowId }),
                title: role.title,
              },
            });
          }
          cursor = page.next;
        } while (cursor !== undefined);
        return result;
      },
      observeConversation: async (call, callContext) => {
        await authorize("observeConversation", call, callContext);
        const conversation = await ownedConversation(
          call.input.conversationId,
          callContext,
        );
        return conversation.watch(callContext);
      },
      cancel: async (call, callContext) => {
        await authorize("cancel", call, callContext);
        const conversation = await ownedConversation(
          call.input.conversationId,
          callContext,
        );
        if (call.input.submissionId === undefined) {
          await conversation.abort(callContext);
          return;
        }
        return harness.abortSubmission(
          call.input.submissionId,
          callContext,
          call.input.conversationId,
        );
      },
      compact: async (call, callContext) => {
        await authorize("compact", call, callContext);
        const conversation = await ownedConversation(
          call.input.conversationId,
          callContext,
        );
        return conversation.compact(call.input.instructions, callContext);
      },
    };

    if (options.resume !== false) harness.resume();
    return { harness, root, service, close };
  } catch (error) {
    try {
      await close(context);
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "Runtime startup and cleanup both failed",
        { cause: error },
      );
    }
    throw error;
  }
}
