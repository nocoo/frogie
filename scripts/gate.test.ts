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
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareSnapshot,
  pushTargets,
  runL1,
  verifyTestReport,
} from "./gate.js";

const temporaryRoots: string[] = [];
const manifests = [
  "package.json",
  "packages/core/package.json",
  "apps/dashboard/package.json",
  "apps/daemon/package.json",
] as const;
const lock = "lockfileVersion: '9.0'\nimporters: {}\n";

function temporaryDirectory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "frogie-gate-test-")));
  temporaryRoots.push(root);
  return root;
}

function write(root: string, path: string, content: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function tree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(path: string): void {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) result[path] = `link:${readlinkSync(absolute)}`;
    else if (stat.isDirectory()) {
      result[path] = "directory";
      for (const name of readdirSync(absolute).sort())
        visit(path ? `${path}/${name}` : name);
    } else result[path] = readFileSync(absolute).toString("base64");
  }
  visit("");
  return result;
}

function fixture(): { repository: string; directory: string } {
  const root = temporaryDirectory();
  const repository = join(root, "repository");
  const directory = join(root, "snapshot");
  const definitions = [
    { name: "frogie", private: true },
    {
      name: "@frogie/core",
      main: "index.cjs",
      dependencies: { external: "1.0.0" },
    },
    {
      name: "@frogie/dashboard",
      dependencies: { "@frogie/core": "workspace:*", external: "1.0.0" },
    },
    { name: "@frogie/daemon", private: true },
  ];
  for (const [index, path] of manifests.entries()) {
    const content = JSON.stringify(definitions[index]);
    write(repository, path, content);
    write(directory, path, content);
  }
  write(repository, "pnpm-lock.yaml", lock);
  write(directory, "pnpm-lock.yaml", lock);
  write(repository, "node_modules/.pnpm/lock.yaml", lock);
  write(
    repository,
    "node_modules/.pnpm/external@1.0.0/node_modules/external/package.json",
    JSON.stringify({ name: "external", main: "index.cjs" }),
  );
  write(
    repository,
    "node_modules/.pnpm/external@1.0.0/node_modules/external/index.cjs",
    'module.exports = "third-party";\n',
  );
  const external = join(
    repository,
    "node_modules/.pnpm/external@1.0.0/node_modules/external",
  );
  for (const workspace of [
    "",
    "packages/core",
    "apps/dashboard",
    "apps/daemon",
  ]) {
    mkdirSync(join(repository, workspace, "node_modules"), { recursive: true });
    symlinkSync(external, join(repository, workspace, "node_modules/external"));
  }
  mkdirSync(join(repository, "apps/dashboard/node_modules/@frogie"));
  symlinkSync(
    join(repository, "packages/core"),
    join(repository, "apps/dashboard/node_modules/@frogie/core"),
  );
  write(
    repository,
    "packages/core/index.cjs",
    'module.exports = "unstaged repaired core";\n',
  );
  write(
    directory,
    "packages/core/index.cjs",
    'module.exports = "staged broken core";\n',
  );
  return { repository, directory };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("prepareSnapshot", () => {
  it("copies executable .bin launchers into independent workspace directories", async () => {
    const { repository, directory } = fixture();
    for (const workspace of [
      "",
      "packages/core",
      "apps/dashboard",
      "apps/daemon",
    ]) {
      const path = join(workspace, "node_modules/.bin/local-tool");
      write(repository, path, '#!/bin/sh\nprintf "snapshot-tool"\n');
      chmodSync(join(repository, path), 0o755);
    }
    const before = tree(repository);
    await prepareSnapshot(repository, directory);
    for (const workspace of [
      "",
      "packages/core",
      "apps/dashboard",
      "apps/daemon",
    ]) {
      const source = join(
        repository,
        workspace,
        "node_modules/.bin/local-tool",
      );
      const target = join(directory, workspace, "node_modules/.bin/local-tool");
      expect(
        lstatSync(
          join(directory, workspace, "node_modules/.bin"),
        ).isSymbolicLink(),
      ).toBe(false);
      expect(realpathSync(target)).not.toBe(realpathSync(source));
      expect(execFileSync(target, [], { encoding: "utf8" })).toBe(
        "snapshot-tool",
      );
      writeFileSync(target, "snapshot-only edit\n");
      expect(readFileSync(source, "utf8")).toContain("snapshot-tool");
    }
    expect(tree(repository)).toEqual(before);
  });

  it("does not copy or link .cache, .vite or .vite-temp from any workspace", async () => {
    const { repository, directory } = fixture();
    for (const workspace of [
      "",
      "packages/core",
      "apps/dashboard",
      "apps/daemon",
    ]) {
      for (const cache of [".cache", ".vite"])
        write(
          repository,
          join(workspace, "node_modules", cache, "stale"),
          "working-tree cache\n",
        );
      symlinkSync(
        join(repository, workspace, "node_modules/.cache"),
        join(repository, workspace, "node_modules/.vite-temp"),
      );
    }
    const before = tree(repository);
    await prepareSnapshot(repository, directory);
    for (const workspace of [
      "",
      "packages/core",
      "apps/dashboard",
      "apps/daemon",
    ]) {
      const names = readdirSync(join(directory, workspace, "node_modules"));
      for (const cache of [".cache", ".vite", ".vite-temp"])
        expect(names).not.toContain(cache);
    }
    expect(tree(repository)).toEqual(before);
  });

  it("reuses third-party packages but resolves staged workspace code without changing the repository", async () => {
    const { repository, directory } = fixture();
    const before = tree(repository);
    await expect(
      prepareSnapshot(repository, directory),
    ).resolves.toBeUndefined();

    for (const workspace of [
      "",
      "packages/core",
      "apps/dashboard",
      "apps/daemon",
    ]) {
      const modules = join(directory, workspace, "node_modules");
      expect(realpathSync(modules)).toBe(modules);
      expect(realpathSync(join(modules, "external"))).toBe(
        realpathSync(join(repository, workspace, "node_modules/external")),
      );
    }
    expect(
      realpathSync(join(directory, "apps/dashboard/node_modules/@frogie/core")),
    ).toBe(join(directory, "packages/core"));
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        'const { createRequire } = require("node:module"); const requireFromDashboard = createRequire(process.argv[1]); console.log(JSON.stringify([requireFromDashboard("@frogie/core"), requireFromDashboard("external")]));',
        join(directory, "apps/dashboard/package.json"),
      ],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toEqual(["staged broken core", "third-party"]);
    expect(tree(repository)).toEqual(before);
  });

  it("checks the staged lock against installed dependencies, not an unstaged lock edit", async () => {
    const { repository, directory } = fixture();
    write(repository, "pnpm-lock.yaml", "unstaged lock change\n");
    const before = tree(repository);
    await expect(
      prepareSnapshot(repository, directory),
    ).resolves.toBeUndefined();
    expect(tree(repository)).toEqual(before);
  });

  it.each(manifests)(
    "rejects a changed staged manifest at %s without writing the repository",
    async (path) => {
      const { repository, directory } = fixture();
      write(directory, path, '{"name":"different"}');
      const before = tree(repository);
      await expect(prepareSnapshot(repository, directory)).rejects.toThrow();
      expect(tree(repository)).toEqual(before);
    },
  );

  it.each(
    manifests.flatMap(
      (path) =>
        [
          ["repository", path],
          ["snapshot", path],
        ] as const,
    ),
  )("rejects a missing %s manifest at %s", async (location, path) => {
    const { repository, directory } = fixture();
    rmSync(join(location === "repository" ? repository : directory, path));
    const before = tree(repository);
    await expect(prepareSnapshot(repository, directory)).rejects.toThrow();
    expect(tree(repository)).toEqual(before);
  });

  it.each([
    ["snapshot", "pnpm-lock.yaml"],
    ["repository", "node_modules/.pnpm/lock.yaml"],
    ["repository", "node_modules"],
  ] as const)(
    "rejects missing %s dependency metadata at %s",
    async (location, path) => {
      const { repository, directory } = fixture();
      rmSync(join(location === "repository" ? repository : directory, path), {
        recursive: true,
      });
      const before = tree(repository);
      await expect(prepareSnapshot(repository, directory)).rejects.toThrow();
      expect(tree(repository)).toEqual(before);
    },
  );

  it("rejects an installed lock mismatch without installing or writing the repository", async () => {
    const { repository, directory } = fixture();
    write(
      repository,
      "node_modules/.pnpm/lock.yaml",
      "different installed lock\n",
    );
    const before = tree(repository);
    await expect(prepareSnapshot(repository, directory)).rejects.toThrow();
    expect(tree(repository)).toEqual(before);
  });
});

describe("runL1", () => {
  const passing = {
    numTotalTests: 2,
    numPassedTests: 2,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    success: true,
  };
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

  function l1Fixture(
    options: {
      report?: unknown;
      omitReport?: boolean;
      rawReport?: string;
      failTool?: string;
      hangTool?: string;
    } = {},
  ): string {
    const directory = temporaryDirectory();
    const config = { report: passing, ...options };
    write(directory, "fixture-config.json", JSON.stringify(config));
    for (const tool of ["tsc", "biome", "vitest"]) {
      const path = join(directory, "node_modules/.bin", tool);
      write(
        directory,
        join(
          "node_modules/.bin",
          options.hangTool === tool ? `${tool}.cjs` : tool,
        ),
        `#!${process.execPath}
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync("fixture-config.json", "utf8"));
const tool = ${JSON.stringify(tool)};
fs.appendFileSync("calls.jsonl", JSON.stringify({tool, args:process.argv.slice(2), cwd:process.cwd(), staleReport:fs.existsSync("coverage/vitest.json")}) + "\\n");
if (config.failTool === tool) process.exit(7);
if (config.hangTool === tool) {
  setInterval(() => {}, 1000);
}
else if (tool === "vitest" && !config.omitReport) {
  fs.mkdirSync("coverage", {recursive:true});
  fs.writeFileSync("coverage/vitest.json", config.rawReport === undefined ? JSON.stringify(config.report) : config.rawReport);
}
`,
      );
      if (options.hangTool === tool) {
        write(
          directory,
          join("node_modules/.bin", tool),
          `#!/bin/sh\nprintf '%s' "$$" > hanging.pid\nexec ${JSON.stringify(process.execPath)} "$0.cjs" "$@"\n`,
        );
      }
      chmodSync(path, 0o755);
    }
    return directory;
  }

  function calls(
    directory: string,
  ): { tool: string; args: string[]; cwd: string; staleReport: boolean }[] {
    return readFileSync(join(directory, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it("runs all three local tools with exact full-suite arguments in the snapshot directory", async () => {
    const directory = l1Fixture();
    await expect(runL1(directory)).resolves.toBeUndefined();
    const recorded = calls(directory);
    expect(recorded.map(({ tool, args }) => [tool, ...args]).sort()).toEqual(
      [...expectedCalls].sort(),
    );
    expect(recorded.every((call) => call.cwd === directory)).toBe(true);
    expect(
      JSON.parse(readFileSync(join(directory, "coverage/vitest.json"), "utf8")),
    ).toEqual(passing);
  });

  it("removes a stale successful report before launching any check", async () => {
    const directory = l1Fixture();
    write(directory, "coverage/vitest.json", JSON.stringify(passing));
    await expect(runL1(directory)).resolves.toBeUndefined();
    expect(calls(directory)[0]?.staleReport).toBe(false);
    expect(
      calls(directory).find((call) => call.tool === "vitest")?.staleReport,
    ).toBe(false);
  });

  it("rejects a missing new report even when a stale successful report existed", async () => {
    const directory = l1Fixture({ omitReport: true });
    write(directory, "coverage/vitest.json", JSON.stringify(passing));
    await expect(runL1(directory)).rejects.toThrow();
    expect(existsSync(join(directory, "coverage/vitest.json"))).toBe(false);
  });

  it.each([
    ["pending", { ...passing, numPendingTests: 1, numPassedTests: 1 }],
    ["todo", { ...passing, numTodoTests: 1, numPassedTests: 1 }],
    [
      "failed",
      { ...passing, numFailedTests: 1, numPassedTests: 1, success: false },
    ],
    ["empty", { ...passing, numTotalTests: 0, numPassedTests: 0 }],
  ])(
    "rejects a %s Vitest report even when tools exit zero",
    async (_case, report) => {
      const directory = l1Fixture({ report });
      await expect(runL1(directory)).rejects.toThrow();
    },
  );

  it("rejects malformed report JSON after successful tools", async () => {
    await expect(runL1(l1Fixture({ rawReport: "{invalid" }))).rejects.toThrow();
  });

  it.each(["tsc", "biome", "vitest"])(
    "rejects a missing local %s executable",
    async (tool) => {
      const directory = l1Fixture();
      rmSync(join(directory, "node_modules/.bin", tool));
      await expect(runL1(directory)).rejects.toThrow();
    },
  );

  it.each(["tsc", "biome", "vitest"])(
    "rejects a nonzero %s exit",
    async (tool) => {
      await expect(runL1(l1Fixture({ failTool: tool }))).rejects.toThrow();
    },
  );

  it("rejects and reaps a timed-out tool", async () => {
    const directory = l1Fixture({ hangTool: "tsc" });
    try {
      await expect(runL1(directory, { timeoutMs: 1_000 })).rejects.toThrow(
        /timeout|timed? ?out/i,
      );
      const pid = Number(readFileSync(join(directory, "hanging.pid"), "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      const pidFile = join(directory, "hanging.pid");
      if (existsSync(pidFile)) {
        try {
          process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
        } catch {}
      }
    }
  });

  it("rejects an already-aborted run without starting tools", async () => {
    const directory = l1Fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runL1(directory, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    expect(existsSync(join(directory, "calls.jsonl"))).toBe(false);
  });
});

describe("verifyTestReport", () => {
  const passing = {
    numTotalTests: 2,
    numPassedTests: 2,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    success: true,
  };

  function report(value: unknown): string {
    const root = temporaryDirectory();
    write(root, "report.json", JSON.stringify(value));
    return join(root, "report.json");
  }

  it("accepts a nonempty report with every test passed", () => {
    expect(verifyTestReport(report(passing))).toBeUndefined();
  });

  it.each([
    ["empty", { ...passing, numTotalTests: 0, numPassedTests: 0 }],
    [
      "failed",
      { ...passing, numPassedTests: 1, numFailedTests: 1, success: false },
    ],
    ["pending", { ...passing, numPassedTests: 1, numPendingTests: 1 }],
    ["todo", { ...passing, numPassedTests: 1, numTodoTests: 1 }],
    ["inconsistent failure", { ...passing, numFailedTests: 1 }],
    ["inconsistent pending", { ...passing, numPendingTests: 1 }],
    ["inconsistent todo", { ...passing, numTodoTests: 1 }],
    ["missing passes", { ...passing, numPassedTests: 1 }],
    ["excess passes", { ...passing, numPassedTests: 3 }],
    ["unsuccessful", { ...passing, success: false }],
    ["truthy success", { ...passing, success: "true" }],
    ["string counts", { ...passing, numTotalTests: "2", numPassedTests: "2" }],
    ["negative counts", { ...passing, numTotalTests: -1, numPassedTests: -1 }],
    ["missing fields", { numTotalTests: 2, numPassedTests: 2, success: true }],
    ["null", null],
    ["array", []],
  ])("rejects %s reports", (_case, value) => {
    expect(() => verifyTestReport(report(value))).toThrow();
  });

  it("rejects a missing report", () => {
    expect(() =>
      verifyTestReport(join(temporaryDirectory(), "missing.json")),
    ).toThrow();
  });

  it.each(["", "{invalid", '{"success":true'])(
    "rejects invalid JSON %j",
    (content) => {
      const root = temporaryDirectory();
      write(root, "report.json", content);
      expect(() => verifyTestReport(join(root, "report.json"))).toThrow();
    },
  );
});

describe("pushTargets", () => {
  const sha40 = "a".repeat(40);
  const sha64 = "B".repeat(64);
  const remote40 = "c".repeat(40);

  it("returns local SHAs in first-seen order, deduplicates and ignores deleted refs", () => {
    const input = [
      `refs/heads/main ${sha40} refs/heads/main ${remote40}`,
      `refs/heads/duplicate ${sha40} refs/heads/duplicate ${"0".repeat(40)}`,
      `(delete) ${"0".repeat(40)} refs/heads/removed ${remote40}`,
      `refs/heads/next ${sha64} refs/heads/next ${"0".repeat(64)}`,
      `(delete) ${"0".repeat(64)} refs/heads/removed64 ${sha64}`,
    ].join("\n");
    expect(pushTargets(`${input}\n`)).toEqual([sha40, sha64]);
  });

  it("accepts standard whitespace and CRLF line endings", () => {
    expect(
      pushTargets(
        `refs/heads/main\t${sha40}\trefs/heads/main\t${remote40}\r\n`,
      ),
    ).toEqual([sha40]);
  });

  it("returns no targets for empty input", () => {
    expect(pushTargets("")).toEqual([]);
  });

  it.each([
    "refs/heads/main",
    `refs/heads/main ${sha40} refs/heads/main`,
    `refs/heads/main ${sha40} refs/heads/main ${remote40} extra`,
    `refs/heads/main ${"a".repeat(39)} refs/heads/main ${remote40}`,
    `refs/heads/main ${"a".repeat(41)} refs/heads/main ${remote40}`,
    `refs/heads/main ${"a".repeat(63)} refs/heads/main ${remote40}`,
    `refs/heads/main ${"a".repeat(65)} refs/heads/main ${remote40}`,
    `refs/heads/main ${"g".repeat(40)} refs/heads/main ${remote40}`,
    `refs/heads/main ${sha40} refs/heads/main not-a-sha`,
    `(delete) ${"0".repeat(40)} refs/heads/removed invalid`,
  ])("rejects malformed pre-push input %j", (input) => {
    expect(() => pushTargets(input)).toThrow();
  });
});
