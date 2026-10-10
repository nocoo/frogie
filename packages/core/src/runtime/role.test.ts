import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels, fauxProvider, Type } from "@earendil-works/pi-ai";
import {
  createRegistry,
  type DocumentReader,
  defineExtension,
  defineTool,
  MemoryStorage,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDefinition } from "../definitions/index.js";
import {
  configureRuntimeRole,
  openRuntime,
  type RuntimeConfiguration,
  type RuntimeHandle,
  type RuntimeOptions,
  readRuntimeRole,
} from "./index.js";

const runtimes: RuntimeHandle[] = [];
const directories: string[] = [];
const caller = { id: "role-test-owner" };

function setup() {
  const loaded = loadDefinition(
    fileURLToPath(
      new URL("../../../../tests/fixtures/minimal-squad", import.meta.url),
    ),
  );
  const provider = fauxProvider({
    provider: "fixture",
    models: [{ id: "test", reasoning: true }],
  });
  const models = createModels();
  models.setProvider(provider.provider);
  const registry = createRegistry();
  registry.install(
    defineExtension({
      name: "fixture-tools",
      tools: ["read_fixture", "write_fixture"].map((name) =>
        defineTool({
          name,
          description: name,
          parameters: Type.Object({}),
          execute: async () => ({}),
        }),
      ),
    }),
  );
  const definition = {
    ...loaded,
    roles: loaded.roles.map((role) => ({
      ...role,
      extensions: ["fixture-tools"],
      tools: ["read_fixture", "write_fixture"],
    })),
    workflows: loaded.workflows.map((workflow) => ({
      ...workflow,
      entry: "report",
      entryRole: "command",
      tools: ["read_fixture"],
    })),
  };
  const options: RuntimeOptions = {
    runtimeId: "role-test-runtime",
    definition,
    binding: {
      projectId: definition.projectId,
      scope: {
        projectId: definition.projectId,
        environmentId: "role-test",
        squadId: definition.squadId,
        harnessId: "role-test-harness",
      },
      definition: { contentHash: definition.contentHash },
      environment: {
        model: { provider: "fixture", modelId: "test" },
        thinkingLevel: "low",
      },
    },
    models,
    registry,
    storage: new MemoryStorage(),
    authorization: async () => true,
  };
  const configuration: RuntimeConfiguration = {
    runtimeId: options.runtimeId,
    definition: options.definition,
    binding: options.binding,
    models,
    registry,
  };
  return { options, configuration };
}

async function open(options: RuntimeOptions) {
  const runtime = await openRuntime(options, context);
  runtimes.push(runtime);
  return runtime;
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close(context);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runtime role bindings", () => {
  it("reads the committed role binding through snapshot only without creating work or writing state", async () => {
    const test = setup();
    const runtime = await open(test.options);
    const created = await runtime.service.createConversation(
      {
        scope: test.options.binding.scope,
        caller,
        input: { roleId: "reviewer" },
      },
      context,
    );
    const commit = vi.spyOn(runtime.harness, "commit");
    const snapshot = vi.spyOn(runtime.harness, "snapshot");
    expect(
      await readRuntimeRole(
        runtime.harness,
        test.configuration,
        created.conversationId,
        context,
      ),
    ).toEqual(created.binding);
    expect(snapshot).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(
      await readRuntimeRole(
        runtime.harness,
        test.configuration,
        runtime.root.id,
        context,
      ),
    ).toMatchObject({
      roleId: "command",
      conversationId: runtime.root.id,
      definitionHash: test.options.definition.contentHash,
    });
  });

  it("rejects missing and foreign role documents without querying or changing other state", async () => {
    const test = setup();
    const runtime = await open(test.options);
    const observed = vi.spyOn(runtime.harness, "snapshot");
    await readRuntimeRole(
      runtime.harness,
      test.configuration,
      runtime.root.id,
      context,
    );
    const stored = observed.mock.results[0];
    const document = await stored?.value;
    for (const value of [
      undefined,
      { ...document, runtimeId: "other-runtime" },
      { ...document, definitionHash: "other-definition" },
    ]) {
      const snapshot = vi.fn(async () => value);
      const reader = { snapshot } as unknown as DocumentReader;
      await expect(
        readRuntimeRole(reader, test.configuration, runtime.root.id, context),
      ).rejects.toThrow();
      expect(snapshot).toHaveBeenCalledOnce();
    }
    expect(
      await readRuntimeRole(
        runtime.harness,
        test.configuration,
        runtime.root.id,
        context,
      ),
    ).toMatchObject({ roleId: "command" });
  });

  it("configures a child role with inherited Workflow restrictions and stores exactly the active binding", async () => {
    const test = setup();
    const runtime = await open(test.options);
    const id = await runtime.harness.commit(async (tx) => {
      const conversation = await tx.createConversation({
        ownership: { kind: "ownerless" },
      });
      await configureRuntimeRole(
        tx,
        test.configuration,
        conversation.id,
        "reviewer",
        {
          workflowId: "review",
          thinkingLevel: "high",
          instructions: "Inherited child task",
        },
      );
      return conversation.id;
    }, context);
    expect(
      await readRuntimeRole(runtime.harness, test.configuration, id, context),
    ).toMatchObject({
      conversationId: id,
      roleId: "reviewer",
      workflowId: "review",
      title: "Reviewer",
      definitionHash: test.configuration.definition.contentHash,
      configHash: expect.any(String),
    });
    const agent = await (
      await runtime.harness.conversation(id, context)
    )?.agent(context);
    expect(agent).toMatchObject({
      model: { provider: "fixture", modelId: "test" },
      thinkingLevel: "high",
      instructions: "Inherited child task",
    });
    expect(agent?.tools?.map((tool) => tool.name)).toEqual(["read_fixture"]);
    await runtime.harness.commit(
      (tx) => configureRuntimeRole(tx, test.configuration, id, "reviewer"),
      context,
    );
    expect(
      await readRuntimeRole(runtime.harness, test.configuration, id, context),
    ).not.toHaveProperty("workflowId");
    expect(
      (
        await (await runtime.harness.conversation(id, context))?.agent(context)
      )?.tools?.map((tool) => tool.name),
    ).toEqual(["read_fixture", "write_fixture"]);
  });

  it("honors explicit empty Workflow capabilities and retains entry-role validation at the service boundary", async () => {
    const test = setup();
    const workflow = test.options.definition.workflows[0];
    if (!workflow) throw new Error("Missing fixture Workflow");
    workflow.tools = [];
    const runtime = await open(test.options);
    const created = await runtime.service.createConversation(
      {
        scope: test.options.binding.scope,
        caller,
        input: { roleId: "command", workflowId: "review" },
      },
      context,
    );
    expect(
      (
        await (
          await runtime.harness.conversation(created.conversationId, context)
        )?.agent(context)
      )?.tools,
    ).toEqual([]);
    await expect(
      runtime.service.createConversation(
        {
          scope: test.options.binding.scope,
          caller,
          input: { roleId: "reviewer", workflowId: "review" },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rolls back invalid Workflow, Role and model configuration without replacing the previous binding", async () => {
    const test = setup();
    const runtime = await open(test.options);
    const before = await readRuntimeRole(
      runtime.harness,
      test.configuration,
      runtime.root.id,
      context,
    );
    for (const [roleId, change] of [
      ["command", { workflowId: "unknown-workflow" }],
      ["unknown-role", {}],
      ["command", { model: { provider: "fixture", modelId: "missing" } }],
    ] as const) {
      await expect(
        runtime.harness.commit(
          (tx) =>
            configureRuntimeRole(
              tx,
              test.configuration,
              runtime.root.id,
              roleId,
              change,
            ),
          context,
        ),
      ).rejects.toThrow();
      expect(
        await readRuntimeRole(
          runtime.harness,
          test.configuration,
          runtime.root.id,
          context,
        ),
      ).toEqual(before);
    }
  });

  it("reopens the original SQLite role and Workflow binding without substituting current defaults", async () => {
    const test = setup();
    const directory = await mkdtemp(join(tmpdir(), "frogie-role-test-"));
    directories.push(directory);
    const database = join(directory, "session.sqlite");
    const runtime = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(database),
    });
    const created = await runtime.service.createConversation(
      {
        scope: test.options.binding.scope,
        caller,
        input: { roleId: "command", workflowId: "review" },
      },
      context,
    );
    const before = await readRuntimeRole(
      runtime.harness,
      test.configuration,
      created.conversationId,
      context,
    );
    await runtime.close(context);
    const reopened = await open({
      ...test.options,
      storage: await openNodeSqliteStorage(database),
    });
    expect(
      await readRuntimeRole(
        reopened.harness,
        test.configuration,
        created.conversationId,
        context,
      ),
    ).toEqual(before);
    expect(
      (
        await (
          await reopened.harness.conversation(created.conversationId, context)
        )?.agent(context)
      )?.tools?.map((tool) => tool.name),
    ).toEqual(["read_fixture"]);
  });
});
