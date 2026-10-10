import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, expect, it } from "vitest";
import { loadDefinition } from "../definitions/index.js";
import {
  assistantMessage,
  createModelFixture,
  toolCall,
} from "../testing/index.js";
import {
  defineHostTool,
  type Host,
  type HostOptions,
  openAgentHost,
} from "./index.js";
import { getHostInternals } from "./internal.js";

const hosts: Host<{ completed: boolean }>[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.allSettled(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function interrupted() {
  const directory = await mkdtemp(join(tmpdir(), "frogie-staged-abort-"));
  directories.push(directory);
  const counter = join(directory, "effect.txt");
  const model = createModelFixture({
    provider: "recovery",
    models: [{ id: "agent", reasoning: true }],
    tokensPerSecond: 1000000,
  });
  model.fake.setResponses([
    assistantMessage([toolCall("effect", {})], { stopReason: "toolUse" }),
    assistantMessage("Finished"),
    assistantMessage("Queued input finished"),
  ]);
  const definition = loadDefinition("tests/fixtures/minimal-squad");
  for (const role of definition.roles) {
    role.extensions = ["recovery.effect"];
    role.tools = ["effect"];
  }
  let attempts = 0;
  const options: HostOptions<{ completed: boolean }> = {
    databasePath: join(directory, "runtime.sqlite"),
    definition,
    runtimeId: "recovery",
    scope: {
      environmentId: "test",
      squadId: definition.squadId,
      harnessId: "recovery",
    },
    models: model.models,
    roles: Object.fromEntries(
      definition.roles.map((role) => [
        role.id,
        { provider: "recovery", modelId: "agent", thinkingLevel: "low" },
      ]),
    ),
    tools: [
      defineHostTool({
        name: "effect",
        description: "Persist a local effect",
        parameters: Type.Object({}),
        replay: "safe",
        execute: async (_args, execution) => {
          attempts++;
          if (attempts === 1) {
            await new Promise<void>((_resolve, reject) => {
              execution.signal.addEventListener(
                "abort",
                () => reject(new Error("Interrupted before effect")),
                { once: true },
              );
            });
          }
          await writeFile(counter, "effect");
          return { content: [{ type: "text", text: "Saved" }] };
        },
      }),
    ],
    state: { kind: "recovery.business", initial: () => ({ completed: false }) },
  };
  const first = await openAgentHost(options);
  hosts.push(first);
  const request = {
    requestId: "pending-effect",
    content: "Persist an effect",
    timeoutMs: 10000,
  };
  const running = first.run(first.rootId, request).catch(() => undefined);
  await expect.poll(() => attempts).toBe(1);
  const internal = getHostInternals(first);
  await internal.runtime.root.submit(
    {
      type: "input",
      requestId: "queued-request",
      content: "Follow up",
      whenBusy: "followUp",
    },
    internal.context,
  );
  await first.close();
  await running;
  const second = await openAgentHost(options);
  hosts.push(second);
  return { host: second, model, counter, attempts: () => attempts, request };
}

it("stages durable cancellation before enabling restored work and never performs the pending effect", async () => {
  const test = await interrupted();
  const pending = await test.host.pendingSubmissions();
  expect(pending).toEqual(
    expect.arrayContaining([
      {
        conversationId: test.host.rootId,
        requestId: "pending-effect",
        status: "placed",
      },
      {
        conversationId: test.host.rootId,
        requestId: "queued-request",
        status: "queued",
      },
    ]),
  );
  expect(pending).toHaveLength(2);
  expect(test.model.fake.state.callCount).toBe(1);
  expect(test.attempts()).toBe(1);
  await test.host.stageAbort([test.host.rootId]);
  await test.host.stageAbort([test.host.rootId]);
  expect(test.model.fake.state.callCount).toBe(1);
  expect(test.attempts()).toBe(1);
  await test.host.resume();
  const internal = getHostInternals(test.host);
  await internal.runtime.root.waitForIdle(internal.context);
  await expect(test.host.pendingSubmissions()).rejects.toThrow(/paused/);
  const settled = await internal.options.storage.scanSubmissions(
    {},
    100,
    undefined,
    internal.context,
  );
  expect(settled.items.every((item) => item.status === "unanswered")).toBe(
    true,
  );
  expect(test.model.fake.state.callCount).toBe(1);
  expect(test.attempts()).toBe(1);
  await expect(readFile(test.counter)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("retains recoverable work after rejecting foreign staging and resumes the effect only when allowed", async () => {
  const test = await interrupted();
  const pending = await test.host.pendingSubmissions();
  for (const foreign of [0, -1, 0.5, NaN, Infinity, 999]) {
    await expect(
      test.host.stageAbort([test.host.rootId, foreign]),
    ).rejects.toThrow();
    expect(await test.host.pendingSubmissions()).toEqual(pending);
  }
  expect(test.attempts()).toBe(1);
  await test.host.resume();
  await expect(test.host.stageAbort([test.host.rootId])).rejects.toThrow();
  const internal = getHostInternals(test.host);
  await internal.runtime.root.waitForIdle(internal.context);
  expect(await readFile(test.counter, "utf8")).toBe("effect");
  expect(test.attempts()).toBe(2);
  expect(test.model.fake.state.callCount).toBeGreaterThan(1);
  await expect(test.host.pendingSubmissions()).rejects.toThrow(/paused/);
  await test.host.close();
  await expect(test.host.pendingSubmissions()).rejects.toThrow(/closed/i);
  expect(() => test.host.stageAbort([test.host.rootId])).toThrow(/closed/i);
});
