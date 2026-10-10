import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  Type,
} from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  CompactionEntry,
  createRegistry,
  defineExtension,
  defineTool,
  MemoryStorage,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { describe, expect, it, vi } from "vitest";
import { loadDefinition } from "../definitions/index.js";
import type { ProjectBinding } from "../protocol/index.js";
import {
  checkBinding,
  configureRuntimeRole,
  openRuntime,
  type RuntimeOptions,
} from "./index.js";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
      timeout.unref();
    }),
  ]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

function setup() {
  const definition = loadDefinition(
    new URL("../../../../tests/fixtures/minimal-squad", import.meta.url)
      .pathname,
  );
  const faux = fauxProvider({
    provider: "fixture",
    models: [{ id: "test", reasoning: true }],
    tokensPerSecond: 1_000_000,
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const binding: ProjectBinding = {
    projectId: definition.projectId,
    scope: {
      projectId: definition.projectId,
      environmentId: "test",
      squadId: definition.squadId,
      harnessId: "test-harness",
    },
    definition: { contentHash: definition.contentHash },
    environment: {
      model: { provider: "fixture", modelId: "test" },
      thinkingLevel: "low",
    },
  };
  const options: RuntimeOptions = {
    runtimeId: "test-runtime",
    definition,
    binding,
    models,
    registry,
    storage: new MemoryStorage(),
    authorization: async () => true,
  };
  return {
    definition,
    binding,
    models,
    registry,
    options,
    faux,
    caller: { id: "test-user" },
  };
}

describe("checkBinding", () => {
  it("accepts a definition whose models and explicit capabilities are available", () => {
    const test = setup();
    expect(checkBinding(test.definition, test.binding, test)).toEqual([]);
  });

  it.each(["project", "project-scope", "scope", "hash", "model"] as const)(
    "diagnoses a mismatched %s without changing the binding",
    (field) => {
      const test = setup();
      const binding = structuredClone(test.binding);
      const candidate = {
        ...binding,
        ...(field === "project" ? { projectId: "other" } : {}),
        ...(field === "project-scope"
          ? { scope: { ...binding.scope, projectId: "other" } }
          : {}),
        ...(field === "scope"
          ? { scope: { ...binding.scope, squadId: "other" } }
          : {}),
        ...(field === "hash" ? { definition: { contentHash: "other" } } : {}),
        ...(field === "model"
          ? {
              environment: {
                model: { provider: "fixture", modelId: "missing" },
              },
            }
          : {}),
      };
      const before = structuredClone(candidate);
      expect(checkBinding(test.definition, candidate, test)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: expect.any(String),
          }),
        ]),
      );
      expect(candidate).toEqual(before);
    },
  );

  it("reports tools missing from the selected extensions and duplicate registrations", () => {
    const test = setup();
    const tool = defineTool({
      name: "lookup",
      description: "Look up a record",
      parameters: Type.Object({}),
      execute: async () => ({}),
    });
    test.registry.install(defineExtension({ name: "first", tools: [tool] }));
    test.registry.install(defineExtension({ name: "second", tools: [tool] }));
    const definition = {
      ...test.definition,
      roles: test.definition.roles.map((role) =>
        role.id === "reviewer"
          ? { ...role, extensions: ["first", "second"], tools: ["lookup"] }
          : role,
      ),
    };
    expect(checkBinding(definition, test.binding, test)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "capability_missing",
          message: expect.stringContaining("tool:lookup"),
        }),
      ]),
    );
  });

  it("accepts a role that declares no tools or extensions", () => {
    const test = setup();
    const definition = {
      ...test.definition,
      roles: test.definition.roles.map((role) => ({
        ...role,
        tools: [],
        extensions: [],
      })),
    };
    expect(checkBinding(definition, test.binding, test)).toEqual([]);
  });

  it("rejects an extension missing from the host registry", () => {
    const test = setup();
    const definition = {
      ...test.definition,
      roles: test.definition.roles.map((role) => ({
        ...role,
        extensions: ["uninstalled"],
      })),
    };
    expect(checkBinding(definition, test.binding, test)).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error" })]),
    );
  });

  it("accepts a single requested tool and leaves unrelated registered tools alone", () => {
    const test = setup();
    const tool = defineTool({
      name: "lookup",
      description: "Look up a record",
      parameters: Type.Object({}),
      execute: async () => ({}),
    });
    const unused = defineTool({
      name: "unused",
      description: "Not requested",
      parameters: Type.Object({}),
      execute: async () => ({}),
    });
    test.registry.install(
      defineExtension({ name: "business", tools: [tool, unused] }),
    );
    const definition = {
      ...test.definition,
      roles: test.definition.roles.map((role) =>
        role.id === "reviewer"
          ? { ...role, extensions: ["business"], tools: ["lookup"] }
          : role,
      ),
    };
    expect(checkBinding(definition, test.binding, test)).toEqual([]);
  });

  it("reports a missing tool when its extension exists but does not register it", () => {
    const test = setup();
    test.registry.install(defineExtension({ name: "business", tools: [] }));
    const definition = {
      ...test.definition,
      roles: test.definition.roles.map((role) =>
        role.id === "reviewer"
          ? { ...role, extensions: ["business"], tools: ["lookup"] }
          : role,
      ),
    };
    expect(checkBinding(definition, test.binding, test)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "capability_missing",
          message: expect.stringContaining("tool:lookup"),
        }),
      ]),
    );
  });

  it("reports missing declared extensions and tools separately", () => {
    const test = setup();
    const definition = {
      ...test.definition,
      roles: test.definition.roles.map((role) =>
        role.id === "reviewer"
          ? { ...role, extensions: ["business"], tools: ["lookup"] }
          : role,
      ),
    };
    expect(checkBinding(definition, test.binding, test)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "capability_missing",
          message: expect.stringContaining("extension:business"),
        }),
        expect.objectContaining({
          code: "capability_missing",
          message: expect.stringContaining("tool:lookup"),
        }),
      ]),
    );
  });

  it("requires a resolved model and a supported thinking level", () => {
    const test = setup();
    const { environment: _, ...missingModel } = test.binding;
    expect(checkBinding(test.definition, missingModel, test)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "capability_missing" }),
      ]),
    );
    const plain = fauxProvider({
      provider: "plain",
      models: [{ id: "plain", reasoning: false }],
    });
    test.models.setProvider(plain.provider);
    expect(
      checkBinding(
        test.definition,
        {
          ...test.binding,
          environment: {
            model: { provider: "plain", modelId: "plain" },
            thinkingLevel: "high",
          },
        },
        test,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "capability_missing" }),
      ]),
    );
  });
});

describe("openRuntime", () => {
  it("applies per-role model defaults and validates explicit reconfiguration atomically", async () => {
    const test = setup();
    const options: RuntimeOptions = {
      ...test.options,
      roleDefaults: {
        reviewer: {
          model: { provider: "fixture", modelId: "test" },
          thinkingLevel: "high",
        },
      },
    };
    const runtime = await openRuntime(options, context);
    try {
      const created = await runtime.service.createConversation(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: { roleId: "reviewer" },
        },
        context,
      );
      const conversation = await runtime.harness.conversation(
        created.conversationId,
        context,
      );
      expect((await conversation?.agent(context))?.thinkingLevel).toBe("high");
      const configureRole = (
        roleId: string,
        change: Parameters<typeof configureRuntimeRole>[4] = {},
      ) =>
        runtime.harness.commit(
          (tx) =>
            configureRuntimeRole(
              tx,
              options,
              created.conversationId,
              roleId,
              change,
            ),
          context,
        );
      await configureRole("reviewer");
      await expect(configureRole("missing")).rejects.toThrow(
        "Role was not found",
      );
      await expect(
        configureRole("reviewer", {
          model: { provider: "fixture", modelId: "missing" },
        }),
      ).rejects.toThrow("unavailable");
      expect((await conversation?.agent(context))?.thinkingLevel).toBe("high");
      await configureRole("reviewer", {
        model: { provider: "fixture", modelId: "test" },
        thinkingLevel: "medium",
        instructions: "Apply the updated criteria.",
      });
      expect(await conversation?.agent(context)).toMatchObject({
        thinkingLevel: "medium",
        instructions: "Apply the updated criteria.",
      });
      expect((await runtime.root.agent(context)).thinkingLevel).toBe("low");
    } finally {
      await runtime.close(context);
    }
  });
  it("creates role-scoped conversations and answers a durably admitted input with real Pi", async () => {
    const test = setup();
    test.faux.setResponses([fauxAssistantMessage("Evidence reviewed.")]);
    const runtime = await openRuntime(test.options, context);
    try {
      const agent = await runtime.root.agent(context);
      expect(agent.model).toEqual(test.binding.environment?.model);
      expect(agent.thinkingLevel).toBe("low");
      expect(agent.tools).toEqual([]);
      expect(agent.extensions).toEqual([]);
      expect(agent.instructions).toContain("Shared mission context.");
      expect(agent.instructions).toContain("Coordinate the work");
      const call = {
        scope: test.binding.scope,
        caller: test.caller,
        input: { roleId: "reviewer" },
      };
      const first = await runtime.service.createConversation(call, context);
      const second = await runtime.service.createConversation(call, context);
      expect(first.conversationId).not.toBe(second.conversationId);
      expect(first.binding.roleId).toBe("reviewer");
      expect(first.binding.definitionHash).toBe(test.definition.contentHash);
      const conversation = await runtime.harness.conversation(
        first.conversationId,
        context,
      );
      expect((await conversation?.agent(context))?.instructions).toContain(
        "Review the supplied material",
      );
      const input = {
        scope: test.binding.scope,
        caller: test.caller,
        input: {
          conversationId: first.conversationId,
          submission: {
            type: "input" as const,
            content: "Review the evidence",
            requestId: "review-once",
          },
        },
      };
      const id = await runtime.service.submit(input, context);
      expect(await runtime.service.submit(input, context)).toBe(id);
      const submission = await runtime.harness.submission(id, context);
      const result = await submission?.wait(context);
      expect(result?.status).toBe("done");
      expect(
        await runtime.service.getSubmission(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: { submissionId: id },
          },
          context,
        ),
      ).toMatchObject({ id, status: "done" });
      if (result?.status !== "done" || result.type !== "input")
        throw new Error("Missing durable answer");
      const answer = await runtime.harness.commit(
        (tx) => tx.entry(AssistantEntry, result.answer),
        context,
      );
      expect(JSON.stringify(answer?.model)).toContain("Evidence reviewed.");
      expect(test.faux.state.callCount).toBe(1);
    } finally {
      await runtime.close(context);
      await runtime.close(context);
    }
  });

  it("selects only tools from declared extensions and applies workflow tool limits", async () => {
    const test = setup();
    const lookup = defineTool({
      name: "lookup",
      description: "Look up a record",
      parameters: Type.Object({}),
      execute: async () => ({}),
    });
    const extra = defineTool({
      name: "extra",
      description: "An unrequested tool",
      parameters: Type.Object({}),
      execute: async () => ({}),
    });
    const extension = defineExtension({
      name: "business",
      tools: [lookup, extra],
    });
    test.registry.install(extension);
    const definition = {
      ...test.definition,
      roles: test.definition.roles.map((role) =>
        role.id === "reviewer"
          ? {
              ...role,
              extensions: ["business"],
              tools: ["lookup", "extra"],
              skills: ["missing-skill"],
            }
          : role,
      ),
      workflows: test.definition.workflows.flatMap((workflow) => [
        { ...workflow, tools: ["lookup"] },
        { ...workflow, id: "review-empty", tools: [] },
        { ...workflow, id: "review-unrestricted" },
      ]),
    };
    const runtime = await openRuntime({ ...test.options, definition }, context);
    try {
      const direct = await runtime.service.createConversation(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: { roleId: "reviewer" },
        },
        context,
      );
      const workflow = await runtime.service.createConversation(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: { roleId: "reviewer", workflowId: "review" },
        },
        context,
      );
      const directAgent = await (
        await runtime.harness.conversation(direct.conversationId, context)
      )?.agent(context);
      const workflowAgent = await (
        await runtime.harness.conversation(workflow.conversationId, context)
      )?.agent(context);
      expect(directAgent?.extensions.map(({ name }) => name)).toEqual([
        "business",
      ]);
      expect(directAgent?.tools.map(({ name }) => name)).toEqual([
        "lookup",
        "extra",
      ]);
      expect(workflowAgent?.tools.map(({ name }) => name)).toEqual(["lookup"]);
      for (const [workflowId, expectedTools] of [
        ["review-empty", []],
        ["review-unrestricted", ["lookup", "extra"]],
      ] as const) {
        const conversation = await runtime.service.createConversation(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: { roleId: "reviewer", workflowId },
          },
          context,
        );
        const agent = await (
          await runtime.harness.conversation(
            conversation.conversationId,
            context,
          )
        )?.agent(context);
        expect(
          agent?.tools.map(({ name }) => name),
          workflowId,
        ).toEqual(expectedTools);
      }
    } finally {
      await runtime.close(context);
    }
  });

  it("describes the runtime only for an authorized matching scope", async () => {
    const test = setup();
    const authorizedOperations: string[] = [];
    const runtime = await openRuntime(
      {
        ...test.options,
        authorization: async ({ operation }) => {
          authorizedOperations.push(operation);
          return true;
        },
      },
      context,
    );
    const call = {
      scope: test.binding.scope,
      caller: test.caller,
      input: {},
    };
    try {
      const description = await runtime.service.describe(call, context);
      expect(description).toMatchObject({
        protocolVersion: 1,
        runtimeId: "test-runtime",
        scope: test.binding.scope,
        bindingHash: expect.any(String),
        piVersion: expect.any(String),
        hostVersion: expect.any(String),
        models: expect.arrayContaining([
          { provider: "fixture", modelId: "test" },
        ]),
        operations: expect.arrayContaining([
          "describe",
          "listConversations",
          "observeConversation",
        ]),
      });
      expect(authorizedOperations).toContain("describe");
      await expect(
        runtime.service.describe(
          { ...call, scope: { ...call.scope, harnessId: "other" } },
          context,
        ),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
    } finally {
      await runtime.close(context);
    }
  });

  it("lists only conversations registered to this runtime with their role bindings", async () => {
    const test = setup();
    const runtime = await openRuntime(test.options, context);
    try {
      const created = await runtime.service.createConversation(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: { roleId: "reviewer" },
        },
        context,
      );
      const workflow = await runtime.service.createConversation(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: { roleId: "reviewer", workflowId: "review" },
        },
        context,
      );
      const unregistered = await runtime.harness.createConversation(
        { ownership: { kind: "ownerless" } },
        context,
      );
      const conversations = await runtime.service.listConversations(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: {},
        },
        context,
      );
      expect(conversations).toHaveLength(3);
      expect(
        conversations.some(
          ({ conversation }) => conversation.id === unregistered.id,
        ),
      ).toBe(false);
      await expect(
        runtime.service.observeConversation(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: { conversationId: unregistered.id },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        runtime.service.submit(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: {
              conversationId: unregistered.id,
              submission: { type: "input", content: "Not runtime-owned" },
            },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(conversations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            conversation: expect.objectContaining({ id: runtime.root.id }),
            binding: expect.objectContaining({ roleId: "command" }),
          }),
          expect.objectContaining({
            conversation: expect.objectContaining({
              id: created.conversationId,
            }),
            binding: expect.objectContaining({
              roleId: "reviewer",
              definitionHash: test.definition.contentHash,
            }),
          }),
          expect.objectContaining({
            conversation: expect.objectContaining({
              id: workflow.conversationId,
            }),
            binding: expect.objectContaining({
              roleId: "reviewer",
              workflowId: "review",
            }),
          }),
        ]),
      );
    } finally {
      await runtime.close(context);
    }
  });

  it("watches a Pi conversation snapshot and committed updates", async () => {
    const test = setup();
    test.faux.setResponses([fauxAssistantMessage("Observed answer.")]);
    const runtime = await openRuntime(test.options, context);
    let stop: (() => Promise<unknown>) | undefined;
    try {
      const created = await runtime.service.createConversation(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: { roleId: "reviewer" },
        },
        context,
      );
      const watch = await runtime.service.observeConversation(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: { conversationId: created.conversationId },
        },
        context,
      );
      stop = () => watch.stop();
      expect(watch.value.conversation.id).toBe(created.conversationId);
      const initialEntryCount = watch.value.entries.length;

      let resolveUpdate!: (value: typeof watch.value) => void;
      const update = new Promise<typeof watch.value>((resolve) => {
        resolveUpdate = resolve;
      });
      watch.start(async (value) => {
        if (value.entries.length > initialEntryCount) resolveUpdate(value);
      });

      const submissionId = await runtime.service.submit(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: {
            conversationId: created.conversationId,
            submission: { type: "input", content: "Observe this" },
          },
        },
        context,
      );
      await (await runtime.harness.submission(submissionId, context))?.wait(
        context,
      );
      const latest = await withTimeout(update, 2_000);
      expect(latest.entries.length).toBeGreaterThan(initialEntryCount);
      expect(latest.conversation.id).toBe(created.conversationId);
      expect((await watch.stop()).reason).toBe("stopped");
      stop = undefined;
    } finally {
      await stop?.();
      await runtime.close(context);
    }
  });

  it("rejects describe, list and observe before querying Pi when unauthorized", async () => {
    const test = setup();
    const runtime = await openRuntime(
      { ...test.options, authorization: async () => false },
      context,
    );
    const call = {
      scope: test.binding.scope,
      caller: test.caller,
      input: {},
    };
    try {
      await expect(
        runtime.service.describe(call, context),
      ).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(
        runtime.service.listConversations(call, context),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        runtime.service.observeConversation(
          {
            ...call,
            input: { conversationId: runtime.root.id },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      await runtime.close(context);
    }
  });

  it("cancels a conversation in the authorized runtime scope", async () => {
    const test = setup();
    const runtime = await openRuntime(test.options, context);
    try {
      const result = await runtime.service.cancel(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: { conversationId: runtime.root.id },
        },
        context,
      );
      expect(result).toBeUndefined();
    } finally {
      await runtime.close(context);
    }
  });

  it("cancels only a queued submission owned by the supplied conversation", async () => {
    const test = setup();
    let releaseResponse:
      | ((message: ReturnType<typeof fauxAssistantMessage>) => void)
      | undefined;
    let markResponseStarted!: () => void;
    const responseStarted = new Promise<void>((resolve) => {
      markResponseStarted = resolve;
    });
    test.faux.setResponses([
      () =>
        new Promise((resolve) => {
          releaseResponse = resolve;
          markResponseStarted();
        }),
    ]);
    const runtime = await openRuntime(test.options, context);
    const first = await runtime.service.createConversation(
      {
        scope: test.binding.scope,
        caller: test.caller,
        input: { roleId: "reviewer" },
      },
      context,
    );
    const second = await runtime.service.createConversation(
      {
        scope: test.binding.scope,
        caller: test.caller,
        input: { roleId: "reviewer" },
      },
      context,
    );
    try {
      const activeId = await runtime.service.submit(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: {
            conversationId: first.conversationId,
            submission: { type: "input", content: "Keep this run active" },
          },
        },
        context,
      );
      await withTimeout(responseStarted, 1_000);
      const queued = await runtime.service.submit(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: {
            conversationId: first.conversationId,
            submission: {
              type: "input",
              content: "Queued until the first request settles",
              whenBusy: "followUp",
            },
          },
        },
        context,
      );
      await expect(
        (await runtime.harness.submission(queued, context))?.status(context),
      ).resolves.toMatchObject({ status: "queued" });
      const wrongConversation = await runtime.service.cancel(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: {
            conversationId: second.conversationId,
            submissionId: queued,
          },
        },
        context,
      );
      expect(wrongConversation).toBe("not_found");
      const unknownSubmission = await runtime.service.cancel(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: {
            conversationId: first.conversationId,
            submissionId: "missing-submission" as never,
          },
        },
        context,
      );
      expect(unknownSubmission).toBe("not_found");
      const stillActive = await runtime.harness.submission(activeId, context);
      await expect(stillActive?.status(context)).resolves.toMatchObject({
        status: "placed",
      });
      const cancelled = await runtime.service.cancel(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: {
            conversationId: first.conversationId,
            submissionId: queued,
          },
        },
        context,
      );
      expect(cancelled).toBe("aborted");
      expect(
        await runtime.service.cancel(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: {
              conversationId: first.conversationId,
              submissionId: "unknown-submission" as never,
            },
          },
          context,
        ),
      ).toBe("not_found");
      releaseResponse?.(fauxAssistantMessage("First run finished."));
      await (await runtime.harness.submission(activeId, context))?.wait(
        context,
      );
      expect(test.faux.state.callCount).toBe(1);
    } finally {
      releaseResponse?.(fauxAssistantMessage("First run finished."));
      await runtime.close(context);
    }
  });

  it("rejects cancel and compact for wrong scopes, unknown IDs and denied callers", async () => {
    const test = setup();
    const runtime = await openRuntime(test.options, context);
    try {
      await expect(
        runtime.service.cancel(
          {
            scope: { ...test.binding.scope, harnessId: "wrong" },
            caller: test.caller,
            input: { conversationId: runtime.root.id },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
      await expect(
        runtime.service.compact(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: { conversationId: 999_999 as never },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        runtime.service.compact(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: { conversationId: Number.NaN as never },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
    } finally {
      await runtime.close(context);
    }

    const deniedTest = setup();
    const denied = await openRuntime(
      {
        ...deniedTest.options,
        authorization: async () => false,
      },
      context,
    );
    try {
      await expect(
        denied.service.cancel(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: { conversationId: denied.root.id },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        denied.service.compact(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: { conversationId: denied.root.id },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      await denied.close(context);
    }
  });

  it("returns a Pi compaction TaskId and waits for the faux summary task to settle", async () => {
    const test = setup();
    test.faux.setResponses([fauxAssistantMessage("Structured summary.")]);
    const runtime = await openRuntime(test.options, context);
    try {
      const conversation = await runtime.harness.conversation(
        runtime.root.id,
        context,
      );
      if (!conversation) throw new Error("Root conversation is missing");
      const longEntry = {
        kind: "pi.user",
        model: [
          {
            role: "user" as const,
            content: `Long retained context. ${"long context ".repeat(6_000)}`,
            timestamp: Date.now(),
          },
        ],
      };
      for (let index = 0; index < 3; index++) {
        await runtime.service.submit(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: {
              conversationId: conversation.id,
              submission: { type: "write", entry: longEntry },
            },
          },
          context,
        );
      }
      const taskId = await runtime.service.compact(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: {
            conversationId: conversation.id,
            instructions: "Preserve the eight distinct passages.",
          },
        },
        context,
      );
      expect(typeof taskId).toBe("number");
      const task = await runtime.harness.waitForTask(taskId, context);
      expect(task.state).toMatchObject({
        status: "terminal",
        outcome: { status: "completed" },
      });
      expect(test.faux.state.callCount).toBe(1);
      const entries = (await conversation.viewState(context)).value.entries;
      expect(entries.some((entry) => CompactionEntry.is(entry))).toBe(true);
      expect(
        entries.find((entry) => CompactionEntry.is(entry))?.model?.[0],
      ).toMatchObject({ role: "user" });
      expect(
        JSON.stringify(
          entries.find((entry) => CompactionEntry.is(entry))?.model,
        ),
      ).toContain("Structured summary.");
    } finally {
      await runtime.close(context);
    }
  });

  it("rejects a workflow that is not present in the definition", async () => {
    const test = setup();
    const runtime = await openRuntime(test.options, context);
    try {
      await expect(
        runtime.service.createConversation(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: { roleId: "reviewer", workflowId: "unknown" },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
    } finally {
      await runtime.close(context);
    }
  });

  it("rejects scope confusion, unknown roles and authorization denial before creating work", async () => {
    const test = setup();
    let allowed = true;
    const runtime = await openRuntime(
      { ...test.options, authorization: async () => allowed },
      context,
    );
    const call = {
      scope: test.binding.scope,
      caller: test.caller,
      input: { roleId: "reviewer" },
    };
    try {
      await expect(
        runtime.service.createConversation(
          { ...call, scope: { ...call.scope, harnessId: "other" } },
          context,
        ),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
      await expect(
        runtime.service.createConversation(
          { ...call, input: { roleId: "absent" } },
          context,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      allowed = false;
      await expect(
        runtime.service.createConversation(call, context),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(test.faux.state.callCount).toBe(0);
    } finally {
      await runtime.close(context);
    }
  });

  it("uses definition defaults for model and thinking level when binding omits them", async () => {
    const test = setup();
    const definition = {
      ...test.definition,
      defaults: {
        model: { provider: "fixture", modelId: "test" },
        thinkingLevel: "high" as const,
      },
      roles: test.definition.roles.map((role) =>
        role.id === "reviewer"
          ? { ...role, thinkingLevel: "low" as const }
          : role,
      ),
    };
    const { environment: _, ...binding } = test.binding;
    expect(checkBinding(definition, binding, test)).toEqual([]);
    const runtime = await openRuntime(
      { ...test.options, definition, binding },
      context,
    );
    try {
      expect((await runtime.root.agent(context)).model).toEqual({
        provider: "fixture",
        modelId: "test",
      });
      expect((await runtime.root.agent(context)).thinkingLevel).toBe("high");
      const created = await runtime.service.createConversation(
        {
          scope: binding.scope,
          caller: test.caller,
          input: { roleId: "reviewer" },
        },
        context,
      );
      const agent = await (
        await runtime.harness.conversation(created.conversationId, context)
      )?.agent(context);
      expect(agent?.thinkingLevel).toBe("low");
    } finally {
      await runtime.close(context);
    }
  });

  it("rejects a binding with no model and closes the accepted storage", async () => {
    const test = setup();
    const { environment: _, ...binding } = test.binding;
    const storage = new MemoryStorage();
    const close = vi.spyOn(storage, "close");
    await expect(
      openRuntime({ ...test.options, binding, storage }, context),
    ).rejects.toMatchObject({ code: "capability_missing" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("aggregates a preflight failure with storage cleanup failure", async () => {
    const test = setup();
    const cleanupError = new Error("close failed");
    const storage = new MemoryStorage();
    vi.spyOn(storage, "close").mockRejectedValue(cleanupError);
    await expect(
      openRuntime(
        {
          ...test.options,
          binding: { ...test.binding, projectId: "wrong" },
          storage,
        },
        context,
      ),
    ).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "binding_mismatch" }),
        cleanupError,
      ]),
    });
  });

  it("aggregates a post-open startup failure with harness cleanup failure", async () => {
    const test = setup();
    const cleanupError = new Error("harness close failed");
    const storage = new MemoryStorage();
    vi.spyOn(storage, "close").mockRejectedValue(cleanupError);
    await expect(
      openRuntime(
        {
          ...test.options,
          definition: { ...test.definition, rootRoleId: "missing" },
          storage,
        },
        context,
      ),
    ).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "invalid_definition" }),
        cleanupError,
      ]),
    });
  });

  it("closes accepted storage when preflight fails", async () => {
    const test = setup();
    const close = vi.spyOn(test.options.storage, "close");
    await expect(
      openRuntime(
        { ...test.options, binding: { ...test.binding, projectId: "wrong" } },
        context,
      ),
    ).rejects.toMatchObject({ code: "binding_mismatch" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("authorizes submit and getSubmission, checks ownership, and returns missing submissions", async () => {
    const test = setup();
    const decisions: string[] = [];
    const runtime = await openRuntime(
      {
        ...test.options,
        authorization: async ({ operation }) => {
          decisions.push(operation);
          return operation !== "submit";
        },
      },
      context,
    );
    try {
      const created = await runtime.service.createConversation(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: { roleId: "reviewer" },
        },
        context,
      );
      await expect(
        runtime.service.submit(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: {
              conversationId: created.conversationId,
              submission: { type: "input", content: "Denied" },
            },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(
        await runtime.service.getSubmission(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: { submissionId: "missing-submission" as never },
          },
          context,
        ),
      ).toBeUndefined();
      expect(decisions).toEqual([
        "createConversation",
        "submit",
        "getSubmission",
      ]);
      expect(test.faux.state.callCount).toBe(0);
    } finally {
      await runtime.close(context);
    }
  });

  it.each(["projectId", "environmentId", "squadId", "harnessId"] as const)(
    "rejects submit and getSubmission with a foreign %s",
    async (field) => {
      const test = setup();
      const runtime = await openRuntime(test.options, context);
      const input = {
        scope: { ...test.binding.scope, [field]: "other" },
        caller: test.caller,
        input: {
          conversationId: runtime.root.id,
          submission: { type: "input" as const, content: "Wrong scope" },
        },
      };
      try {
        await expect(
          runtime.service.submit(input, context),
        ).rejects.toMatchObject({ code: "binding_mismatch" });
        await expect(
          runtime.service.getSubmission(
            {
              scope: input.scope,
              caller: test.caller,
              input: { submissionId: "missing" as never },
            },
            context,
          ),
        ).rejects.toMatchObject({ code: "binding_mismatch" });
        expect(test.faux.state.callCount).toBe(0);
      } finally {
        await runtime.close(context);
      }
    },
  );

  it("rejects submissions for missing conversations", async () => {
    const test = setup();
    const runtime = await openRuntime(test.options, context);
    try {
      const unregistered = await runtime.harness.createConversation(
        { ownership: { kind: "ownerless" } },
        context,
      );
      await expect(
        runtime.service.submit(
          {
            scope: test.binding.scope,
            caller: test.caller,
            input: {
              conversationId: unregistered.id,
              submission: { type: "input", content: "No target" },
            },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
    } finally {
      await runtime.close(context);
    }
  });

  it("closes the harness and accepted storage after startup fails post-open", async () => {
    const test = setup();
    const storage = new MemoryStorage();
    const close = vi.spyOn(storage, "close");
    await expect(
      openRuntime(
        {
          ...test.options,
          definition: { ...test.definition, rootRoleId: "missing" },
          storage,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_definition" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("includes workflow role metadata, labels and source content in instructions", async () => {
    const test = setup();
    const definition = {
      ...test.definition,
      workflows: test.definition.workflows.map((workflow) => ({
        ...workflow,
        nodes: workflow.nodes.map((node) => ({
          ...node,
          role: "absent-role",
        })),
        edges: workflow.edges.map((edge) => ({ ...edge, label: "" })),
        content: "No headings or input section are present.",
      })),
    };
    const runtime = await openRuntime({ ...test.options, definition }, context);
    try {
      const created = await runtime.service.createConversation(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: { roleId: "reviewer", workflowId: "review" },
        },
        context,
      );
      const agent = await (
        await runtime.harness.conversation(created.conversationId, context)
      )?.agent(context);
      expect(agent?.instructions).toContain("Goal:");
      expect(agent?.instructions).toContain("role: absent-role)");
      expect(agent?.instructions).toContain("inspect → report");
      expect(agent?.instructions).toContain(
        "No headings or input section are present.",
      );
    } finally {
      await runtime.close(context);
    }
  });

  it("requires the workflow entry role and includes graph guidance", async () => {
    const test = setup();
    const runtime = await openRuntime(test.options, context);
    const call = {
      scope: test.binding.scope,
      caller: test.caller,
      input: { roleId: "command", workflowId: "review" },
    };
    try {
      await expect(
        runtime.service.createConversation(call, context),
      ).rejects.toMatchObject({ code: "invalid_request" });
      const created = await runtime.service.createConversation(
        { ...call, input: { ...call.input, roleId: "reviewer" } },
        context,
      );
      const conversation = await runtime.harness.conversation(
        created.conversationId,
        context,
      );
      const agent = await conversation?.agent(context);
      expect(agent?.instructions).toContain("Return evidence");
      expect(agent?.instructions).toContain("inspect");
      expect(created.binding.workflowId).toBe("review");
    } finally {
      await runtime.close(context);
    }
  });

  it("rejects a different runtime ID when reopening existing storage", async () => {
    const test = setup();
    const directory = mkdtempSync(join(tmpdir(), "frogie-runtime-id-"));
    const path = join(directory, "pi.sqlite");
    try {
      const first = await openRuntime(
        { ...test.options, storage: await openNodeSqliteStorage(path) },
        context,
      );
      await first.close(context);
      const storage = await openNodeSqliteStorage(path);
      const close = vi.spyOn(storage, "close");
      await expect(
        openRuntime(
          { ...test.options, runtimeId: "other-runtime", storage },
          context,
        ),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reopens the same SQLite history and rejects a different binding before resuming", async () => {
    const test = setup();
    const directory = mkdtempSync(join(tmpdir(), "frogie-runtime-"));
    const path = join(directory, "pi.sqlite");
    try {
      const first = await openRuntime(
        { ...test.options, storage: await openNodeSqliteStorage(path) },
        context,
      );
      const rootId = first.root.id;
      test.faux.setResponses([fauxAssistantMessage("Remembered.")]);
      const id = await first.service.submit(
        {
          scope: test.binding.scope,
          caller: test.caller,
          input: {
            conversationId: rootId,
            submission: {
              type: "input",
              content: "Remember this",
              requestId: "remember",
            },
          },
        },
        context,
      );
      await (await first.harness.submission(id, context))?.wait(context);
      await first.close(context);
      const second = await openRuntime(
        { ...test.options, storage: await openNodeSqliteStorage(path) },
        context,
      );
      try {
        expect(second.root.id).toBe(rootId);
        expect(
          await second.service.getSubmission(
            {
              scope: test.binding.scope,
              caller: test.caller,
              input: { submissionId: id },
            },
            context,
          ),
        ).toMatchObject({ id, status: "done" });
        expect(test.faux.state.callCount).toBe(1);
      } finally {
        await second.close(context);
      }
      const mismatched = {
        ...test.binding,
        scope: { ...test.binding.scope, environmentId: "another-environment" },
      };
      await expect(
        openRuntime(
          {
            ...test.options,
            binding: mismatched,
            storage: await openNodeSqliteStorage(path),
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
