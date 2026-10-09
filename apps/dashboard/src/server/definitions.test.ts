import * as fs from "node:fs/promises";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefinitionWorkspace } from "./definitions.js";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
}));

const roots: string[] = [];
const source = fileURLToPath(
  new URL("../../../../tests/fixtures/minimal-squad", import.meta.url),
);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "frogie-definitions-"));
  roots.push(root);
  const squads = join(root, "squads");
  await mkdir(squads);
  const squad = join(squads, "minimal-squad");
  await cp(source, squad, { recursive: true });
  return { root, squads, squad, workspace: createDefinitionWorkspace(squads) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("definition workspace", () => {
  it("constructs without IO and lists the actual definitions", async () => {
    const empty = createDefinitionWorkspace("/not-created-by-frogie");
    expect(empty).toHaveProperty("save");
    const { workspace } = await fixture();
    const definition = await workspace.load("minimal-squad");
    expect(await workspace.list()).toEqual([
      {
        id: definition.squadId,
        projectId: definition.projectId,
        title: definition.title,
      },
    ]);
    expect(definition.roles.length).toBe(2);
  });

  it("validates and atomically saves a complete updated bundle", async () => {
    const { squad, workspace } = await fixture();
    const initial = await workspace.load("minimal-squad");
    const path = "roles/command/ROLE.md";
    const baseContent = await readFile(join(squad, path), "utf8");
    const content = `${baseContent}\nUpdated command guidance.\n`;
    const saved = await workspace.save(
      "minimal-squad",
      { path, baseContent, content },
      "edit-1",
    );
    expect(saved.contentHash).not.toBe(initial.contentHash);
    expect(saved.roles.find(({ id }) => id === "command")?.content).toContain(
      "Updated command guidance.",
    );
    expect(await readFile(join(squad, path), "utf8")).toBe(content);
    expect(await workspace.load("minimal-squad")).toEqual(saved);
    expect(await readdir(join(squad, "roles/command"))).toEqual(
      expect.arrayContaining(["ROLE.md", "reviewer"]),
    );
    expect(
      (await readdir(join(squad, "roles/command"))).some((name) =>
        name.startsWith("."),
      ),
    ).toBe(false);
  });

  it("preserves the original bytes when the candidate has invalid references", async () => {
    const { squad, workspace } = await fixture();
    const path = "roles/command/ROLE.md";
    const baseContent = await readFile(join(squad, path), "utf8");
    const content = baseContent.replace(
      "skills: [planning]",
      "skills: [unknown]",
    );
    expect(content).not.toBe(baseContent);
    await expect(
      workspace.save(
        "minimal-squad",
        { path, baseContent, content },
        "invalid-edit",
      ),
    ).rejects.toThrow();
    expect(await readFile(join(squad, path), "utf8")).toBe(baseContent);
  });

  it("detects an external edit without overwriting it", async () => {
    const { squad, workspace } = await fixture();
    const path = "SQUAD.md";
    const baseContent = await readFile(join(squad, path), "utf8");
    const external = `${baseContent}\nExternal edit.\n`;
    await writeFile(join(squad, path), external);
    await expect(
      workspace.save(
        "minimal-squad",
        { path, baseContent, content: `${baseContent}\nBrowser edit.` },
        "conflict",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(join(squad, path), "utf8")).toBe(external);
  });

  it("treats an identical retry as accepted without overwriting a later edit", async () => {
    const { squad, workspace } = await fixture();
    const path = "SQUAD.md";
    const baseContent = await readFile(join(squad, path), "utf8");
    const draft = {
      path,
      baseContent,
      content: `${baseContent}\nSaved intent.\n`,
    };
    const saved = await workspace.save("minimal-squad", draft, "retry-once");
    expect(
      (await workspace.save("minimal-squad", draft, "retry-once")).contentHash,
    ).toBe(saved.contentHash);
    const later = `${draft.content}\nLater external edit.\n`;
    await writeFile(join(squad, path), later);
    await expect(
      workspace.save("minimal-squad", draft, "retry-once"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(join(squad, path), "utf8")).toBe(later);
  });

  it.each([
    "../escape.md",
    "/tmp/escape.md",
    "roles/../SQUAD.md",
    "roles\\command\\ROLE.md",
    "SQUAD.md\0other",
  ])("rejects an unauthorized file path %s", async (path) => {
    const { workspace } = await fixture();
    await expect(
      workspace.save(
        "minimal-squad",
        { path, baseContent: "", content: "changed" },
        "bad-path",
      ),
    ).rejects.toThrow();
  });

  it("rejects symlinked squads and existing non-Markdown files", async () => {
    const { squad, squads, workspace } = await fixture();
    await symlink(squad, join(squads, "linked"));
    await expect(workspace.load("linked")).rejects.toThrow();
    await writeFile(join(squad, "asset.txt"), "unchanged");
    await expect(
      workspace.save(
        "minimal-squad",
        { path: "asset.txt", baseContent: "unchanged", content: "changed" },
        "asset-edit",
      ),
    ).rejects.toThrow();
    expect(await readFile(join(squad, "asset.txt"), "utf8")).toBe("unchanged");
    await expect(workspace.load("../minimal-squad")).rejects.toThrow();
  });

  it("rejects a symlink workspace root, a file squad, and mismatched IDs", async () => {
    const { root, squad, squads, workspace } = await fixture();
    const linked = join(root, "linked-root");
    await symlink(squads, linked);
    await expect(createDefinitionWorkspace(linked).list()).rejects.toThrow();
    await writeFile(join(squads, "file-squad"), "not a directory");
    await expect(workspace.load("file-squad")).rejects.toThrow();
    await cp(squad, join(squads, "wrong-id"), { recursive: true });
    await expect(workspace.load("wrong-id")).rejects.toThrow();
    await expect(
      workspace.save(
        "wrong-id",
        { path: "SQUAD.md", baseContent: "", content: "" },
        "request",
      ),
    ).rejects.toThrow();
  });

  it("lists multiple squads in stable order and ignores ordinary files", async () => {
    const { squad, squads, workspace } = await fixture();
    await cp(squad, join(squads, "alpha"), { recursive: true });
    const source = await readFile(join(squad, "SQUAD.md"), "utf8");
    await writeFile(
      join(squads, "alpha/SQUAD.md"),
      source.replace("id: minimal-squad", "id: alpha"),
    );
    await writeFile(join(squads, "notes.txt"), "unrelated");
    expect((await workspace.list()).map(({ id }) => id)).toEqual([
      "alpha",
      "minimal-squad",
    ]);
  });

  it.each(["", "roles//ROLE.md", "./SQUAD.md", "missing.md"])(
    "rejects missing or noncanonical MD path %s",
    async (path) => {
      const { workspace } = await fixture();
      await expect(
        workspace.save(
          "minimal-squad",
          { path, baseContent: "", content: "changed" },
          "invalid-path",
        ),
      ).rejects.toThrow();
    },
  );

  it("rejects missing request identity, invalid Unicode, and a changed Squad ID", async () => {
    const { squad, workspace } = await fixture();
    const path = "SQUAD.md";
    const baseContent = await readFile(join(squad, path), "utf8");
    await expect(
      workspace.save(
        "minimal-squad",
        { path, baseContent, content: "other" },
        " ",
      ),
    ).rejects.toThrow();
    await expect(
      workspace.save(
        "minimal-squad",
        { path, baseContent, content: "\uD800" },
        "unicode",
      ),
    ).rejects.toThrow();
    await expect(
      workspace.save(
        "minimal-squad",
        {
          path,
          baseContent,
          content: baseContent.replace("id: minimal-squad", "id: changed"),
        },
        "id-edit",
      ),
    ).rejects.toThrow();
    expect(await readFile(join(squad, path), "utf8")).toBe(baseContent);
    expect((await workspace.load("minimal-squad")).squadId).toBe(
      "minimal-squad",
    );
  });

  it("serializes conflicting saves and keeps the accepted version", async () => {
    const { squad, workspace } = await fixture();
    const path = "SQUAD.md";
    const baseContent = await readFile(join(squad, path), "utf8");
    const first = { path, baseContent, content: `${baseContent}\nFirst.` };
    const second = { path, baseContent, content: `${baseContent}\nSecond.` };
    const results = await Promise.allSettled([
      workspace.save("minimal-squad", first, "first"),
      workspace.save("minimal-squad", second, "second"),
    ]);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(await readFile(join(squad, path), "utf8")).toBe(first.content);
  });

  it("preserves binary resources and executable modes in the validated snapshot", async () => {
    const { squad, workspace } = await fixture();
    const resource = join(squad, "skills/planning/resource.bin");
    const bytes = Buffer.from([0, 255, 128, 42]);
    await writeFile(resource, bytes);
    await chmod(resource, 0o755);
    const path = "SQUAD.md";
    const baseContent = await readFile(join(squad, path), "utf8");
    const saved = await workspace.save(
      "minimal-squad",
      { path, baseContent, content: `${baseContent}\nNew guidance.` },
      "binary-preservation",
    );
    expect(
      saved.files.find((file) => file.path.endsWith("resource.bin")),
    ).toMatchObject({
      content: bytes.toString("base64"),
      encoding: "base64",
      mode: 0o755,
    });
    expect(await workspace.load("minimal-squad")).toEqual(saved);
    expect(await readFile(resource)).toEqual(bytes);
  });

  it.each(["SQUAD.md", "roles/command/ROLE.md"])(
    "rejects an edit to %s during validation and removes the staged file",
    async (changedPath) => {
      const { squad, workspace } = await fixture();
      const path = "SQUAD.md";
      const baseContent = await readFile(join(squad, path), "utf8");
      const externalPath = join(squad, changedPath);
      const externalContent = `${await readFile(externalPath, "utf8")}\nExternal change.`;
      const originalOpen = fs.open;
      vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const file = await originalOpen(...args);
        if (args[1] === "wx") await writeFile(externalPath, externalContent);
        return file;
      });
      await expect(
        workspace.save(
          "minimal-squad",
          { path, baseContent, content: `${baseContent}\nBrowser change.` },
          "race",
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(await readFile(externalPath, "utf8")).toBe(externalContent);
      expect(
        (await readdir(squad)).filter((name) => name.endsWith(".tmp")),
      ).toEqual([]);
    },
  );

  it("keeps the original file and removes staging after rename failure", async () => {
    const { squad, workspace } = await fixture();
    const path = "SQUAD.md";
    const baseContent = await readFile(join(squad, path), "utf8");
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("disk failure"));
    await expect(
      workspace.save(
        "minimal-squad",
        {
          path,
          baseContent,
          content: `${baseContent}\nEdit.`,
        },
        "disk-failure",
      ),
    ).rejects.toThrow("disk failure");
    expect(await readFile(join(squad, path), "utf8")).toBe(baseContent);
    expect(
      (await readdir(squad)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("rejects a target replaced by a symlink after loading the definition", async () => {
    const { root, squad, workspace } = await fixture();
    const target = join(squad, "SQUAD.md");
    const baseContent = await readFile(target, "utf8");
    const outside = join(root, "outside.md");
    await writeFile(outside, "outside content");
    const originalLstat = fs.lstat;
    vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
      if (args[0] === target) {
        await rm(target);
        await symlink(outside, target);
      }
      return originalLstat(...args);
    });
    await expect(
      workspace.save(
        "minimal-squad",
        {
          path: "SQUAD.md",
          baseContent,
          content: `${baseContent}\nEdit.`,
        },
        "symlink-race",
      ),
    ).rejects.toThrow("regular file");
    expect(await readFile(outside, "utf8")).toBe("outside content");
  });

  it("checks target bytes again after complete definition validation", async () => {
    const { squad, squads, workspace } = await fixture();
    const target = join(squad, "SQUAD.md");
    const baseContent = await readFile(target, "utf8");
    const originalOpen = fs.open;
    let reads = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (args[0] === target && ++reads === 2)
        await writeFile(target, `${baseContent}\nExternal edit.`);
      return originalOpen(...args);
    });
    await expect(
      workspace.save(
        "minimal-squad",
        {
          path: "SQUAD.md",
          baseContent,
          content: `${baseContent}\nBrowser edit.`,
        },
        "late-race",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(target, "utf8")).toBe(
      `${baseContent}\nExternal edit.`,
    );
    expect(
      (await readdir(squads)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });
});
