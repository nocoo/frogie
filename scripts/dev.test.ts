import { mkdir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startPreview } from "../apps/dashboard/src/server/preview.js";
import { version } from "../package.json";
import { main } from "./dev.js";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn() }));
vi.mock("../apps/dashboard/src/server/preview.js", () => ({
  startPreview: vi.fn(),
}));

const close = vi.fn<() => Promise<void>>();
const url = "https://frogie.dev.hexly.ai/#token=test-preview";
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
  vi.mocked(startPreview).mockReset().mockResolvedValue({
    origin: "https://frogie.dev.hexly.ai",
    url,
    close,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
});

function handler(signal: "SIGINT" | "SIGTERM"): () => void {
  const listener = vi
    .mocked(process.on)
    .mock.calls.find(([event]) => event === signal)?.[1];
  if (!listener) throw new Error(`Missing ${signal} handler`);
  return listener;
}

it("starts an isolated local preview, reports its version and shares shutdown for both signals", async () => {
  await main();
  expect(mkdir).toHaveBeenCalledWith(
    expect.stringMatching(/\/data\/local\/?$/),
    { recursive: true },
  );
  const directory = vi.mocked(startPreview).mock.calls[0]?.[0].directory;
  if (!directory) throw new Error("Missing preview directory");
  expect(isAbsolute(directory)).toBe(true);
  expect(directory).toMatch(/\/data\/local\/preview-[0-9a-f-]{36}$/);
  const output = vi.mocked(console.log).mock.calls.flat().join("\n");
  expect(output).toContain(`Frogie v${version}`);
  expect(output).toContain("无模型费用");
  expect(output).toContain(url);
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

it("reports a close failure, removes listeners and marks failure without leaking its deadline", async () => {
  const error = new Error("Close failed");
  close.mockRejectedValueOnce(error);
  await main();
  const stop = handler("SIGTERM");
  stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(console.error).toHaveBeenCalledWith(error);
  expect(process.exitCode).toBe(1);
  expect(process.off).toHaveBeenCalledWith("SIGINT", stop);
  expect(process.off).toHaveBeenCalledWith("SIGTERM", stop);
  expect(vi.getTimerCount()).toBe(0);
});

it("forces exit only when the five-second close deadline expires", async () => {
  close.mockReturnValueOnce(new Promise(() => undefined));
  await main();
  handler("SIGINT")();
  await vi.advanceTimersByTimeAsync(4_999);
  expect(process.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(process.exit).toHaveBeenCalledOnce();
  expect(process.exit).toHaveBeenCalledWith(1);
});

it("surfaces startup failures without registering shutdown listeners", async () => {
  const error = new Error("Port unavailable");
  vi.mocked(startPreview).mockRejectedValueOnce(error);
  await expect(main()).rejects.toBe(error);
  expect(process.on).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
