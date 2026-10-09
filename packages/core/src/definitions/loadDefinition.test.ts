import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DefinitionError, loadDefinition } from "./index.js";

const fixture = new URL(
  "../../../../tests/fixtures/minimal-squad",
  import.meta.url,
);
const fixtureFiles = [
  "SQUAD.md",
  "roles/command/ROLE.md",
  "roles/command/reviewer/ROLE.md",
  "skills/planning/SKILL.md",
  "workflows/review.md",
];
const temporaryRoots: string[] = [];

function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "frogie-definition-"));
  temporaryRoots.push(root);
  cpSync(fixture, root, { recursive: true });
  return root;
}

function expectDiagnostic(root: string, code: string, path: string): void {
  let error: unknown;
  try {
    loadDefinition(root);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(DefinitionError);
  expect((error as DefinitionError).diagnostic).toMatchObject({ code, path });
}

function replace(
  root: string,
  path: string,
  before: string,
  after: string,
): void {
  const file = join(root, path);
  const source = readFileSync(file, "utf8");
  expect(source).toContain(before);
  writeFileSync(file, source.replace(before, after));
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("loadDefinition", () => {
  it("loads nested roles, skills, workflows and source files", () => {
    const bundle = loadDefinition(copyFixture());

    expect(bundle).toMatchObject({
      schemaVersion: 1,
      squadId: "minimal-squad",
      projectId: "frogie",
      title: "Minimal Squad",
      rootRoleId: "command",
    });
    expect(bundle.roles.map(({ id }) => id).sort()).toEqual([
      "command",
      "reviewer",
    ]);
    expect(bundle.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "command", parentRoleId: null }),
        expect.objectContaining({ id: "reviewer", parentRoleId: "command" }),
      ]),
    );
    expect(bundle.skills.map(({ id }) => id)).toEqual(["planning"]);
    expect(bundle.workflows.map(({ id }) => id)).toEqual(["review"]);
    expect(bundle.files.map(({ path }) => path).sort()).toEqual(fixtureFiles);
    expect(bundle.files).toContainEqual(
      expect.objectContaining({
        path: "SQUAD.md",
        content: expect.any(String),
      }),
    );
    expect(bundle.contentHash).toEqual(expect.any(String));
    expect(bundle).not.toHaveProperty("defaults");
  });

  it.each([
    [
      "duplicate YAML keys",
      "SQUAD.md",
      "id: minimal-squad",
      "id: minimal-squad\nid: duplicated",
      /duplicate|repeated/i,
    ],
    [
      "unknown Squad fields",
      "SQUAD.md",
      "projectId: frogie",
      "projectId: frogie\nunknownField: true",
      /unknown|additional|unexpected/i,
    ],
    [
      "invalid schema version type",
      "SQUAD.md",
      "schemaVersion: 1",
      'schemaVersion: "1"',
      /schemaVersion|schema version/i,
    ],
    [
      "unsupported schema version",
      "SQUAD.md",
      "schemaVersion: 1",
      "schemaVersion: 2",
      /schemaVersion|unsupported/i,
    ],
    [
      "malformed YAML",
      "SQUAD.md",
      "schemaVersion: 1",
      "schemaVersion: [",
      /yaml|parse|syntax/i,
    ],
    [
      "missing frontmatter delimiters",
      "SQUAD.md",
      "---\nschemaVersion: 1\n",
      "schemaVersion: 1\n",
      /frontmatter/i,
    ],
    [
      "invalid Squad ID",
      "SQUAD.md",
      "id: minimal-squad",
      "id: Minimal_Squad",
      /id|identifier/i,
    ],
    [
      "invalid project ID",
      "SQUAD.md",
      "projectId: frogie",
      "projectId: Frogie",
      /projectId|identifier|id/i,
    ],
    [
      "invalid Role ID",
      "roles/command/reviewer/ROLE.md",
      "id: reviewer",
      "id: Reviewer",
      /id|identifier/i,
    ],
    [
      "role ID differing from its directory",
      "roles/command/reviewer/ROLE.md",
      "id: reviewer",
      "id: different",
      /directory|path|id/i,
    ],
    [
      "Skill name differing from its directory",
      "skills/planning/SKILL.md",
      "name: planning",
      "name: another-skill",
      /skill|name|directory|path/i,
    ],
    [
      "unknown Skill reference",
      "roles/command/ROLE.md",
      "skills: [planning]",
      "skills: [missing]",
      /skill.*(missing|unknown)|(?:missing|unknown).*skill/i,
    ],
    [
      "unknown Workflow role reference",
      "workflows/review.md",
      "role: reviewer",
      "role: missing",
      /role.*(missing|unknown)|(?:missing|unknown).*role/i,
    ],
    [
      "unknown Workflow edge endpoint",
      "workflows/review.md",
      "target: report",
      "target: missing",
      /edge|endpoint|node/i,
    ],
    [
      "duplicate Workflow node ID",
      "workflows/review.md",
      "id: report",
      "id: inspect",
      /duplicate|repeated|node/i,
    ],
    [
      "Workflow node without a body section",
      "workflows/review.md",
      "### inspect",
      "### unlisted",
      /body|section|heading|node/i,
    ],
    [
      "Role missing explicit capability arrays",
      "roles/command/ROLE.md",
      "scripts: []\n",
      "",
      /tools|scripts|extensions|required/i,
    ],
    [
      "Role with an unsupported thinking level",
      "roles/command/ROLE.md",
      "title: Command",
      "title: Command\nthinkingLevel: extreme",
      /thinkingLevel|thinking level/i,
    ],
    [
      "Role with an invalid model object",
      "roles/command/ROLE.md",
      "title: Command",
      "title: Command\nmodel: { provider: openai }",
      /model|modelId/i,
    ],
    [
      "duplicate Role Skill references",
      "roles/command/ROLE.md",
      "skills: [planning]",
      "skills: [planning, planning]",
      /duplicate|unique|skills/i,
    ],
    [
      "Role referencing an undeclared Script",
      "roles/command/ROLE.md",
      "scripts: []",
      "scripts: [planning/missing]",
      /script.*(missing|unknown)|(?:missing|unknown).*script/i,
    ],
    [
      "unknown Role field",
      "roles/command/ROLE.md",
      "title: Command",
      "title: Command\nunknownField: true",
      /unknown|additional|unexpected/i,
    ],
    [
      "unknown Skill field",
      "skills/planning/SKILL.md",
      "description: Plan and review work from supplied evidence.",
      "description: Plan and review work from supplied evidence.\nunknownField: true",
      /unknown|additional|unexpected/i,
    ],
    [
      "unknown Workflow field",
      "workflows/review.md",
      "title: Review",
      "title: Review\nunknownField: true",
      /unknown|additional|unexpected/i,
    ],
    [
      "unsupported Script runtime",
      "skills/planning/SKILL.md",
      "description: Plan and review work from supplied evidence.",
      "description: Plan and review work from supplied evidence.\nfrogie:\n  scripts:\n    - { id: calculate, entry: scripts/calculate.mjs, runtime: python, replay: safe }",
      /runtime/i,
    ],
    [
      "Workflow filename differing from its ID",
      "workflows/review.md",
      "id: review",
      "id: another-workflow",
      /filename|file name|id/i,
    ],
    [
      "unknown Workflow entry node",
      "workflows/review.md",
      "entry: inspect",
      "entry: missing",
      /entry|node/i,
    ],
    [
      "Workflow with a non-finite coordinate",
      "workflows/review.md",
      "x: 80",
      "x: .inf",
      /position|number|finite|x/i,
    ],
    [
      "Workflow with a duplicate edge",
      "workflows/review.md",
      "label: Return evidence",
      "label: Return evidence\n  - source: inspect\n    target: report",
      /duplicate|edge|unique/i,
    ],
    [
      "Workflow referencing an undeclared Script",
      "workflows/review.md",
      "title: Review",
      "title: Review\nscripts: [planning/missing]",
      /script.*(missing|unknown)|(?:missing|unknown).*script/i,
    ],
  ] as const)(
    "rejects %s with a useful diagnostic",
    (_case, path, before, after, message) => {
      const root = copyFixture();
      replace(root, path, before, after);
      if (_case === "unsupported Script runtime") {
        expectDiagnostic(root, "schema", path);
      } else if (_case === "missing frontmatter delimiters") {
        expectDiagnostic(root, "frontmatter", path);
      } else {
        expect(() => loadDefinition(root)).toThrow(message);
      }
    },
  );

  it.each(["目标", "输入", "步骤", "输出", "验收要点"])(
    "rejects a Workflow missing the %s body section",
    (section) => {
      const root = copyFixture();
      replace(
        root,
        "workflows/review.md",
        `## ${section}`,
        `## ${section} removed`,
      );
      expect(() => loadDefinition(root)).toThrow(/Missing body section/i);
    },
  );

  it("rejects duplicate Workflow body sections and duplicate node headings", () => {
    const root = copyFixture();
    replace(
      root,
      "workflows/review.md",
      "## 输入\nThe material to review.\n",
      "## 输入\nThe material to review.\n\n## 输入\nA second input section.\n",
    );
    expect(() => loadDefinition(root)).toThrow(/duplicate.*body section/i);

    const anotherRoot = copyFixture();
    replace(
      anotherRoot,
      "workflows/review.md",
      "### inspect\nReview the material and collect evidence.\n",
      "### inspect\nReview the material and collect evidence.\n\n### inspect\nDuplicate step.\n",
    );
    expect(() => loadDefinition(anotherRoot)).toThrow(/duplicate.*node body/i);
  });

  it("ignores fenced headings and does not close a longer fence with a shorter marker", () => {
    const root = copyFixture();
    replace(
      root,
      "workflows/review.md",
      "## 验收要点\nThe evidence is traceable to the supplied material.\n",
      "## 验收要点\nThe evidence is traceable to the supplied material.\n\n````markdown\n```\n## 伪造章节\n### fake-node\n````\n",
    );
    expect(loadDefinition(root).workflows[0]?.nodes).toHaveLength(2);
  });

  it("rejects an unreachable node with a matching body section", () => {
    const root = copyFixture();
    replace(
      root,
      "workflows/review.md",
      "    position: { x: 400, y: 120 }\nedges:",
      "    position: { x: 400, y: 120 }\n  - id: orphan\n    title: Orphan\n    role: command\n    position: { x: 600, y: 120 }\nedges:",
    );
    replace(
      root,
      "workflows/review.md",
      "### report\nSummarize the findings.\n",
      "### report\nSummarize the findings.\n\n### orphan\nThis step is disconnected.\n",
    );
    expect(() => loadDefinition(root)).toThrow(/unreachable|reachability/i);
  });

  it("accepts a cycle and multiple steps assigned to the same Role", () => {
    const root = copyFixture();
    const workflowPath = "workflows/review.md";
    replace(root, workflowPath, "role: command", "role: reviewer");
    replace(
      root,
      workflowPath,
      "    target: report\n    label: Return evidence",
      "    target: report\n    label: Return evidence\n  - source: report\n    target: inspect\n    label: Review again",
    );

    const workflow = loadDefinition(root).workflows[0];
    expect(workflow?.nodes.map(({ role }) => role)).toEqual([
      "reviewer",
      "reviewer",
    ]);
    expect(workflow?.entryRole).toBe("reviewer");
    expect(workflow?.participants).toEqual(["reviewer"]);
    expect(workflow?.edges).toHaveLength(2);
  });

  it("rejects a role tree whose parent directory has no Role definition", () => {
    const root = copyFixture();
    const nested = join(root, "roles", "command", "missing-parent", "leaf");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(nested, "ROLE.md"),
      "---\nid: leaf\ntitle: Leaf\nskills: []\nextensions: []\ntools: []\nscripts: []\n---\nA nested role.\n",
    );
    expect(() => loadDefinition(root)).toThrow(/parent|role|directory|path/i);
  });

  it("rejects an unexpected directory outside the supported tree", () => {
    const root = copyFixture();
    mkdirSync(join(root, "extras"));
    expect(() => loadDefinition(root)).toThrow(/unexpected directory/i);
  });

  it("rejects an unexpected file outside supported Skill resources", () => {
    const root = copyFixture();
    writeFileSync(join(root, "unexpected.txt"), "not a definition file\\n");
    expect(() => loadDefinition(root)).toThrow(/unexpected file/i);
  });

  it("rejects a definition with no roles", () => {
    const root = copyFixture();
    rmSync(join(root, "roles", "command"), { recursive: true });
    expect(() => loadDefinition(root)).toThrow(/exactly one root role/i);
  });

  it("rejects a Role directory without ROLE.md", () => {
    const root = copyFixture();
    rmSync(join(root, "roles", "command", "reviewer", "ROLE.md"));
    expect(() => loadDefinition(root)).toThrow(/ROLE\\.md|missing/i);
  });

  it("rejects more than one root role", () => {
    const root = copyFixture();
    const secondRoot = join(root, "roles", "secondary");
    mkdirSync(secondRoot);
    writeFileSync(
      join(secondRoot, "ROLE.md"),
      "---\nid: secondary\ntitle: Secondary\nskills: []\nextensions: []\ntools: []\nscripts: []\n---\nAnother root.\n",
    );
    expect(() => loadDefinition(root)).toThrow(
      /exactly one|unique root|root role|top.level/i,
    );
  });

  it("reports a missing root as a DefinitionError diagnostic", () => {
    const root = join(temporaryRoots[0] ?? tmpdir(), "missing-definition-root");
    let error: unknown;
    try {
      loadDefinition(root);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DefinitionError);
    expect((error as DefinitionError).diagnostic).toMatchObject({
      path: expect.any(String),
      code: expect.any(String),
      message: expect.any(String),
    });
  });

  it("rejects a symbolic link used as the definition root", () => {
    const root = copyFixture();
    const link = join(temporaryRoots[0] as string, "root-link");
    symlinkSync(root, link);
    expect(() => loadDefinition(link)).toThrow(/symbolic|symlink|link/i);
  });

  it("rejects symbolic links in the definition tree", () => {
    const root = copyFixture();
    const outside = mkdtempSync(join(tmpdir(), "frogie-outside-"));
    temporaryRoots.push(outside);
    symlinkSync(outside, join(root, "skills", "planning", "outside"));
    expect(() => loadDefinition(root)).toThrow(/symbolic|symlink|link/i);
  });

  it("reports missing declared Script files as definition diagnostics", () => {
    const root = copyFixture();
    const skillPath = join(root, "skills", "planning", "SKILL.md");
    writeFileSync(
      skillPath,
      readFileSync(skillPath, "utf8").replace(
        "description: Plan and review work from supplied evidence.",
        "description: Plan and review work from supplied evidence.\nfrogie:\n  scripts:\n    - { id: calculate, entry: scripts/missing.mjs, runtime: node, replay: safe }",
      ),
    );
    let error: unknown;
    try {
      loadDefinition(root);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DefinitionError);
    expect((error as DefinitionError).diagnostic).toMatchObject({
      code: "missing",
      path: "skills/planning/scripts/missing.mjs",
    });
  });

  it("rejects YAML alias expansion over the parser limit", () => {
    const root = copyFixture();
    const aliases = Array.from({ length: 101 }, () => "*shared").join(", ");
    writeFileSync(
      join(root, "SQUAD.md"),
      `---\nschemaVersion: 1\nid: minimal-squad\nprojectId: frogie\ntitle: Minimal Squad\nshared: &shared [value]\naliases: [${aliases}]\n---\nShared mission context.\n`,
    );
    expectDiagnostic(root, "yaml", "SQUAD.md");
  });

  it("rejects a Unix socket in the definition tree as a non-regular file", async () => {
    const root = copyFixture();
    const socketPath = join(root, "skills", "planning", "resources.sock");
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      expectDiagnostic(root, "file", "skills/planning/resources.sock");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects a FIFO resource without blocking while reading it", () => {
    const root = copyFixture();
    const resources = join(root, "skills", "planning", "resources");
    mkdirSync(resources);
    execFileSync("mkfifo", [join(resources, "pipe")]);
    const moduleUrl = new URL("./index.ts", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `const { loadDefinition } = await import(${JSON.stringify(moduleUrl)}); loadDefinition(process.argv[1]);`,
        root,
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 2_000 },
    );
    expect((result.error as NodeJS.ErrnoException | undefined)?.code).not.toBe(
      "ETIMEDOUT",
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/regular files|file/i);
  });

  it("includes Skill scripts and resources in the sorted file snapshot and hash", () => {
    const root = copyFixture();
    const skillPath = join(root, "skills", "planning", "SKILL.md");
    const skill = readFileSync(skillPath, "utf8").replace(
      "description: Plan and review work from supplied evidence.",
      "description: Plan and review work from supplied evidence.\nfrogie:\n  scripts:\n    - id: calculate\n      entry: scripts/calculate.mjs\n      runtime: node\n      replay: safe",
    );
    writeFileSync(skillPath, skill);
    const scriptsDirectory = join(root, "skills", "planning", "scripts");
    mkdirSync(scriptsDirectory);
    writeFileSync(join(scriptsDirectory, "calculate.mjs"), "export {};\\n");
    const resourcesDirectory = join(root, "skills", "planning", "resources");
    mkdirSync(resourcesDirectory);
    writeFileSync(join(resourcesDirectory, "rules.md"), "planning rules\\n");

    const bundle = loadDefinition(root);
    expect(bundle.files.map(({ path }) => path)).toContain(
      "skills/planning/scripts/calculate.mjs",
    );
    expect(bundle.files.map(({ path }) => path)).toContain(
      "skills/planning/resources/rules.md",
    );
    expect(bundle.skills[0]?.scripts).toEqual([
      {
        id: "calculate",
        entry: "scripts/calculate.mjs",
        runtime: "node",
        replay: "safe",
      },
    ]);
  });

  it("loads valid Skill scripts and their Role references", () => {
    const root = copyFixture();
    const skillPath = join(root, "skills", "planning", "SKILL.md");
    writeFileSync(
      skillPath,
      readFileSync(skillPath, "utf8").replace(
        "description: Plan and review work from supplied evidence.",
        "description: Plan and review work from supplied evidence.\nfrogie:\n  scripts:\n    - id: calculate\n      entry: scripts/calculate.mjs\n      runtime: node\n      replay: safe",
      ),
    );
    const scripts = join(root, "skills", "planning", "scripts");
    mkdirSync(scripts);
    writeFileSync(join(scripts, "calculate.mjs"), "export {};\\n");
    replace(
      root,
      "roles/command/ROLE.md",
      "scripts: []",
      "scripts: [planning/calculate]",
    );

    const bundle = loadDefinition(root);
    expect(bundle.skills[0]?.scripts).toMatchObject([
      { id: "calculate", entry: "scripts/calculate.mjs" },
    ]);
    expect(bundle.roles.find(({ id }) => id === "command")?.scripts).toEqual([
      "planning/calculate",
    ]);
  });

  it("rejects duplicate Skill script IDs", () => {
    const root = copyFixture();
    const skillPath = join(root, "skills", "planning", "SKILL.md");
    writeFileSync(
      skillPath,
      readFileSync(skillPath, "utf8").replace(
        "description: Plan and review work from supplied evidence.",
        "description: Plan and review work from supplied evidence.\nfrogie:\n  scripts:\n    - { id: calculate, entry: scripts/a.mjs, runtime: node, replay: safe }\n    - { id: calculate, entry: scripts/b.mjs, runtime: node, replay: safe }",
      ),
    );
    expectDiagnostic(root, "duplicate", "skills/planning/SKILL.md");
  });

  it.each([
    ["absolute", "/outside.mjs"],
    ["parent traversal", "scripts/../outside.mjs"],
    ["dot segment", "scripts/./calculate.mjs"],
    ["backslash", "scripts\\\\calculate.mjs"],
  ])("rejects a %s Script entry", (_kind, entry) => {
    const root = copyFixture();
    const skillPath = join(root, "skills", "planning", "SKILL.md");
    writeFileSync(
      skillPath,
      readFileSync(skillPath, "utf8").replace(
        "description: Plan and review work from supplied evidence.",
        `description: Plan and review work from supplied evidence.\nfrogie:\n  scripts:\n    - id: calculate\n      entry: ${entry}\n      runtime: node\n      replay: safe`,
      ),
    );
    expectDiagnostic(root, "path", "skills/planning/SKILL.md");
  });

  it("rejects a Skill script entry escaping its directory", () => {
    const root = copyFixture();
    const skillPath = join(root, "skills", "planning", "SKILL.md");
    const skill = readFileSync(skillPath, "utf8").replace(
      "description: Plan and review work from supplied evidence.",
      "description: Plan and review work from supplied evidence.\nfrogie:\n  scripts:\n    - id: calculate\n      entry: ../outside.mjs\n      runtime: node\n      replay: safe",
    );
    writeFileSync(skillPath, skill);
    expectDiagnostic(root, "path", "skills/planning/SKILL.md");
  });

  it("includes nested role parent identity, defaults and node-derived participants", () => {
    const root = copyFixture();
    replace(
      root,
      "SQUAD.md",
      "title: Minimal Squad",
      "title: Minimal Squad\ndefaults:\n  model: { provider: openai, modelId: gpt-6-sol }\n  thinkingLevel: high",
    );
    const nestedPath = join(root, "roles", "command", "reviewer", "leaf");
    mkdirSync(nestedPath);
    writeFileSync(
      join(nestedPath, "ROLE.md"),
      "---\nid: leaf\ntitle: Leaf\nskills: []\nextensions: []\ntools: []\nscripts: []\n---\nLeaf role.\n",
    );
    writeFileSync(
      join(root, "workflows", "review.md"),
      readFileSync(join(root, "workflows", "review.md"), "utf8").replace(
        "role: command",
        "role: leaf",
      ),
    );
    const bundle = loadDefinition(root);
    expect(bundle.defaults).toEqual({
      model: { provider: "openai", modelId: "gpt-6-sol" },
      thinkingLevel: "high",
    });
    expect(bundle.roles.find(({ id }) => id === "leaf")?.parentRoleId).toBe(
      "reviewer",
    );
    expect(bundle.workflows[0]?.participants).toEqual(["reviewer", "leaf"]);
    expect(bundle.workflows[0]?.entryRole).toBe("reviewer");
  });

  it("preserves UTF-8 Markdown body whitespace and labels text files as UTF-8", () => {
    const root = copyFixture();
    replace(
      root,
      "SQUAD.md",
      "Shared mission context.\n",
      "  Shared mission context.  \n\n",
    );
    const bundle = loadDefinition(root);
    expect(bundle.content).toBe("  Shared mission context.  \n\n");
    expect(
      bundle.files.every(
        (file) => "encoding" in file && file.encoding === "utf8",
      ),
    ).toBe(true);
    expect(
      bundle.files.find(({ path }) => path === "SQUAD.md")?.content,
    ).toContain("  Shared mission context.  ");
  });

  it("preserves binary Skill resources as base64", () => {
    const root = copyFixture();
    const resource = Buffer.from([0x00, 0xff, 0x80, 0x41, 0x0a]);
    const resources = join(root, "skills", "planning", "resources");
    mkdirSync(resources);
    writeFileSync(join(resources, "diagram.bin"), resource);

    const file = loadDefinition(root).files.find(
      ({ path }) => path === "skills/planning/resources/diagram.bin",
    );
    expect(file).toMatchObject({
      encoding: "base64",
      content: resource.toString("base64"),
    });
    expect(Buffer.from(file?.content ?? "", "base64")).toEqual(resource);
  });

  it.each(["SQUAD.md", "roles/command/ROLE.md", "skills/planning/SKILL.md"])(
    "rejects invalid UTF-8 in %s",
    (path) => {
      const root = copyFixture();
      const file = join(root, path);
      writeFileSync(
        file,
        Buffer.concat([readFileSync(file), Buffer.from([0xff])]),
      );
      expect(() => loadDefinition(root)).toThrow(/UTF-8|utf8|encoding/i);
    },
  );

  it("rejects invalid UTF-8 in a declared Script", () => {
    const root = copyFixture();
    const skillPath = join(root, "skills", "planning", "SKILL.md");
    writeFileSync(
      skillPath,
      readFileSync(skillPath, "utf8").replace(
        "description: Plan and review work from supplied evidence.",
        "description: Plan and review work from supplied evidence.\nfrogie:\n  scripts:\n    - id: calculate\n      entry: scripts/calculate.mjs\n      runtime: node\n      replay: safe",
      ),
    );
    const scripts = join(root, "skills", "planning", "scripts");
    mkdirSync(scripts);
    writeFileSync(join(scripts, "calculate.mjs"), Buffer.from([0xff, 0x00]));
    expectDiagnostic(root, "encoding", "skills/planning/scripts/calculate.mjs");
  });

  it("includes file mode in the snapshot and content hash", () => {
    const root = copyFixture();
    const original = loadDefinition(root);
    const rolePath = join(root, "roles", "command", "ROLE.md");
    chmodSync(rolePath, 0o755);
    const executable = loadDefinition(root);
    expect(
      executable.files.find(({ path }) => path === "roles/command/ROLE.md")
        ?.mode,
    ).toBe(0o755);
    expect(executable.contentHash).not.toBe(original.contentHash);
  });

  it("hashes identical content stably and changes after an edit", () => {
    const firstRoot = copyFixture();
    const secondRoot = copyFixture();
    const first = loadDefinition(firstRoot);
    expect(loadDefinition(secondRoot).contentHash).toBe(first.contentHash);

    replace(
      secondRoot,
      "roles/command/ROLE.md",
      "Coordinate the work",
      "Coordinate all work",
    );
    expect(loadDefinition(secondRoot).contentHash).not.toBe(first.contentHash);
  });
});
