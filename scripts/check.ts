import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

export interface CheckOptions {
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function runChecks(
  commands: readonly (readonly string[])[],
  options: CheckOptions,
): Promise<void> {
  if (
    !commands.length ||
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0
  ) {
    throw new Error("Checks and a positive timeout are required");
  }
  for (const [command, ...args] of commands) {
    if (!command) throw new Error("An executable is required");
    options.signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: "inherit",
        detached: true,
      });
      let failure: Error | undefined;
      let terminated = false;
      const terminate = () => {
        if (!child.pid || terminated) return;
        try {
          process.kill(-child.pid, "SIGKILL");
          terminated = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH")
            failure = error as Error;
        }
      };
      const abort = () => {
        failure = new Error(`${command} aborted`);
        terminate();
      };
      const timer = setTimeout(() => {
        failure = new Error(`${command} timed out`);
        terminate();
      }, options.timeoutMs);
      options.signal?.addEventListener("abort", abort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        terminate();
      };
      child.once("error", (error) => {
        cleanup();
        reject(error);
      });
      child.once("close", (code, signal) => {
        cleanup();
        if (failure) reject(failure);
        else if (code !== 0)
          reject(new Error(`${command} failed: ${signal ?? code}`));
        else resolve();
      });
    });
  }
}

export function materializeIndex(repo: string): {
  directory: string;
  dispose(): void;
} {
  const directory = mkdtempSync(join(tmpdir(), "frogie-index-"));
  const dispose = () => rmSync(directory, { recursive: true, force: true });
  try {
    execFileSync(
      "git",
      ["checkout-index", "--all", `--prefix=${directory}${sep}`],
      {
        cwd: repo,
        stdio: "pipe",
      },
    );
    return { directory, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
