import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gate, main } from "./cli.js";

const roots: string[] = [];
const originalPidFile = process.env.FROGIE_CLI_PID_FILE;
const originalChildFile = process.env.FROGIE_CLI_CHILD_FILE;
const lock = "lockfileVersion: '9.0'\nimporters: {}\n";

function write(root: string, path: string, content: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "frogie-cli-lifecycle-"));
  roots.push(root);
  const repository = join(root, "repository");
  const pidFile = join(root, "pids.json");
  const childFile = join(root, "child.started");
  write(repository, ".gitignore", "node_modules/\ncoverage/\n");
  write(repository, "package.json", JSON.stringify({ name: "frogie" }));
  write(
    repository,
    "packages/core/package.json",
    JSON.stringify({ name: "@frogie/core" }),
  );
  write(
    repository,
    "apps/dashboard/package.json",
    JSON.stringify({ name: "@frogie/dashboard" }),
  );
  write(repository, "pnpm-lock.yaml", lock);
  write(repository, "source.txt", "unchanged\n");
  write(repository, "node_modules/.pnpm/lock.yaml", lock);
  for (const workspace of ["", "packages/core", "apps/dashboard"])
    mkdirSync(join(repository, workspace, "node_modules"), { recursive: true });

  const hang = `#!${process.execPath}
const fs = require("node:fs");
const {spawn} = require("node:child_process");
const child = spawn(process.execPath, ["-e", "require('node:fs').writeFileSync(process.env.FROGIE_CLI_CHILD_FILE, String(process.pid)); setInterval(() => {}, 1000)"]);
fs.writeFileSync(process.env.FROGIE_CLI_PID_FILE, JSON.stringify({pids:[process.pid, child.pid], cwd:process.cwd()}));
setInterval(() => {}, 1000);
`;
  const successful = `#!${process.execPath}
const fs = require("node:fs");
fs.mkdirSync("coverage", {recursive:true});
fs.writeFileSync("coverage/vitest.json", JSON.stringify({numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true}));
`;
  for (const [name, body] of [
    ["tsc", hang],
    ["biome", `#!${process.execPath}\n`],
    ["vitest", successful],
  ] as const) {
    const relative = `node_modules/.bin/${name}`;
    write(repository, relative, body);
    chmodSync(join(repository, relative), 0o755);
  }
  execFileSync("git", ["init", "-q"], { cwd: repository });
  execFileSync(
    "git",
    [
      "add",
      "--",
      ".gitignore",
      "package.json",
      "packages/core/package.json",
      "apps/dashboard/package.json",
      "pnpm-lock.yaml",
      "source.txt",
    ],
    { cwd: repository },
  );
  return { root, repository, pidFile, childFile };
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function expectExited(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } catch {
      return;
    }
  }
  expect(() => process.kill(pid, 0)).toThrow();
}

async function expectCancellation(promise: Promise<void>): Promise<void> {
  const outcome = await Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise<"pending">((resolve) =>
      setTimeout(() => resolve("pending"), 1_000),
    ),
  ]);
  expect(outcome).toBe("rejected");
}

function sourceState(repository: string): string {
  return readFileSync(join(repository, "source.txt"), "utf8");
}

async function startMainFixture() {
  const test = fixture();
  process.env.FROGIE_CLI_PID_FILE = test.pidFile;
  process.env.FROGIE_CLI_CHILD_FILE = test.childFile;
  const source = sourceState(test.repository);
  const listeners = {
    int: process.listenerCount("SIGINT"),
    term: process.listenerCount("SIGTERM"),
  };
  const running = main(["index", test.repository], "");
  void running.catch(() => undefined);
  try {
    await waitForFile(test.pidFile);
    const started = JSON.parse(readFileSync(test.pidFile, "utf8")) as {
      pids: number[];
      cwd: string;
    };
    await waitForFile(test.childFile);
    return { ...test, source, listeners, running, ...started };
  } catch (error) {
    await running.catch(() => undefined);
    throw error;
  }
}

async function killStartedProcesses(pids: readonly number[]): Promise<void> {
  const [leader, ...children] = pids;
  if (leader === undefined) return;
  try {
    process.kill(-leader, "SIGKILL");
  } catch {}
  for (const pid of children) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  await Promise.all(pids.map(expectExited));
}

afterEach(() => {
  if (originalPidFile === undefined) delete process.env.FROGIE_CLI_PID_FILE;
  else process.env.FROGIE_CLI_PID_FILE = originalPidFile;
  if (originalChildFile === undefined) delete process.env.FROGIE_CLI_CHILD_FILE;
  else process.env.FROGIE_CLI_CHILD_FILE = originalChildFile;
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("CLI cancellation lifecycle", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "cleans the owned process tree on %s",
    async (signal) => {
      const test = await startMainFixture();
      try {
        expect(process.listenerCount("SIGINT")).toBeGreaterThan(
          test.listeners.int,
        );
        expect(process.listenerCount("SIGTERM")).toBeGreaterThan(
          test.listeners.term,
        );
        expect(process.emit(signal)).toBe(true);
        await expectCancellation(test.running);
        await Promise.all(test.pids.map(expectExited));
        expect(existsSync(test.cwd)).toBe(false);
        expect(sourceState(test.repository)).toBe(test.source);
        expect(process.listenerCount("SIGINT")).toBe(test.listeners.int);
        expect(process.listenerCount("SIGTERM")).toBe(test.listeners.term);
      } finally {
        await killStartedProcesses(test.pids);
        await test.running.catch(() => undefined);
      }
    },
    10_000,
  );

  it("cancels gate's owned runChecks and removes the index snapshot", async () => {
    const test = fixture();
    process.env.FROGIE_CLI_PID_FILE = test.pidFile;
    process.env.FROGIE_CLI_CHILD_FILE = test.childFile;
    const controller = new AbortController();
    const source = sourceState(test.repository);
    let pids: number[] = [];
    let snapshot = "";
    const running = gate("index", test.repository, "", {
      signal: controller.signal,
    });
    void running.catch(() => undefined);
    try {
      await waitForFile(test.pidFile);
      const started = JSON.parse(readFileSync(test.pidFile, "utf8")) as {
        pids: number[];
        cwd: string;
      };
      pids = started.pids;
      snapshot = started.cwd;
      await waitForFile(test.childFile);
      controller.abort(new Error("cancel lifecycle test"));
      await expectCancellation(running);
      await Promise.all(pids.map(expectExited));
      expect(existsSync(snapshot)).toBe(false);
      expect(sourceState(test.repository)).toBe(source);
    } finally {
      await killStartedProcesses(pids);
      await running.catch(() => undefined);
    }
  }, 10_000);
});
