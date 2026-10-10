import { Type } from "typebox";
import { expect, it } from "vitest";
import { loadDefinition } from "../definitions/index.js";
import {
  configuredModels,
  defineHostTool,
  openAgentHost,
} from "../host/index.js";
import {
  assistantMessage,
  contextTokens,
  createModelFixture,
  inspectModels,
  testHost,
  thinking,
  toolCall,
} from "./index.js";

it("drives real durable turns and inspects history without exposing runtime internals", async () => {
  const definition = loadDefinition(
    new URL("../../../../tests/fixtures/minimal-squad", import.meta.url)
      .pathname,
  );
  const fixture = createModelFixture({
    provider: "fixture",
    models: [{ id: "test", reasoning: true }],
    tokensPerSecond: 100000,
  });
  for (const role of definition.roles) {
    role.extensions = ["testing"];
    role.tools = ["echo"];
  }
  fixture.fake.setResponses([
    assistantMessage([thinking("private"), { type: "text", text: "Done" }]),
  ]);
  fixture.fake.appendResponses([assistantMessage("Next")]);
  const host = await openAgentHost({
    definition,
    runtimeId: "test",
    scope: {
      environmentId: "test",
      squadId: definition.squadId,
      harnessId: "testing",
    },
    models: fixture.models,
    roles: Object.fromEntries(
      definition.roles.map((role) => [
        role.id,
        { provider: "fixture", modelId: "test", thinkingLevel: "low" },
      ]),
    ),
    tools: [
      defineHostTool({
        name: "echo",
        description: "Echo an input",
        replay: "safe",
        parameters: Type.Object({ text: Type.String() }),
        execute: async (args, execution) => ({
          content: [
            {
              type: "text",
              text: `${execution.taskId}:${args.text}:${execution.signal.aborted}`,
            },
          ],
        }),
      }),
    ],
    state: { kind: "testing.work", initial: () => ({}) },
  });
  try {
    const inspect = testHost(host);
    const ids = await inspect.appendHistory(host.rootId, [
      { role: "user", content: "Prior", timestamp: 1 },
      assistantMessage("Previous", { timestamp: 2 }),
    ]);
    expect(ids).toHaveLength(2);
    expect(
      (await inspect.entries(host.rootId)).items.map((entry) => entry.id),
    ).toEqual(expect.arrayContaining(ids));
    expect((await inspect.context(host.rootId)).head).toBeUndefined();
    expect(await inspect.agent(host.rootId)).toMatchObject({
      thinkingLevel: "low",
      tools: [{ name: "echo" }],
    });
    expect(
      (
        await host.run(host.rootId, {
          content: "Continue",
          requestId: "one",
          timeoutMs: 1000,
        })
      ).text,
    ).toBe("Done");
    expect(
      (
        await host.run(host.rootId, {
          content: "Continue",
          requestId: "two",
          timeoutMs: 1000,
        })
      ).text,
    ).toBe("Next");
    expect(fixture.fake.state.callCount).toBe(2);
    expect(
      contextTokens([{ role: "user", content: "Hello", timestamp: 1 }]),
    ).toBeGreaterThan(0);
    expect(toolCall("echo", { text: "hello" })).toMatchObject({
      name: "echo",
      arguments: { text: "hello" },
    });
    const execution = { conversationId: host.rootId, taskId: 7 };
    expect(await inspect.tool("echo", { text: "hi" }, execution)).toMatchObject(
      { content: [{ text: "7:hi:false" }] },
    );
    expect(
      await inspect.tool(
        "echo",
        { text: "bye" },
        { ...execution, signal: AbortSignal.abort() },
      ),
    ).toMatchObject({ content: [{ text: "7:bye:true" }] });
    await expect(inspect.tool("missing", {}, execution)).rejects.toThrow(
      "Unknown host tool",
    );
    await expect(inspect.agent(9999)).rejects.toThrow("Missing conversation");
  } finally {
    await host.close();
  }
});

it("reports model settings and authentication presence without exposing credentials", async () => {
  const fixture = createModelFixture();
  expect(fixture.fake.getModel().id).toBeDefined();
  const models = inspectModels(
    configuredModels([
      {
        id: "fixture",
        baseUrl: "http://127.0.0.1:1",
        apiKey: "private",
        models: [{ id: "test", contextWindow: 128000, maxTokens: 8192 }],
      },
    ]),
  );
  expect(models.getModels().map((model) => model.id)).toEqual(["test"]);
  expect(models.getModel("fixture", "test")).toMatchObject({
    contextWindow: 128000,
    maxTokens: 8192,
  });
  expect(await models.hasAuth("fixture")).toBe(true);
  expect(await inspectModels(fixture.models).hasAuth("missing")).toBe(false);
});
