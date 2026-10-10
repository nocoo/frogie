import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import * as runtimeModule from "@frogie/core/runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type LocalModelConfig,
  loadLocalModel,
  startLocal,
} from "./localRuntime.js";
import { type LocalServerOptions, startLocalServer } from "./localServer.js";

vi.mock("./localServer.js", () => ({ startLocalServer: vi.fn() }));

const model: LocalModelConfig = {
  baseUrl: "https://model.example/v1",
  apiKey: "private-test-secret",
  modelId: "local-test-model",
  contextWindow: 32000,
  maxTokens: 1024,
  thinkingLevel: "low",
};
const openRuntime = runtimeModule.openRuntime;
const runtimes: Awaited<ReturnType<typeof openRuntime>>[] = [];
const locals: Awaited<ReturnType<typeof startLocal>>[] = [];
const servers: Server[] = [];
const serverClose = vi.fn(async () => undefined);
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "frogie-local-model-test-"));
  serverClose.mockClear();
  vi.mocked(startLocalServer).mockReset().mockResolvedValue({
    origin: "https://frogie.dev.hexly.ai",
    url: "https://frogie.dev.hexly.ai/#token=local-test",
    close: serverClose,
  });
  vi.spyOn(runtimeModule, "openRuntime").mockImplementation(async (...args) => {
    const runtime = await openRuntime(...args);
    runtimes.push(runtime);
    vi.spyOn(runtime, "close");
    return runtime;
  });
});

afterEach(async () => {
  for (const local of locals.splice(0)) await local.close();
  for (const runtime of runtimes.splice(0))
    await runtime.close(BACKGROUND_CONTEXT);
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function config(value: unknown): Promise<string> {
  const path = join(root, "model.json");
  await writeFile(path, JSON.stringify(value));
  return path;
}

it.each([
  "https://model.example/v1",
  "http://127.0.0.1:1111/v1",
  "http://localhost:1111/v1",
  "http://[::1]:1111/v1",
])(
  "loads the explicit model configuration from %s without expanding its key",
  async (baseUrl) => {
    vi.stubEnv("FROGIE_TEST_MODEL_KEY", "expanded-secret");
    const input = { ...model, baseUrl, apiKey: "$FROGIE_TEST_MODEL_KEY" };
    expect(await loadLocalModel(await config(input))).toEqual(input);
  },
);

it.each(["off", "minimal", "low", "medium", "high", "xhigh"])(
  "accepts the Pi thinking level %s",
  async (thinkingLevel) => {
    expect(
      await loadLocalModel(await config({ ...model, thinkingLevel })),
    ).toMatchObject({ thinkingLevel });
  },
);

it.each([
  null,
  [],
  {},
  { ...model, extra: "private-test-secret" },
  { ...model, apiKey: "" },
  { ...model, apiKey: "   " },
  { ...model, modelId: "" },
  { ...model, modelId: "   " },
  { ...model, contextWindow: 0 },
  { ...model, contextWindow: 3.5 },
  { ...model, maxTokens: -1 },
  { ...model, maxTokens: 1.5 },
  { ...model, maxTokens: 32001 },
  { ...model, thinkingLevel: "ultra" },
  { ...model, baseUrl: "not-a-url" },
  { ...model, baseUrl: "http://model.example/v1" },
  { ...model, baseUrl: "http://localhost.evil.example/v1" },
  { ...model, baseUrl: "ftp://127.0.0.1/v1" },
  { ...model, baseUrl: "https://name:password@model.example/v1" },
  { ...model, baseUrl: "https://model.example/v1?key=private-test-secret" },
  { ...model, baseUrl: "https://model.example/v1#private-test-secret" },
])(
  "rejects an invalid configuration without exposing its content (%#)",
  async (input) => {
    const error = await loadLocalModel(await config(input)).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/[\u4e00-\u9fff]/u);
    expect((error as Error).message).not.toContain("private-test-secret");
    expect((error as Error).message).not.toContain(JSON.stringify(input));
  },
);

it("reports absent and malformed JSON through the same generic configuration error", async () => {
  const path = join(root, "missing-private-config.json");
  const missing = await loadLocalModel(path).catch((error: unknown) => error);
  await writeFile(path, '{"apiKey":"private-test-secret",');
  const malformed = await loadLocalModel(path).catch((error: unknown) => error);
  expect(missing).toBeInstanceOf(Error);
  expect(malformed).toBeInstanceOf(Error);
  expect((missing as Error).message).toBe((malformed as Error).message);
  expect((malformed as Error).message).not.toContain("private-test-secret");
  expect((missing as Error).message).not.toContain(path);
});

it("validates direct startLocal model input before touching its directory", async () => {
  const directory = join(root, "not-created");
  await expect(
    startLocal({ directory, model: { ...model, apiKey: "" } }),
  ).rejects.toThrow();
  await expect(readdir(directory)).rejects.toMatchObject({ code: "ENOENT" });
  expect(startLocalServer).not.toHaveBeenCalled();
});

function currentServer(): LocalServerOptions {
  const options = vi.mocked(startLocalServer).mock.calls.at(-1)?.[0];
  if (!options) throw new Error("Local server was not started");
  return options;
}

async function submit(options: LocalServerOptions, text: string) {
  const call = { scope: options.scope, caller: { id: "local-user" } };
  const conversations = await options.service.listConversations(
    { ...call, input: {} },
    options.context,
  );
  const conversationId = conversations[0]?.conversation.id;
  if (conversationId === undefined)
    throw new Error("Missing root conversation");
  const submissionId = await options.service.submit(
    {
      ...call,
      input: {
        conversationId,
        submission: { type: "input", content: text },
      },
    },
    options.context,
  );
  await vi.waitFor(
    async () => {
      expect(
        await options.service.getSubmission(
          { ...call, input: { submissionId } },
          options.context,
        ),
      ).toMatchObject({ status: "done" });
    },
    { timeout: 5000 },
  );
  const watch = await options.service.observeConversation(
    { ...call, input: { conversationId } },
    options.context,
  );
  try {
    return JSON.stringify(
      watch.value.entries.flatMap((entry) =>
        (entry.model ?? []).filter((message) => message.role === "assistant"),
      ),
    );
  } finally {
    await watch.stop();
  }
}

it("uses the real OpenAI adapter and reopens the same SQLite identity and transcript", async () => {
  const requests: {
    path: string | undefined;
    auth: string | undefined;
    body: Record<string, unknown>;
  }[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        path: request.url,
        auth: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString()) as Record<
          string,
          unknown
        >,
      });
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = {
        id: "chatcmpl-local-test",
        object: "chat.completion.chunk",
        created: 1,
        model: model.modelId,
      };
      response.write(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: `Adapter answer ${requests.length}` }, finish_reason: null }] })}\n\n`,
      );
      response.end(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 } })}\n\ndata: [DONE]\n\n`,
      );
    })().catch(() => response.destroy());
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const directory = join(root, "persisted");
  const config = { ...model, baseUrl };
  const first = await startLocal({ directory, model: config, port: 0 });
  locals.push(first);
  expect(first).toMatchObject({
    origin: "https://frogie.dev.hexly.ai",
    url: "https://frogie.dev.hexly.ai/#token=local-test",
  });
  const initial = currentServer();
  expect(initial).toMatchObject({
    publicOrigin: "https://frogie.dev.hexly.ai",
    port: 0,
  });
  expect(await initial.definitions?.list()).toHaveLength(1);
  expect(await submit(initial, "First real adapter turn")).toContain(
    "Adapter answer 1",
  );
  expect(requests[0]).toMatchObject({
    path: "/v1/chat/completions",
    auth: `Bearer ${model.apiKey}`,
    body: { model: model.modelId, stream: true, reasoning_effort: "low" },
  });
  const metadata = await readFile(join(directory, "runtime.json"), "utf8");
  expect(JSON.parse(metadata)).toEqual({
    runtimeId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  await first.close();
  await first.close();
  expect(serverClose).toHaveBeenCalledOnce();
  expect(runtimes[0]?.close).toHaveBeenCalledOnce();
  const second = await startLocal({ directory, model: config });
  locals.push(second);
  const resumed = currentServer();
  expect(resumed.scope).toEqual(initial.scope);
  expect(resumed.port).toBe(7033);
  const answer = await submit(resumed, "Second real adapter turn");
  expect(answer).toContain("Adapter answer 1");
  expect(answer).toContain("Adapter answer 2");
  expect(JSON.stringify(requests[1]?.body.messages)).toContain(
    "First real adapter turn",
  );
  expect(requests).toHaveLength(2);
  expect(await readFile(join(directory, "runtime.json"), "utf8")).toBe(
    metadata,
  );
  expect(
    (await readFile(join(directory, "session.sqlite")))
      .subarray(0, 15)
      .toString(),
  ).toBe("SQLite format 3");
});

it.each(["model", "definition"])(
  "rejects a changed %s binding on reopening",
  async (changed) => {
    const directory = join(root, "binding");
    const local = await startLocal({ directory, model });
    locals.push(local);
    await local.close();
    if (changed === "definition") {
      const path = join(directory, "squads/minimal-squad/SQUAD.md");
      await writeFile(
        path,
        `${await readFile(path, "utf8")}\nChanged mission.\n`,
      );
    }
    await expect(
      startLocal({
        directory,
        model:
          changed === "model" ? { ...model, thinkingLevel: "high" } : model,
      }),
    ).rejects.toMatchObject({ code: "binding_mismatch" });
    expect(startLocalServer).toHaveBeenCalledOnce();
  },
);

it.each([
  undefined,
  "broken-json",
  '{"runtimeId":"not-a-uuid"}',
  '{"runtimeId":"9d023315-e30b-40f2-bb8a-6bed9087160d","extra":true}',
])(
  "preserves unknown or invalid existing directories (%#)",
  async (metadata) => {
    const directory = join(root, "unknown");
    await mkdir(directory);
    await writeFile(join(directory, "sentinel.txt"), "Keep this data");
    if (metadata !== undefined)
      await writeFile(join(directory, "runtime.json"), metadata);
    const before = await readdir(directory);
    await expect(startLocal({ directory, model })).rejects.toThrow();
    expect(await readdir(directory)).toEqual(before);
    expect(await readFile(join(directory, "sentinel.txt"), "utf8")).toBe(
      "Keep this data",
    );
    expect(startLocalServer).not.toHaveBeenCalled();
  },
);

it("closes runtime storage after server startup fails and can reopen the retained data", async () => {
  const directory = join(root, "server-failure");
  const error = new Error("Port unavailable");
  vi.mocked(startLocalServer).mockRejectedValueOnce(error);
  await expect(startLocal({ directory, model })).rejects.toBe(error);
  expect(runtimes[0]?.close).toHaveBeenCalledOnce();
  const local = await startLocal({ directory, model });
  locals.push(local);
  expect(startLocalServer).toHaveBeenCalledTimes(2);
});

it("rejects a malformed UUID before reopening an existing owned runtime", async () => {
  const directory = join(root, "invalid-identity");
  const local = await startLocal({ directory, model });
  locals.push(local);
  await local.close();
  const metadata = JSON.stringify({ runtimeId: "-".repeat(36) });
  await writeFile(join(directory, "runtime.json"), metadata);
  await expect(startLocal({ directory, model })).rejects.toThrow();
  expect(runtimeModule.openRuntime).toHaveBeenCalledOnce();
  expect(await readFile(join(directory, "runtime.json"), "utf8")).toBe(
    metadata,
  );
});
