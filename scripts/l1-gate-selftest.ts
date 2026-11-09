import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureEnv, git } from "../tests/fixtures/git.js";
import { prepareSnapshot } from "./gate.js";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const probeSource = "packages/core/src/l1-gate-probe.ts";
const probeTest = "packages/core/src/l1-gate-probe.test.ts";

export type ProbeOutcome = {
  readonly name: string;
  readonly expectedSuccess: boolean;
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly reason?: string;
};

type ProbeCase = {
  readonly name: string;
  readonly expectedSuccess: boolean;
  readonly apply: (repository: string) => void | Promise<void>;
  readonly beforeHook?: (repository: string) => void;
};

const probeVitestConfig = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/core/src/l1-gate-probe.test.ts"],
    allowOnly: false,
    passWithNoTests: false,
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      include: ["packages/core/src/l1-gate-probe.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
`;

const probeBiomeWarningConfig = `{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "files": { "includes": ["**"] },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "useConst": "warn"
      }
    }
  }
}
`;

function writeRepoFile(
  repository: string,
  path: string,
  content: string,
): void {
  const file = join(repository, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function runHook(repository: string): ReturnType<typeof spawnSync> {
  return spawnSync("/bin/sh", [join(repository, ".husky/pre-commit")], {
    cwd: repository,
    env: fixtureEnv(),
    encoding: "utf8",
    input: "",
    timeout: 120_000,
  });
}

async function linkDependencies(
  source: string,
  repository: string,
): Promise<void> {
  await prepareSnapshot(source, repository);
}

async function createRepository(): Promise<{
  repository: string;
  dispose: () => void;
}> {
  const owned = mkdtempSync(join(tmpdir(), "frogie-l1-gate-owned-"));
  const repository = join(owned, "repository");
  mkdirSync(repository);
  const source = git(sourceRoot, "rev-parse", "--show-toplevel");
  git(source, "worktree", "add", "--detach", repository, "HEAD");
  git(repository, "config", "core.hooksPath", ".husky");
  await linkDependencies(source, repository);
  const dispose = () => {
    try {
      git(source, "worktree", "remove", "-f", repository);
    } catch {
      /* best effort */
    }
    rmSync(owned, { recursive: true, force: true });
  };
  return { repository, dispose };
}

function restoreTooling(repository: string): void {
  for (const tool of ["tsc", "biome", "vitest"]) {
    const target = join(repository, "node_modules/.bin", tool);
    const source = join(sourceRoot, "node_modules/.bin", tool);
    if (!existsSync(source)) continue;
    cpSync(source, target);
    chmodSync(target, 0o755);
  }
}

function resetRepository(repository: string): void {
  git(repository, "reset", "--hard", "HEAD");
  git(repository, "clean", "-fd");
  restoreTooling(repository);
}

function healthySource(): string {
  return `export function l1GateProbe(value: string): string {
  return value.trim().length > 0 ? value : "empty";
}
`;
}

function healthyTest(): string {
  return `import { describe, expect, it } from "vitest";
import { l1GateProbe } from "./l1-gate-probe";

describe("l1 gate probe", () => {
  it("covers the helper", () => {
    expect(l1GateProbe("ok")).toBe("ok");
    expect(l1GateProbe("  spaced  ")).toBe("  spaced  ");
    expect(l1GateProbe("")).toBe("empty");
  });
});
`;
}

function stageProbeConfig(repository: string, biome: boolean): void {
  writeRepoFile(repository, "vitest.config.ts", probeVitestConfig);
  git(repository, "add", "--", "vitest.config.ts");
  if (biome) {
    writeRepoFile(repository, "biome.json", probeBiomeWarningConfig);
    git(repository, "add", "--", "biome.json");
  }
}

function stageProbe(
  repository: string,
  source: string,
  test: string,
  options: { biome?: boolean } = {},
): void {
  stageProbeConfig(repository, options.biome === true);
  writeRepoFile(repository, probeSource, source);
  writeRepoFile(repository, probeTest, test);
  git(repository, "add", "--", probeSource, probeTest);
}

const probes: readonly ProbeCase[] = [
  {
    name: "healthy staged snapshot",
    expectedSuccess: true,
    apply(repository) {
      stageProbe(repository, healthySource(), healthyTest());
    },
  },
  {
    name: "failing unit assertion",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        healthySource(),
        healthyTest().replace(
          'expect(l1GateProbe("ok")).toBe("ok");',
          'expect(l1GateProbe("ok")).toBe("broken");',
        ),
      );
    },
  },
  {
    name: "statements coverage below floor",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        `${healthySource()}export function uncoveredStatementSink(): number {
  return 1;
}
`,
        healthyTest(),
      );
    },
  },
  {
    name: "branches coverage below floor",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        `export function l1GateProbe(value: string): string {
  if (value.length % 2 === 0) return value;
  return value.slice(1);
}
export function untouchedBranchSink(flag: boolean): string {
  return flag ? "yes" : "no";
}
`,
        `import { describe, expect, it } from "vitest";
import { l1GateProbe } from "./l1-gate-probe";

describe("l1 gate probe", () => {
  it("hits even length only", () => {
    expect(l1GateProbe("even")).toBe("even");
  });
});
`,
      );
    },
  },
  {
    name: "functions coverage below floor",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        `${healthySource()}export function uncoveredFunctionSink(): void {}
`,
        healthyTest(),
      );
    },
  },
  {
    name: "lines coverage below floor",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        `${healthySource()}export function uncoveredLineSink(): number {
  const first = 1;
  const second = 2;
  const third = 3;
  return first + second + third;
}
`,
        healthyTest(),
      );
    },
  },
  {
    name: "lint error",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        healthySource(),
        `${healthyTest()}\nconst broken = { a: 1,, b: 2 };\n`,
      );
    },
  },
  {
    name: "lint warning only",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        healthySource(),
        `${healthyTest()}\nlet warningOnly = "lint";\n`,
        { biome: true },
      );
    },
  },
  {
    name: "type error",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        `export function l1GateProbe(value: string): number {
  return value.length;
}
`,
        healthyTest(),
      );
    },
  },
  {
    name: "focused test",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        healthySource(),
        healthyTest().replace("  it(", "  it.only("),
      );
    },
  },
  {
    name: "skipped test",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        healthySource(),
        healthyTest().replace("  it(", "  it.skip("),
      );
    },
  },
  {
    name: "staged break with unstaged repair",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        `export function l1GateProbe(value: string): number {
  return value.length;
}
`,
        healthyTest(),
      );
      writeRepoFile(repository, probeSource, healthySource());
    },
  },
  {
    name: "timeout",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(
        repository,
        healthySource(),
        `${healthyTest()}

describe("l1 gate hang", () => {
  it("runs until the hook timeout", async () => {
    await new Promise(() => {});
  });
});
`,
      );
    },
  },
  {
    name: "missing required tool",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(repository, healthySource(), healthyTest());
    },
    beforeHook(repository) {
      rmSync(join(repository, "node_modules/.bin/vitest"));
    },
  },
  {
    name: "missing coverage report",
    expectedSuccess: false,
    apply(repository) {
      stageProbe(repository, healthySource(), healthyTest());
      const gate = readFileSync(
        join(repository, "scripts/gate.ts"),
        "utf8",
      ).replace('      "--outputFile=coverage/vitest.json",\n', "");
      writeRepoFile(repository, "scripts/gate.ts", gate);
      git(repository, "add", "--", "scripts/gate.ts");
    },
  },
];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function indexPath(repository: string): string {
  const gitDir = git(repository, "rev-parse", "--git-dir");
  const absolute = gitDir.startsWith("/") ? gitDir : join(repository, gitDir);
  return join(absolute, "index");
}

async function runProbe(
  repository: string,
  probe: ProbeCase,
): Promise<ProbeOutcome> {
  resetRepository(repository);
  await probe.apply(repository);
  probe.beforeHook?.(repository);
  const indexBefore = readFileSync(indexPath(repository));
  const result = runHook(repository);
  assert(
    readFileSync(indexPath(repository)).equals(indexBefore),
    `probe ${probe.name} must not mutate the index`,
  );
  const success = result.status === 0 && result.signal === null;
  if (success !== probe.expectedSuccess) {
    return {
      name: probe.name,
      expectedSuccess: probe.expectedSuccess,
      status: result.status,
      signal: result.signal,
      reason: `expected ${probe.expectedSuccess ? "success" : "rejection"} but received status=${result.status} signal=${result.signal}\n${result.stderr}`,
    };
  }
  return {
    name: probe.name,
    expectedSuccess: probe.expectedSuccess,
    status: result.status,
    signal: result.signal,
  };
}

async function runInterruptProbe(repository: string): Promise<ProbeOutcome> {
  resetRepository(repository);
  stageProbe(repository, healthySource(), healthyTest());
  return await new Promise((resolve) => {
    const child = spawn("/bin/sh", [join(repository, ".husky/pre-commit")], {
      cwd: repository,
      env: fixtureEnv(),
      stdio: "ignore",
      detached: true,
    });
    const timer = setTimeout(() => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGINT");
        } catch {
          child.kill("SIGINT");
        }
      }
    }, 500);
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      const ok =
        status === 130 ||
        status === 143 ||
        signal === "SIGINT" ||
        signal === "SIGTERM";
      resolve(
        ok
          ? {
              name: "interrupt",
              expectedSuccess: false,
              status,
              signal,
            }
          : {
              name: "interrupt",
              expectedSuccess: false,
              status,
              signal,
              reason: `expected interrupt exit but received status=${status} signal=${signal}`,
            },
      );
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({
        name: "interrupt",
        expectedSuccess: false,
        status: null,
        signal: null,
        reason: error.message,
      });
    });
  });
}

export async function runL1GateSelftest(): Promise<ProbeOutcome[]> {
  const { repository, dispose } = await createRepository();
  const outcomes: ProbeOutcome[] = [];
  try {
    for (const probe of probes) {
      outcomes.push(await runProbe(repository, probe));
    }
    outcomes.push(await runInterruptProbe(repository));
    const failed = outcomes.filter((probe) => probe.reason);
    if (failed.length) {
      throw new Error(
        failed.map((probe) => `${probe.name}: ${probe.reason}`).join("\n"),
      );
    }
    return outcomes;
  } finally {
    dispose();
  }
}
