import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, expect, it } from "vitest";
import {
  loadHisfmDefinition,
  loadHisfmPrompts,
  workPolicy,
} from "../squads/hisfm.js";
import {
  assistantMessage,
  createModelFixture,
  testHost,
  toolCall,
} from "../testing/index.js";
import { defineHostTool, type Host, openAgentHost } from "./index.js";

const hosts: Host<{ results: Record<string, string> }>[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture(databasePath?: string) {
  const model = createModelFixture({
    provider: "test",
    models: [{ id: "agent", reasoning: true }],
    tokensPerSecond: 1000000,
  });
  const definition = loadHisfmDefinition();
  const allNames = new Set(definition.roles.flatMap((r) => r.tools));
  const tools = [...allNames]
    .filter((n) => !["read", "write", "edit", "bash"].includes(n))
    .map((name) =>
      defineHostTool({
        name,
        description: name,
        parameters: Type.Object({ text: Type.String() }),
        replay: "safe",
        execute: async (args) => ({
          content: [{ type: "text", text: args.text }],
          control: { terminate: true },
        }),
      }),
    );
  const dir = await mkdtemp(join(tmpdir(), "frogie-host-test-"));
  dirs.push(dir);
  const options = {
    ...(databasePath ? { databasePath } : {}),
    definition,
    runtimeId: "host-test",
    scope: {
      environmentId: "test",
      squadId: definition.squadId,
      harnessId: "host-test",
    },
    models: model.models,
    roles: Object.fromEntries(
      definition.roles.map((role) => [
        role.id,
        { provider: "test", modelId: "agent", thinkingLevel: "low" as const },
      ]),
    ),
    tools,
    state: {
      kind: "test.business",
      initial: () => ({ results: {} as Record<string, string> }),
    },
    execution: { directory: dir, shellEnv: { PATH: process.env.PATH } },
  };
  const host = await openAgentHost(options);
  hosts.push(host);
  return { host, model, options };
}
it("creates roles atomically, preserves exact instructions and isolates speech tools", async () => {
  const { host, model } = await fixture();
  const prompts = loadHisfmPrompts().defaultPrompts;
  const speech = await host.transact(async (tx) => {
    const id = await tx.create({
      roleId: "speech",
      instructions: workPolicy(prompts, "speech"),
    });
    (await tx.state()).results[String(id)] = "created";
    return id;
  });
  expect((await host.snapshot()).results[String(speech)]).toBe("created");
  const agent = await testHost(host).agent(speech);
  expect(agent.instructions).toBe(prompts.speech);
  expect(agent.tools.map((t) => t.name).sort()).toEqual([
    "generate_speech",
    "submit_result",
  ]);
  model.fake.setResponses([
    assistantMessage([toolCall("submit_result", { text: "verified" })], {
      stopReason: "toolUse",
    }),
  ]);
  expect(
    (
      await host.run(speech, {
        content: "work",
        requestId: "one",
        timeoutMs: 3000,
      })
    ).status,
  ).toBe("done");
  await expect(
    host.transact(async (tx) => {
      (await tx.state()).results.invalid = "bad";
      await tx.create({ roleId: "missing" });
    }),
  ).rejects.toThrow();
  expect((await host.snapshot()).results.invalid).toBeUndefined();
});
it("deduplicates submissions after SQLite reopening without another model request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "frogie-host-persist-"));
  dirs.push(dir);
  const first = await fixture(join(dir, "session.sqlite"));
  first.model.fake.setResponses([assistantMessage("Saved answer")]);
  const input = {
    content: "remember",
    instructions: "Exact instruction",
    requestId: "saved",
    timeoutMs: 3000,
  };
  expect((await first.host.run(first.host.rootId, input)).text).toBe(
    "Saved answer",
  );
  await first.host.close();
  const second = await fixture(join(dir, "session.sqlite"));
  expect(second.host.rootId).toBe(first.host.rootId);
  expect((await second.host.run(second.host.rootId, input)).text).toBe(
    "Saved answer",
  );
  expect(second.model.fake.state.callCount).toBe(0);
  await expect(
    second.host.run(second.host.rootId, { ...input, content: "changed" }),
  ).rejects.toThrow(/different input/);
});
it("allows two independent child conversations to run concurrently", async () => {
  const { host, model } = await fixture();
  const ids = await host.transact(async (tx) => [
    await tx.create({ roleId: "writer" }),
    await tx.create({ roleId: "reviewer" }),
  ]);
  let entered = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const respond = async () => {
    entered++;
    if (entered === 2) release();
    await gate;
    return assistantMessage("Parallel result");
  };
  model.fake.setResponses([respond, respond]);
  const results = await Promise.all(
    ids.map((id) =>
      host.run(id, { content: "work", requestId: "parallel", timeoutMs: 3000 }),
    ),
  );
  expect(entered).toBe(2);
  expect(results.map((r) => r.text)).toEqual([
    "Parallel result",
    "Parallel result",
  ]);
});
it("rejects invalid runs and closes idempotently", async () => {
  const { host } = await fixture();
  await expect(
    host.run(host.rootId, { content: "x", requestId: "", timeoutMs: 5 }),
  ).rejects.toThrow();
  await expect(
    host.run(host.rootId, { content: "x", requestId: "x", timeoutMs: 0 }),
  ).rejects.toThrow();
  await expect(
    host.run(999, { content: "x", requestId: "x", timeoutMs: 5 }),
  ).rejects.toThrow();
  await host.close();
  await host.close();
  await expect(host.snapshot()).rejects.toThrow(/closed/);
});
