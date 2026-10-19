import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureEnv, git } from "../tests/fixtures/git.js";

const roots: string[] = [];

beforeEach(() => {
  for (const name of Object.keys(process.env))
    if (name.startsWith("GIT_")) vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("Git fixture isolation", () => {
  it("returns a fresh environment without any GIT_* keys or caller mutations", () => {
    for (const name of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_COMMON_DIR",
      "GIT_INDEX_FILE",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
      "GIT_CONFIG_GLOBAL",
      "GIT_OBJECT_DIRECTORY",
      "GIT_NAMESPACE",
      "GIT_ARBITRARY_FUTURE_VARIABLE",
      "GIT_",
    ])
      vi.stubEnv(name, "poison");
    vi.stubEnv("FIXTURE_SENTINEL", "preserved");
    vi.stubEnv("git_lowercase", "preserved");
    vi.stubEnv("NOT_GIT_DIR", "preserved");
    vi.stubEnv("FIXTURE_EMPTY", "");
    const before = { ...process.env };
    const expected = { ...before };
    for (const name of Object.keys(expected))
      if (name.startsWith("GIT_")) delete expected[name];

    const first = fixtureEnv();
    expect(first).toEqual(expected);
    expect(first).not.toBe(process.env);
    expect(process.env).toEqual(before);
    first.FIXTURE_SENTINEL = "changed copy";
    vi.stubEnv("FIXTURE_LATE", "new value");
    const second = fixtureEnv();
    expect(second).not.toBe(first);
    expect(second).toEqual({ ...expected, FIXTURE_LATE: "new value" });
    expect(process.env).toEqual({ ...before, FIXTURE_LATE: "new value" });
  });

  it("keeps outer refs, indexes, config and worktree metadata intact under real hook inheritance", () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "frogie-git-isolation-")),
    );
    roots.push(root);
    const main = join(root, "main");
    const linked = join(root, "linked");
    const fixture = join(root, "fixture");
    const hooks = join(root, "hooks");
    const emptyHooks = join(root, "empty-hooks");
    const globalConfig = join(root, "global.config");
    for (const path of [main, fixture, hooks, emptyHooks]) mkdirSync(path);
    writeFileSync(globalConfig, "[isolation]\n\tglobal = untouched\n");
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", root);
    const setupEnv = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: globalConfig,
    };
    const control = (repository: string, ...args: string[]) =>
      execFileSync("git", args, {
        cwd: repository,
        env: setupEnv,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
    control(main, "init", "-q", "--initial-branch=main", "--template=");
    for (const [name, value] of [
      ["user.name", "Outer Fixture"],
      ["user.email", "outer@example.invalid"],
      ["commit.gpgsign", "false"],
      ["extensions.worktreeConfig", "true"],
    ] as const)
      control(main, "config", "--local", name, value);
    writeFileSync(join(main, "payload.txt"), "outer baseline\n");
    control(main, "add", "payload.txt");
    control(main, "commit", "-qm", "Outer baseline");
    control(main, "worktree", "add", "-q", "-b", "linked", linked);
    for (const repository of [main, linked]) {
      control(
        repository,
        "config",
        "--worktree",
        "isolation.owner",
        repository,
      );
      writeFileSync(join(repository, "payload.txt"), `${repository}\nstaged\n`);
      control(repository, "add", "payload.txt");
      writeFileSync(
        join(repository, "payload.txt"),
        `${repository}\nunstaged\n`,
      );
    }

    const capture = join(root, "hook-env.json");
    const probe = join(root, "capture.cjs");
    writeFileSync(
      probe,
      `require("node:fs").writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.env)); process.exit(1);\n`,
    );
    const hook = join(hooks, "pre-commit");
    writeFileSync(hook, `#!/bin/sh\nexec "${process.execPath}" "${probe}"\n`);
    chmodSync(hook, 0o755);
    control(main, "config", "--local", "core.hooksPath", hooks);
    const attempt = spawnSync("git", ["commit", "-qm", "Must be rejected"], {
      cwd: linked,
      env: setupEnv,
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(attempt.error).toBeUndefined();
    expect(attempt.signal).toBeNull();
    expect(attempt.status, attempt.stderr).toBe(1);
    const inherited: NodeJS.ProcessEnv = JSON.parse(
      readFileSync(capture, "utf8"),
    );
    const common = join(main, ".git");
    const metadata = control(linked, "rev-parse", "--absolute-git-dir");
    expect(inherited.GIT_DIR).toBe(metadata);
    expect(inherited.GIT_INDEX_FILE).toBe(join(metadata, "index"));
    expect(control(linked, "log", "-1", "--format=%s")).toBe("Outer baseline");

    const files = [
      globalConfig,
      join(main, "payload.txt"),
      join(linked, "payload.txt"),
      join(linked, ".git"),
      ...["HEAD", "index", "config", "config.worktree", "logs/HEAD"].map(
        (name) => join(common, name),
      ),
      ...readdirSync(metadata, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name)),
    ];
    const snapshot = () => ({
      refs: control(main, "for-each-ref", "--format=%(refname) %(objectname)"),
      files: Object.fromEntries(
        files.map((path) => [path, readFileSync(path).toString("base64")]),
      ),
      worktrees: control(main, "worktree", "list", "--porcelain"),
    });
    const before = snapshot();
    for (const [name, value] of Object.entries({
      ...inherited,
      GIT_DIR: metadata,
      GIT_WORK_TREE: linked,
      GIT_COMMON_DIR: common,
      GIT_INDEX_FILE: join(metadata, "index"),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: emptyHooks,
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_OBJECT_DIRECTORY: join(common, "objects"),
      GIT_NAMESPACE: "outer-namespace",
    }))
      if (name.startsWith("GIT_")) vi.stubEnv(name, value);
    const callerEnv = { ...process.env };
    writeFileSync(join(fixture, "payload.txt"), "independent fixture\n");
    try {
      git(fixture, "init", "-q", "--initial-branch=fixture", "--template=");
      git(fixture, "config", "--local", "user.name", "Inner Fixture");
      git(fixture, "config", "--local", "user.email", "inner@example.invalid");
      git(fixture, "config", "--local", "commit.gpgsign", "false");
      git(fixture, "add", "payload.txt");
      git(fixture, "commit", "-qm", "Independent fixture");
    } finally {
      expect(snapshot()).toEqual(before);
      expect(process.env).toEqual(callerEnv);
    }
    expect(control(fixture, "rev-parse", "--show-toplevel")).toBe(fixture);
    expect(git(fixture, "show", "HEAD:payload.txt")).toBe(
      "independent fixture",
    );
    expect(git(fixture, "log", "-1", "--format=%s")).toBe(
      "Independent fixture",
    );
    expect(git(fixture, "status", "--porcelain")).toBe("");
  });
});
