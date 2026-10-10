import { execFileSync, spawnSync } from "node:child_process";
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

const roots: string[] = [];
const sourceRoot = new URL("../", import.meta.url);

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
      for (const name of readdirSync(absolute).sort()) {
        if (path === "" && name === ".git") continue;
        visit(path ? `${path}/${name}` : name);
      }
    } else result[path] = readFileSync(absolute).toString("base64");
  }
  visit("");
  return result;
}

function fixture(healthy: boolean) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "frogie-hook-test-")));
  roots.push(root);
  const repository = join(root, "repository");
  const temporary = join(root, "temporary");
  mkdirSync(temporary);
  const log = join(root, "calls.jsonl");
  write(repository, ".gitignore", "node_modules/\ncoverage/\n");
  write(
    repository,
    "package.json",
    JSON.stringify({ name: "frogie", type: "module" }),
  );
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
    "source.txt",
    healthy ? "staged healthy\n" : "staged type error\n",
  );
  for (const name of ["check", "gate", "cli"])
    write(
      repository,
      `scripts/${name}.ts`,
      readFileSync(new URL(`scripts/${name}.ts`, sourceRoot), "utf8"),
    );
  for (const hook of ["pre-commit", "pre-push"])
    write(
      repository,
      `.husky/${hook}`,
      readFileSync(new URL(`.husky/${hook}`, sourceRoot), "utf8"),
    );
  for (const workspace of ["packages/core", "apps/dashboard", "apps/daemon"])
    mkdirSync(join(repository, workspace, "node_modules"), { recursive: true });
  symlinkSync(
    realpathSync(new URL("node_modules/tsx", sourceRoot)),
    join(repository, "node_modules/tsx"),
  );
  for (const tool of ["tsc", "biome", "vitest", "vite"]) {
    const relative = `node_modules/.bin/${tool}`;
    write(
      repository,
      relative,
      `#!${process.execPath}
const fs = require("node:fs");
const tool = ${JSON.stringify(tool)};
const source = fs.readFileSync(tool === "vite" ? "../../source.txt" : "source.txt", "utf8");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({tool,args:process.argv.slice(2),cwd:process.cwd(),source}) + "\\n");
if (tool === "tsc" && source.includes("type error")) process.exit(2);
if (tool === "vitest") {
  fs.mkdirSync("coverage", {recursive:true});
  fs.writeFileSync("coverage/vitest.json", JSON.stringify({numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true}));
}
`,
    );
    chmodSync(join(repository, relative), 0o755);
  }
  execFileSync("git", ["init", "-q"], { cwd: repository, stdio: "pipe" });
  execFileSync(
    "git",
    [
      "add",
      "--",
      ".gitignore",
      "package.json",
      "packages/core/package.json",
      "apps/dashboard/package.json",
      "apps/daemon/package.json",
      "pnpm-lock.yaml",
      "source.txt",
      "scripts/check.ts",
      "scripts/gate.ts",
      "scripts/cli.ts",
      ".husky/pre-commit",
      ".husky/pre-push",
    ],
    { cwd: repository, stdio: "pipe" },
  );
  return { root, repository, temporary, log };
}

function execute(
  test: ReturnType<typeof fixture>,
  hook = "pre-commit",
  input = "",
) {
  const before = tree(test.repository);
  const index = readFileSync(join(test.repository, ".git/index"));
  const result = spawnSync(
    "/bin/sh",
    [join(test.repository, `.husky/${hook}`)],
    {
      cwd: test.repository,
      env: { ...process.env, TMPDIR: test.temporary },
      encoding: "utf8",
      input,
      timeout: 8_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  const calls: { tool: string; args: string[]; cwd: string; source: string }[] =
    existsSync(test.log)
      ? readFileSync(test.log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
  expect(
    calls.every(
      (call) => call.cwd !== test.repository && !existsSync(call.cwd),
    ),
  ).toBe(true);
  expect(readdirSync(test.temporary)).toEqual([]);
  expect(tree(test.repository)).toEqual(before);
  expect(readFileSync(join(test.repository, ".git/index"))).toEqual(index);
  return { result, calls };
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("pre-commit shell", () => {
  it("runs the healthy staged snapshot through every required local check", () => {
    const { result, calls } = execute(fixture(true));
    expect(result.status, result.stderr).toBe(0);
    expect(calls.map(({ tool, args }) => [tool, ...args]).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(calls.every((call) => call.source === "staged healthy\n")).toBe(
      true,
    );
  });

  it("rejects a staged type error despite an unstaged repair", () => {
    const test = fixture(false);
    write(test.repository, "source.txt", "working-tree repaired\n");
    const { result, calls } = execute(test);
    expect(result.status).not.toBe(0);
    expect(calls.find((call) => call.tool === "tsc")?.source).toBe(
      "staged type error\n",
    );
  });

  it("uses staged gate scripts even when the working-tree CLI is replaced with a bypass", () => {
    const test = fixture(false);
    write(test.repository, "source.txt", "working-tree repaired\n");
    write(
      test.repository,
      "scripts/cli.ts",
      "export async function main() {}\nexport async function gate() {}\n",
    );
    const { result, calls } = execute(test);
    expect(result.status).not.toBe(0);
    expect(calls.find((call) => call.tool === "tsc")?.source).toBe(
      "staged type error\n",
    );
  });
});

describe("pre-push shell", () => {
  it("loads checkers from the pushed SHA rather than an unrelated malicious HEAD", () => {
    const test = fixture(true);
    const commit = (message: string) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Hook Fixture",
          "-c",
          "user.email=hook@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-qm",
          message,
        ],
        { cwd: test.repository, stdio: "pipe" },
      );
    commit("Add healthy checkers");
    const pushedSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: test.repository,
      encoding: "utf8",
    }).trim();
    write(
      test.repository,
      "scripts/cli.ts",
      'throw new Error("Unrelated HEAD checker executed");\nexport async function main() {}\n',
    );
    execFileSync("git", ["add", "--", "scripts/cli.ts"], {
      cwd: test.repository,
      stdio: "pipe",
    });
    commit("Replace unrelated HEAD checker");
    const { result, calls } = execute(
      test,
      "pre-push",
      `refs/heads/healthy ${pushedSha} refs/heads/healthy ${"0".repeat(40)}\n`,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(calls.map((call) => call.tool).sort()).toEqual([
      "biome",
      "tsc",
      "vite",
      "vitest",
    ]);
    expect(calls.every((call) => call.source === "staged healthy\n")).toBe(
      true,
    );
  });
});
