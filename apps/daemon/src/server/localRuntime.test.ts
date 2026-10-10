import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startDaemon } from "../daemon.js";
import {
  type LocalModelConfig,
  loadLocalModel,
  startDaemonServer,
  startLocal,
} from "./localRuntime.js";
import { startLocalServer } from "./localServer.js";

vi.mock("../daemon.js", () => ({ startDaemon: vi.fn() }));
vi.mock("./localServer.js", () => ({ startLocalServer: vi.fn() }));

const model: LocalModelConfig = {
  baseUrl: "https://model.example/v1",
  apiKey: "private-test-secret",
  modelId: "local-test-model",
  contextWindow: 32000,
  maxTokens: 1024,
  thinkingLevel: "low",
};
const serverClose = vi.fn(async () => undefined);
const daemonClose = vi.fn(async () => undefined);
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "frogie-local-model-test-"));
  serverClose.mockReset().mockResolvedValue(undefined);
  daemonClose.mockReset().mockResolvedValue(undefined);
  vi.mocked(startDaemon)
    .mockReset()
    .mockResolvedValue({ close: daemonClose } as unknown as Awaited<
      ReturnType<typeof startDaemon>
    >);
  vi.mocked(startLocalServer).mockReset().mockResolvedValue({
    origin: "https://frogie.dev.hexly.ai",
    url: "https://frogie.dev.hexly.ai/#token=local-test",
    close: serverClose,
  });
});
afterEach(async () => {
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

it("starts one daemon and shares its directory with the authenticated server", async () => {
  const directory = join(root, "local");
  const local = await startLocal({ directory, model, port: 0 });
  expect(startDaemon).toHaveBeenCalledWith({
    directory,
    definitionsDirectory: resolve("squads"),
    mode: "local",
    model,
  });
  expect(startLocalServer).toHaveBeenCalledWith(
    expect.objectContaining({
      directory: expect.objectContaining({ close: daemonClose }),
      port: 0,
      publicOrigin: "https://frogie.dev.hexly.ai",
    }),
  );
  expect(local.origin).toBe("https://frogie.dev.hexly.ai");
  expect(local.url).toContain("#token=local-test");
  await local.close();
  await local.close();
  expect(serverClose).toHaveBeenCalledOnce();
  expect(daemonClose).toHaveBeenCalledOnce();
});

it("passes isolated definitions and test origin without a paid model", async () => {
  const local = await startDaemonServer({
    directory: root,
    definitionsDirectory: "/isolated/squads",
    mode: "e2e",
    publicOrigin: "http://127.0.0.1:27033",
  });
  expect(startDaemon).toHaveBeenCalledWith({
    directory: root,
    definitionsDirectory: "/isolated/squads",
    mode: "e2e",
  });
  expect(startLocalServer).toHaveBeenCalledWith(
    expect.objectContaining({
      port: 7033,
      publicOrigin: "http://127.0.0.1:27033",
    }),
  );
  await local.close();
});

it("closes the daemon if the HTTP server fails to start", async () => {
  const error = new Error("Port unavailable");
  vi.mocked(startLocalServer).mockRejectedValueOnce(error);
  await expect(startLocal({ directory: root, model })).rejects.toBe(error);
  expect(daemonClose).toHaveBeenCalledOnce();
});

it("closes execution even if the HTTP close fails", async () => {
  const error = new Error("Socket close failed");
  serverClose.mockRejectedValueOnce(error);
  const local = await startLocal({ directory: root, model });
  await expect(local.close()).rejects.toBe(error);
  expect(daemonClose).toHaveBeenCalledOnce();
});

it("propagates daemon startup failure without creating an HTTP listener", async () => {
  vi.mocked(startDaemon).mockRejectedValueOnce(new Error("Storage in use"));
  await expect(startLocal({ directory: root, model })).rejects.toThrow(
    "Storage in use",
  );
  expect(startLocalServer).not.toHaveBeenCalled();
});
