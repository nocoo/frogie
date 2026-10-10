import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gate, main } from "./cli.js";

const temporaryRoots: string[] = [];
const expectedCalls = [
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
];

function write(root: string, path: string, content: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function commit(repository: string, message: string): string {
  git(
    repository,
    "-c",
    "user.name=Gate Test",
    "-c",
    "user.email=gate-test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    message,
  );
  return git(repository, "rev-parse", "HEAD");
}

function pushLine(sha: string, name = "main"): string {
  return `refs/heads/${name} ${sha} refs/heads/${name} ${"0".repeat(40)}\n`;
}

function tree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(path: string): void {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) result[path] = `link:${readlinkSync(absolute)}`;
    else if (stat.isDirectory()) {
      result[path] = "directory";
      for (const name of readdirSync(absolute).sort()) {
        if (path === "" && name === ".git") continue;
        visit(path ? `${path}/${name}` : name);
      }
    } else result[path] = readFileSync(absolute).toString("base64");
  }
  visit("");
  return result;
}

function fixture(healthy: boolean): { repository: string; log: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "frogie-cli-test-")));
  temporaryRoots.push(root);
  const repository = join(root, "repository");
  const log = join(root, "calls.tsv");
  write(repository, ".gitignore", "node_modules/\ncoverage/\n");
  write(
    repository,
    "package.json",
    JSON.stringify({ name: "frogie", private: true }),
  );
  write(
    repository,
    "packages/core/package.json",
    JSON.stringify({ name: "@frogie/core", main: "index.cjs" }),
  );
  write(
    repository,
    "apps/dashboard/package.json",
    JSON.stringify({
      name: "@frogie/dashboard",
      dependencies: { "@frogie/core": "workspace:*" },
    }),
  );
  write(
    repository,
    "apps/daemon/package.json",
    JSON.stringify({ name: "@frogie/daemon" }),
  );
  const lock = "lockfileVersion: '9.0'\nimporters: {}\n";
  write(repository, "pnpm-lock.yaml", lock);
  write(repository, "node_modules/.pnpm/lock.yaml", lock);
  write(
    repository,
    "packages/core/index.cjs",
    `module.exports = ${JSON.stringify(healthy ? "staged healthy" : "staged broken")};\n`,
  );
  mkdirSync(join(repository, "apps/daemon/node_modules"), { recursive: true });
  mkdirSync(join(repository, "packages/core/node_modules"), {
    recursive: true,
  });
  mkdirSync(join(repository, "apps/dashboard/node_modules/@frogie"), {
    recursive: true,
  });
  symlinkSync(
    join(repository, "packages/core"),
    join(repository, "apps/dashboard/node_modules/@frogie/core"),
  );
  for (const tool of ["tsc", "biome", "vitest", "vite"]) {
    const executable = join("node_modules/.bin", tool);
    const path = join(repository, executable);
    write(
      repository,
      executable,
      `#!/bin/sh
set -eu
core=$(cat '${tool === "vite" ? "node_modules" : "apps/dashboard/node_modules"}/@frogie/core/index.cjs')
core=\${core#*\\"}
core=\${core%\\"*}
args=''
for arg do
  args="$args\t$arg"
done
printf '%s\\t%s\\t%s%s\\n' '${tool}' "$PWD" "$core" "$args" >> '${log.replaceAll("'", "'\\''")}'
${tool === "tsc" ? '[ "$core" != "staged broken" ] || exit 2' : ""}
${tool === "vite" ? '[ "$core" != "build broken" ] || exit 3' : ""}
${tool === "vitest" ? `mkdir -p coverage\nprintf '%s' '{"numTotalTests":1,"numPassedTests":1,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"success":true}' > coverage/vitest.json` : ""}
`,
    );
    chmodSync(path, 0o755);
  }
  git(repository, "init", "-q");
  git(repository, "add", ".");
  return { repository, log };
}

function calls(
  log: string,
): { tool: string; args: string[]; cwd: string; core: string }[] {
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const [tool, cwd, core, ...args] = line.split("\t");
      if (tool === undefined || cwd === undefined || core === undefined)
        throw new Error("Malformed tool invocation log");
      return { tool, args, cwd, core };
    });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("main", () => {
  it("runs index checks for an explicitly supplied repository", async () => {
    const { repository, log } = fixture(true);
    await expect(main(["index", repository], "")).resolves.toBeUndefined();
    expect(
      calls(log)
        .map(({ tool, args }) => [tool, ...args])
        .sort(),
    ).toEqual([...expectedCalls].sort());
  });

  it("passes pre-push input to commit checks and build", async () => {
    const { repository, log } = fixture(true);
    const sha = commit(repository, "Main push snapshot");
    await expect(
      main(["push", repository], pushLine(sha)),
    ).resolves.toBeUndefined();
    const recorded = calls(log);
    expect(recorded.map(({ tool, args }) => [tool, ...args]).sort()).toEqual(
      [...expectedCalls, ["vite", "build"]].sort(),
    );
    expect(recorded.find((call) => call.tool === "vite")?.cwd).toBe(
      join(
        recorded.find((call) => call.tool === "tsc")?.cwd ?? "",
        "apps/dashboard",
      ),
    );
  });

  it("uses the current directory when the repository argument is omitted", async () => {
    const { repository, log } = fixture(true);
    vi.spyOn(process, "cwd").mockReturnValue(repository);
    await expect(main(["index"], "")).resolves.toBeUndefined();
    expect(
      calls(log)
        .map(({ tool, args }) => [tool, ...args])
        .sort(),
    ).toEqual([...expectedCalls].sort());
  });

  it("propagates a staged check failure instead of resolving", async () => {
    const { repository, log } = fixture(false);
    await expect(main(["index", repository], "")).rejects.toThrow();
    expect(calls(log).find((call) => call.tool === "tsc")?.core).toBe(
      "staged broken",
    );
  });

  it("returns successfully for push without target SHAs", async () => {
    const { repository, log } = fixture(true);
    await expect(main(["push", repository], "")).resolves.toBeUndefined();
    expect(existsSync(log)).toBe(false);
  });

  it.each([
    [],
    ["invalid"],
    ["INDEX"],
    ["index", "repository", "extra"],
    ["push", "repository", "extra"],
  ])("rejects invalid arguments %j", async (...argv) => {
    await expect(main(argv, "")).rejects.toThrow();
  });
});

describe("gate", () => {
  function assertPushChecks(
    recorded: ReturnType<typeof calls>,
    core: string,
  ): void {
    const l1 = recorded.filter((call) => call.tool !== "vite");
    const build = recorded.filter((call) => call.tool === "vite");
    expect(l1.map(({ tool, args }) => [tool, ...args]).sort()).toEqual(
      [...expectedCalls].sort(),
    );
    expect(build).toHaveLength(1);
    expect(build[0]?.args).toEqual(["build"]);
    expect(build[0]?.cwd).toBe(join(l1[0]?.cwd ?? "", "apps/dashboard"));
    expect(recorded.every((call) => call.core === core)).toBe(true);
    expect(recorded.every((call) => !existsSync(call.cwd))).toBe(true);
  }

  it("checks a healthy pushed commit with L1 and a dashboard build from the snapshot", async () => {
    const { repository, log } = fixture(true);
    const sha = commit(repository, "Healthy snapshot");
    const before = tree(repository);
    const index = readFileSync(join(repository, ".git/index"));
    await expect(
      gate("push", repository, pushLine(sha)),
    ).resolves.toBeUndefined();
    assertPushChecks(calls(log), "staged healthy");
    expect(tree(repository)).toEqual(before);
    expect(readFileSync(join(repository, ".git/index"))).toEqual(index);
  });

  it("checks the pushed old commit instead of newer HEAD, index or working-tree content", async () => {
    const { repository, log } = fixture(true);
    const old = commit(repository, "Old healthy snapshot");
    write(
      repository,
      "packages/core/index.cjs",
      'module.exports = "staged broken";\n',
    );
    git(repository, "add", "packages/core/index.cjs");
    commit(repository, "New broken snapshot");
    write(
      repository,
      "packages/core/index.cjs",
      'module.exports = "index-only change";\n',
    );
    git(repository, "add", "packages/core/index.cjs");
    write(
      repository,
      "packages/core/index.cjs",
      'module.exports = "working-tree-only change";\n',
    );
    const before = tree(repository);
    const index = readFileSync(join(repository, ".git/index"));
    await expect(
      gate("push", repository, pushLine(old)),
    ).resolves.toBeUndefined();
    assertPushChecks(calls(log), "staged healthy");
    expect(tree(repository)).toEqual(before);
    expect(readFileSync(join(repository, ".git/index"))).toEqual(index);
  });

  it("rejects a pushed broken commit despite a repaired working tree", async () => {
    const { repository, log } = fixture(false);
    const sha = commit(repository, "Broken snapshot");
    write(
      repository,
      "packages/core/index.cjs",
      'module.exports = "unstaged repaired";\n',
    );
    const before = tree(repository);
    await expect(gate("push", repository, pushLine(sha))).rejects.toThrow();
    const recorded = calls(log);
    expect(recorded.find((call) => call.tool === "tsc")?.core).toBe(
      "staged broken",
    );
    expect(recorded.every((call) => !existsSync(call.cwd))).toBe(true);
    expect(tree(repository)).toEqual(before);
  });

  it("checks each distinct local SHA once across multiple refs and mixed deletion lines", async () => {
    const { repository, log } = fixture(true);
    const first = commit(repository, "First snapshot");
    write(
      repository,
      "packages/core/index.cjs",
      'module.exports = "second healthy";\n',
    );
    git(repository, "add", "packages/core/index.cjs");
    const second = commit(repository, "Second snapshot");
    const input =
      pushLine(first) +
      pushLine(first, "duplicate") +
      `(delete) ${"0".repeat(40)} refs/heads/removed ${first}\n` +
      pushLine(second, "next");
    await expect(gate("push", repository, input)).resolves.toBeUndefined();
    const recorded = calls(log);
    expect(recorded).toHaveLength(8);
    assertPushChecks(
      recorded.filter((call) => call.core === "staged healthy"),
      "staged healthy",
    );
    assertPushChecks(
      recorded.filter((call) => call.core === "second healthy"),
      "second healthy",
    );
    const roots = recorded
      .filter((call) => call.tool === "tsc")
      .map((call) => call.cwd);
    expect(new Set(roots).size).toBe(2);
  });

  it("rejects a dashboard build failure even when all L1 checks pass", async () => {
    const { repository, log } = fixture(true);
    write(
      repository,
      "packages/core/index.cjs",
      'module.exports = "build broken";\n',
    );
    git(repository, "add", "packages/core/index.cjs");
    const sha = commit(repository, "Broken build snapshot");
    await expect(gate("push", repository, pushLine(sha))).rejects.toThrow();
    assertPushChecks(calls(log), "build broken");
  });

  it.each([
    ["malformed SHA", "not-a-sha"],
    ["unknown SHA", "f".repeat(40)],
  ])(
    "rejects %s without running tools or modifying source",
    async (_case, sha) => {
      const { repository, log } = fixture(true);
      commit(repository, "Healthy snapshot");
      const before = tree(repository);
      const index = readFileSync(join(repository, ".git/index"));
      await expect(gate("push", repository, pushLine(sha))).rejects.toThrow();
      expect(existsSync(log)).toBe(false);
      expect(tree(repository)).toEqual(before);
      expect(readFileSync(join(repository, ".git/index"))).toEqual(index);
    },
  );

  it("rejects a staged typecheck failure even when the working-tree Core is repaired", async () => {
    const { repository, log } = fixture(false);
    write(
      repository,
      "packages/core/index.cjs",
      'module.exports = "unstaged repaired";\n',
    );
    const before = tree(repository);
    const index = readFileSync(join(repository, ".git/index"));
    await expect(gate("index", repository)).rejects.toThrow();
    const recorded = calls(log);
    expect(recorded.find((call) => call.tool === "tsc")?.core).toBe(
      "staged broken",
    );
    expect(recorded.every((call) => call.cwd !== repository)).toBe(true);
    expect(recorded.every((call) => !existsSync(call.cwd))).toBe(true);
    expect(tree(repository)).toEqual(before);
    expect(readFileSync(join(repository, ".git/index"))).toEqual(index);
  });

  it("checks a healthy index with all three tools and removes its snapshot without changing source or index", async () => {
    const { repository, log } = fixture(true);
    write(
      repository,
      "packages/core/index.cjs",
      'module.exports = "unstaged broken";\n',
    );
    write(repository, "untracked.txt", "not in the snapshot\n");
    const before = tree(repository);
    const index = readFileSync(join(repository, ".git/index"));
    await expect(gate("index", repository)).resolves.toBeUndefined();
    const recorded = calls(log);
    expect(recorded.map(({ tool, args }) => [tool, ...args]).sort()).toEqual(
      [...expectedCalls].sort(),
    );
    expect(recorded.every((call) => call.core === "staged healthy")).toBe(true);
    expect(new Set(recorded.map((call) => call.cwd)).size).toBe(1);
    expect(recorded[0]?.cwd).not.toBe(repository);
    expect(recorded.every((call) => !existsSync(call.cwd))).toBe(true);
    expect(tree(repository)).toEqual(before);
    expect(readFileSync(join(repository, ".git/index"))).toEqual(index);
  });

  it.each([
    ["empty input", ""],
    [
      "only deleted refs",
      `(delete) ${"0".repeat(40)} refs/heads/old ${"a".repeat(40)}\n`,
    ],
  ])(
    "does nothing for push with %s, even without installed dependencies",
    async (_case, input) => {
      const { repository, log } = fixture(true);
      for (const workspace of [
        "",
        "packages/core",
        "apps/dashboard",
        "apps/daemon",
      ])
        rmSync(join(repository, workspace, "node_modules"), {
          recursive: true,
        });
      const before = tree(repository);
      const index = readFileSync(join(repository, ".git/index"));
      await expect(gate("push", repository, input)).resolves.toBeUndefined();
      expect(existsSync(log)).toBe(false);
      expect(tree(repository)).toEqual(before);
      expect(readFileSync(join(repository, ".git/index"))).toEqual(index);
    },
  );
});
