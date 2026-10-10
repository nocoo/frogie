import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { runChecks } from "./check.js";

const workspaces = ["", "packages/core", "apps/dashboard", "apps/daemon"];

export async function runL1(
  directory: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  const report = join(directory, "coverage/vitest.json");
  rmSync(report, { force: true });
  const commands = [
    ["tsc", "--noEmit"],
    ["biome", "check", ".", "--error-on-warnings"],
    [
      "vitest",
      "run",
      "--coverage",
      "--reporter=default",
      "--reporter=json",
      "--outputFile=coverage/vitest.json",
    ],
  ].map(([command, ...args]) => [
    join(directory, "node_modules/.bin", command as string),
    ...args,
  ]);
  await runChecks(commands, {
    cwd: directory,
    timeoutMs: options.timeoutMs ?? 30_000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  verifyTestReport(report);
}

export async function prepareSnapshot(
  repository: string,
  directory: string,
): Promise<void> {
  const identical = (source: string, target: string) => {
    if (!readFileSync(source).equals(readFileSync(target)))
      throw new Error(`Dependency metadata differs: ${target}`);
  };
  identical(
    join(repository, "node_modules/.pnpm/lock.yaml"),
    join(directory, "pnpm-lock.yaml"),
  );
  for (const workspace of workspaces)
    identical(
      join(repository, workspace, "package.json"),
      join(directory, workspace, "package.json"),
    );
  const localPackages = new Map(
    workspaces.map((workspace) => [
      realpathSync(join(repository, workspace)),
      join(directory, workspace),
    ]),
  );
  function linkModules(source: string, target: string) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if ([".cache", ".vite", ".vite-temp"].includes(entry.name)) continue;
      const from = join(source, entry.name);
      const to = join(target, entry.name);
      if (entry.name.startsWith("@") && entry.isDirectory())
        linkModules(from, to);
      else if (entry.name === ".bin") cpSync(from, to, { recursive: true });
      else {
        const resolved = realpathSync(from);
        symlinkSync(localPackages.get(resolved) ?? resolved, to);
      }
    }
  }
  for (const workspace of workspaces)
    linkModules(
      join(repository, workspace, "node_modules"),
      join(directory, workspace, "node_modules"),
    );
}

export function verifyTestReport(file: string): void {
  const report: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (report === null || typeof report !== "object" || Array.isArray(report))
    throw new Error("Invalid test report");
  const values = report as Record<string, unknown>;
  if (
    !Number.isSafeInteger(values.numTotalTests) ||
    (values.numTotalTests as number) <= 0 ||
    values.numPassedTests !== values.numTotalTests ||
    values.numFailedTests !== 0 ||
    values.numPendingTests !== 0 ||
    values.numTodoTests !== 0 ||
    values.success !== true
  )
    throw new Error("The complete nonempty test suite must pass without skips");
}

export function pushTargets(input: string): string[] {
  const targets = new Set<string>();
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    const local = fields[1];
    const remote = fields[3];
    const sha = /^(?:[\da-f]{40}|[\da-f]{64})$/i;
    if (
      fields.length !== 4 ||
      !local ||
      !remote ||
      !sha.test(local) ||
      !sha.test(remote)
    )
      throw new Error("Invalid pre-push input");
    if (!/^0+$/.test(local)) targets.add(local);
  }
  return [...targets];
}
