import { mkdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type LocalModelConfig,
  loadLocalModel,
  startLocal,
} from "../apps/daemon/src/server/localRuntime.js";
import { startPreview } from "../apps/daemon/src/server/preview.js";
import { version } from "../package.json";
import { main } from "./dev.js";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn() }));
vi.mock("../apps/daemon/src/server/localRuntime.js", () => ({
  loadLocalModel: vi.fn(),
  startLocal: vi.fn(),
}));
vi.mock("../apps/daemon/src/server/preview.js", () => ({
  startPreview: vi.fn(),
}));

const close = vi.fn<() => Promise<void>>();
const url = "https://frogie.dev.hexly.ai/";
const model: LocalModelConfig = {
  baseUrl: "https://models.example/v1",
  apiKey: "private-test-key",
  modelId: "selected-model",
  contextWindow: 32000,
  maxTokens: 1024,
  thinkingLevel: "low",
};
let originalExitCode: typeof process.exitCode;

beforeEach(() => {
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(process, "on").mockReturnValue(process);
  vi.spyOn(process, "off").mockReturnValue(process);
  vi.spyOn(process, "exit").mockReturnValue(undefined as never);
  vi.mocked(mkdir).mockReset().mockResolvedValue(undefined);
  close.mockReset().mockResolvedValue(undefined);
  vi.mocked(loadLocalModel).mockReset().mockResolvedValue(model);
  vi.mocked(startLocal).mockReset().mockResolvedValue({
    origin: "https://frogie.dev.hexly.ai",
    url,
    close,
  });
  vi.mocked(startPreview).mockReset().mockResolvedValue({
    origin: "https://frogie.dev.hexly.ai",
    url,
    close,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = originalExitCode;
});

function handler(signal: "SIGINT" | "SIGTERM"): () => void {
  const listener = vi
    .mocked(process.on)
    .mock.calls.find(([event]) => event === signal)?.[1];
  if (!listener) throw new Error(`Missing ${signal} handler`);
  return listener;
}

it("defaults to the persistent Local runtime, reports its model and shares shutdown for both signals", async () => {
  vi.stubEnv("FROGIE_MODE", undefined);
  vi.stubEnv("FROGIE_MODEL_CONFIG", undefined);
  await main();
  const directory = resolve("data/local/daemon");
  expect(loadLocalModel).toHaveBeenCalledWith(resolve("data/local-model.json"));
  expect(startLocal).toHaveBeenCalledWith({ directory, model });
  expect(startPreview).not.toHaveBeenCalled();
  const output = vi.mocked(console.log).mock.calls.flat().join("\n");
  expect(output).toContain(`Frogie v${version}`);
  expect(output).toContain("Local");
  expect(output).toContain(model.modelId);
  expect(output).not.toContain(model.apiKey);
  expect(output).not.toContain("无模型费用");
  expect(console.log).toHaveBeenCalledWith(`打开本地页面：${url}`);
  expect(output).not.toContain("一次性");
  expect(output).not.toContain("#token=");
  expect(output).toContain(directory);
  const stop = handler("SIGINT");
  expect(handler("SIGTERM")).toBe(stop);
  stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(close).toHaveBeenCalledOnce();
  expect(process.off).toHaveBeenCalledWith("SIGINT", stop);
  expect(process.off).toHaveBeenCalledWith("SIGTERM", stop);
  expect(vi.getTimerCount()).toBe(0);
  expect(process.exit).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
});

it("loads an explicitly selected Local configuration", async () => {
  await main({
    FROGIE_MODE: "local",
    FROGIE_MODEL_CONFIG: "/private/frogie-model.json",
  });
  expect(loadLocalModel).toHaveBeenCalledWith("/private/frogie-model.json");
  expect(startLocal).toHaveBeenCalledOnce();
  expect(startPreview).not.toHaveBeenCalled();
});

it("isolates E2E under its own unique directory without loading any model key", async () => {
  await main({
    FROGIE_MODE: "e2e",
    FROGIE_MODEL_CONFIG: "/private/unused.json",
  });
  expect(mkdir).toHaveBeenCalledWith(resolve("data/e2e"), { recursive: true });
  const directory = vi.mocked(startPreview).mock.calls[0]?.[0].directory;
  if (!directory) throw new Error("Missing preview directory");
  expect(isAbsolute(directory)).toBe(true);
  expect(directory).toMatch(/\/data\/e2e\/preview-[0-9a-f-]{36}$/);
  expect(startLocal).not.toHaveBeenCalled();
  expect(loadLocalModel).not.toHaveBeenCalled();
  const output = vi.mocked(console.log).mock.calls.flat().join("\n");
  expect(output).toContain("E2E");
  expect(output).toContain("无模型费用");
  expect(console.log).toHaveBeenCalledWith(`打开本地页面：${url}`);
  expect(output).not.toContain("一次性");
  expect(output).not.toContain("#token=");
  expect(output).toContain(directory);
});

it.each(["prod", "production", "", "LOCAL"])(
  "rejects unsupported mode %s before accessing runtime resources",
  async (mode) => {
    await expect(main({ FROGIE_MODE: mode })).rejects.toThrow();
    expect(mkdir).not.toHaveBeenCalled();
    expect(loadLocalModel).not.toHaveBeenCalled();
    expect(startLocal).not.toHaveBeenCalled();
    expect(startPreview).not.toHaveBeenCalled();
  },
);

it("propagates an invalid Local configuration without substituting a faux model", async () => {
  const error = new Error("Configuration invalid");
  vi.mocked(loadLocalModel).mockRejectedValueOnce(error);
  await expect(main({})).rejects.toBe(error);
  expect(startLocal).not.toHaveBeenCalled();
  expect(startPreview).not.toHaveBeenCalled();
  expect(process.on).not.toHaveBeenCalled();
});

it("reports a close failure, removes listeners and marks failure without leaking its deadline", async () => {
  const error = new Error("Close failed");
  close.mockRejectedValueOnce(error);
  await main({});
  const stop = handler("SIGTERM");
  stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(console.error).toHaveBeenCalledWith(error);
  expect(process.exitCode).toBe(1);
  expect(process.off).toHaveBeenCalledWith("SIGINT", stop);
  expect(process.off).toHaveBeenCalledWith("SIGTERM", stop);
  expect(vi.getTimerCount()).toBe(0);
});

it("allows server and Harness cleanup before the shutdown deadline expires", async () => {
  close.mockReturnValueOnce(new Promise(() => undefined));
  await main({});
  handler("SIGINT")();
  await vi.advanceTimersByTimeAsync(15_999);
  expect(process.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(process.exit).toHaveBeenCalledOnce();
  expect(process.exit).toHaveBeenCalledWith(1);
});

it("surfaces startup failures without registering shutdown listeners", async () => {
  const error = new Error("Port unavailable");
  vi.mocked(startLocal).mockRejectedValueOnce(error);
  await expect(main({})).rejects.toBe(error);
  expect(process.on).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
