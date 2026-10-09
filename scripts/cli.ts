import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { materializeIndex, runChecks } from "./check.js";
import { prepareSnapshot, pushTargets, runL1 } from "./gate.js";

export async function main(argv: string[], input: string): Promise<void> {
  const [mode, repository = process.cwd()] = argv;
  if ((mode !== "index" && mode !== "push") || argv.length > 2)
    throw new Error("Usage: check <index|push> [repository]");
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Quality check aborted"));
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    await gate(mode, repository, input, { signal: controller.signal });
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

export async function gate(
  mode: "index" | "push",
  repository: string,
  input = "",
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  if (mode === "push") {
    for (const sha of pushTargets(input)) {
      const temporary = mkdtempSync(join(tmpdir(), "frogie-push-"));
      const directory = join(temporary, "snapshot");
      const env = { ...process.env, GIT_INDEX_FILE: join(temporary, "index") };
      try {
        execFileSync("git", ["read-tree", `${sha}^{commit}`], {
          cwd: repository,
          env,
          stdio: "pipe",
        });
        execFileSync(
          "git",
          ["checkout-index", "--all", `--prefix=${directory}${sep}`],
          { cwd: repository, env, stdio: "pipe" },
        );
        await prepareSnapshot(repository, directory);
        await runL1(directory, options);
        await runChecks(
          [[join(directory, "node_modules/.bin/vite"), "build"]],
          {
            cwd: join(directory, "apps/dashboard"),
            timeoutMs: 180_000,
            ...options,
          },
        );
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
    return;
  }
  const snapshot = materializeIndex(repository);
  try {
    await prepareSnapshot(repository, snapshot.directory);
    await runL1(snapshot.directory, options);
  } finally {
    snapshot.dispose();
  }
}
