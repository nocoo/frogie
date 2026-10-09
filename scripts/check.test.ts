import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeIndex, runChecks } from "./check.js";

const temporaryRoots: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

function git(repository: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: repository, stdio: "ignore" });
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(existsSync(path)).toBe(true);
}

async function expectProcessExited(pid: number): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(() => process.kill(pid, 0)).toThrow();
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runChecks", () => {
  it("resolves when a real command exits successfully", async () => {
    await expect(
      runChecks([[process.execPath, "-e", "process.exit(0)"]], {
        cwd: process.cwd(),
        timeoutMs: 2_000,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects when a real command exits nonzero", async () => {
    await expect(
      runChecks([[process.execPath, "-e", "process.exit(7)"]], {
        cwd: process.cwd(),
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow(/exit|code|status|7/i);
  });

  it("aborts and reaps the command and its child process", async () => {
    const directory = temporaryDirectory("frogie-check-abort-");
    const pidFile = join(directory, "pids");
    const controller = new AbortController();
    const script = `
      const { spawn } = require("node:child_process");
      const fs = require("node:fs");
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      fs.writeFileSync(process.env.PID_FILE, [process.pid, child.pid].join("\\n"));
      setInterval(() => {}, 1000);
    `;
    const check = runChecks([[process.execPath, "-e", script]], {
      cwd: directory,
      timeoutMs: 1_500,
      env: { ...process.env, PID_FILE: pidFile },
      signal: controller.signal,
    });

    try {
      await waitForFile(pidFile);
      controller.abort();
      await expect(check).rejects.toThrow(/abort|cancel/i);
      const pids = readFileSync(pidFile, "utf8")
        .trim()
        .split("\\n")
        .map(Number);
      for (const pid of pids) await expectProcessExited(pid);
    } finally {
      controller.abort();
      const pids = existsSync(pidFile)
        ? readFileSync(pidFile, "utf8").trim().split("\\n").map(Number)
        : [];
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      await Promise.all(pids.map(expectProcessExited));
      await check.catch(() => undefined);
    }
  });

  it.each([
    ["no commands", [], 100, /command|check/i],
    ["a zero timeout", [[process.execPath]], 0, /timeout/i],
    ["a negative timeout", [[process.execPath]], -1, /timeout/i],
    ["a non-finite timeout", [[process.execPath]], Number.NaN, /timeout/i],
    ["an empty executable", [[""]], 100, /executable|command/i],
  ])(
    "rejects %s before spawning",
    async (_case, commands, timeoutMs, message) => {
      await expect(
        runChecks(commands, { cwd: process.cwd(), timeoutMs }),
      ).rejects.toThrow(message);
    },
  );

  it("rejects a command that cannot be executed", async () => {
    const directory = temporaryDirectory("frogie-check-permission-");
    const executable = join(directory, "not-executable");
    writeFileSync(executable, "exit 0\n");
    chmodSync(executable, 0o644);
    await expect(
      runChecks([[executable]], { cwd: directory, timeoutMs: 1_000 }),
    ).rejects.toThrow(/permission|access|eacces/i);
  });

  it("passes the supplied environment to the real command", async () => {
    const directory = temporaryDirectory("frogie-check-env-");
    const resultFile = join(directory, "value");
    await runChecks(
      [
        [
          process.execPath,
          "-e",
          "require('node:fs').writeFileSync('value', process.env.CHECK_VALUE)",
        ],
      ],
      {
        cwd: directory,
        timeoutMs: 1_000,
        env: { CHECK_VALUE: "provided" },
      },
    );
    expect(readFileSync(resultFile, "utf8")).toBe("provided");
  });

  it("does not run later commands after a failure", async () => {
    const directory = temporaryDirectory("frogie-check-order-");
    const marker = join(directory, "ran");
    await expect(
      runChecks(
        [
          [process.execPath, "-e", "process.exit(2)"],
          [
            process.execPath,
            "-e",
            "require('node:fs').writeFileSync('ran', 'yes')",
          ],
        ],
        { cwd: directory, timeoutMs: 1_000 },
      ),
    ).rejects.toThrow();
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects a process terminated by a signal", async () => {
    await expect(
      runChecks(
        [[process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"]],
        { cwd: process.cwd(), timeoutMs: 1_000 },
      ),
    ).rejects.toThrow(/SIGTERM|signal|failed/i);
  });

  it("kills descendants when a command times out", async () => {
    const directory = temporaryDirectory("frogie-check-tree-");
    const pidFile = join(directory, "pids");
    const script = `
      const { spawn } = require("node:child_process");
      const fs = require("node:fs");
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      fs.writeFileSync(process.env.PID_FILE, [process.pid, child.pid].join("\\n"));
      setInterval(() => {}, 1000);
    `;
    await expect(
      runChecks([[process.execPath, "-e", script]], {
        cwd: directory,
        timeoutMs: 1_000,
        env: { ...process.env, PID_FILE: pidFile },
      }),
    ).rejects.toThrow(/timed? ?out|timeout|exceed/i);
    const pids = readFileSync(pidFile, "utf8").trim().split("\n").map(Number);
    for (const pid of pids) await expectProcessExited(pid);
  });

  it("rejects on timeout after terminating the real child process", async () => {
    const directory = mkdtempSync(join(tmpdir(), "frogie-check-timeout-"));
    temporaryRoots.push(directory);
    const pidFile = join(directory, "child.pid");
    const script = "setInterval(() => {}, 1000)";

    await expect(
      runChecks(
        [
          [
            "/bin/sh",
            "-c",
            'printf "%s" "$$" > "$1"; exec "$2" -e "$3"',
            "sh",
            pidFile,
            process.execPath,
            script,
          ],
        ],
        {
          cwd: directory,
          timeoutMs: 100,
        },
      ),
    ).rejects.toThrow(/timed? ?out|timeout|exceed/i);

    const childPid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(childPid, 0)).toThrow();
  });
});

describe("materializeIndex", () => {
  it("rejects a non-repository and removes its temporary directory", () => {
    const directory = temporaryDirectory("frogie-not-repo-");
    const before = new Set(
      readdirSync(tmpdir()).filter((name) => name.startsWith("frogie-index-")),
    );
    expect(() => materializeIndex(directory)).toThrow();
    const after = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("frogie-index-"),
    );
    expect(after.filter((name) => !before.has(name))).toEqual([]);
  });

  it("materializes the staged version and disposes the temporary snapshot", () => {
    const repository = temporaryDirectory("frogie-index-repo-");
    git(repository, "init", "-q");

    const file = join(repository, "quality.txt");
    writeFileSync(file, "staged broken version\n");
    git(repository, "add", "quality.txt");
    writeFileSync(file, "repaired working-tree version\n");
    writeFileSync(join(repository, "untracked.txt"), "not staged\n");

    const indexBefore = readFileSync(join(repository, ".git", "index"));
    const snapshot = materializeIndex(repository);
    try {
      expect(
        readFileSync(join(snapshot.directory, "quality.txt"), "utf8"),
      ).toBe("staged broken version\n");
      expect(existsSync(join(snapshot.directory, "untracked.txt"))).toBe(false);
      expect(readFileSync(file, "utf8")).toBe(
        "repaired working-tree version\n",
      );
      expect(readFileSync(join(repository, ".git", "index"))).toEqual(
        indexBefore,
      );
    } finally {
      snapshot.dispose();
    }
    expect(existsSync(snapshot.directory)).toBe(false);
  });
});
