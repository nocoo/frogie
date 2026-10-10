import { createHash } from "node:crypto";
import * as filesystem from "node:fs/promises";
import {
  link,
  lstat,
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
import type { ArtifactRef, RuntimeScope } from "@frogie/core/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifactStore } from "./artifacts.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    rename: vi.fn(actual.rename),
  };
});

const scope: RuntimeScope = {
  projectId: "artifact-project",
  environmentId: "e2e",
  squadId: "artifact-squad",
  harnessId: "artifact-harness",
};
const input = {
  conversationId: 17,
  taskId: 23,
  operationId: "write-plan",
  name: "plan.md",
  mediaType: "text/markdown",
  content: "# Plan\n中文与😀 remain intact.\n",
};
let root: string;
let directory: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "frogie-artifacts-test-"));
  directory = join(root, "artifacts");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function metadataPath(id: string): Promise<string> {
  for (const file of await readdir(directory, { recursive: true })) {
    const path = join(directory, file);
    if (!(await lstat(path)).isFile()) continue;
    try {
      if (JSON.parse(await readFile(path, "utf8")).ref?.id === id) return path;
    } catch {}
  }
  throw new Error("Missing persisted artifact metadata");
}

describe("immutable artifact store", () => {
  it("persists a scoped UTF-8 artifact and reconstructs its reference and permissions on reopen", async () => {
    const store = await createArtifactStore({ directory, scope });
    const ref: ArtifactRef = await store.write(input);
    expect(ref).toMatchObject({
      scope,
      name: input.name,
      mediaType: input.mediaType,
      conversationId: input.conversationId,
      taskId: input.taskId,
      byteLength: Buffer.byteLength(input.content),
      sha256: createHash("sha256").update(input.content).digest("hex"),
    });
    expect(ref.id).toEqual(expect.any(String));
    expect(ref.id.length).toBeGreaterThan(0);
    expect(await store.read(ref.id, 17)).toEqual({
      ref,
      content: input.content,
    });
    expect(await store.list(17)).toEqual([ref]);
    expect(await store.list(18)).toEqual([]);
    const reopened = await createArtifactStore({ directory, scope });
    expect(await reopened.read(ref.id, 17)).toEqual({
      ref,
      content: input.content,
    });
    expect(await reopened.list(17)).toEqual([ref]);
  });

  it("deduplicates the same operation including concurrent writes and rejects different content without replacing it", async () => {
    const store = await createArtifactStore({ directory, scope });
    const refs = await Promise.all([store.write(input), store.write(input)]);
    expect(refs[0]).toEqual(refs[1]);
    const ref = refs[0];
    if (!ref) throw new Error("Missing artifact");
    await expect(
      store.write({ ...input, content: "Replaced content must not commit" }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await store.read(ref.id, 17)).toEqual({
      ref,
      content: input.content,
    });
    expect(await store.list(17)).toEqual([ref]);
    const distinct = await store.write({
      ...input,
      operationId: "other-write",
      name: "evidence.md",
      content: "Other immutable artifact",
    });
    expect(await store.list(17)).toEqual(
      expect.arrayContaining([ref, distinct]),
    );
  });

  it("requires explicit conversation grants and persists them without granting unrelated artifacts", async () => {
    const store = await createArtifactStore({ directory, scope });
    const ref = await store.write(input);
    const privateRef = await store.write({
      ...input,
      operationId: "private-write",
      content: "Private evidence",
    });
    await expect(store.read(ref.id, 18)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(store.grant([ref.id], 18, 19)).rejects.toMatchObject({
      code: "forbidden",
    });
    await store.grant([ref.id], 17, 18);
    await store.grant([ref.id], 17, 18);
    expect(await store.read(ref.id, 18)).toEqual({
      ref,
      content: input.content,
    });
    expect(await store.list(18)).toEqual([ref]);
    await expect(store.read(privateRef.id, 18)).rejects.toMatchObject({
      code: "forbidden",
    });
    const reopened = await createArtifactStore({ directory, scope });
    expect(await reopened.read(ref.id, 18)).toEqual({
      ref,
      content: input.content,
    });
    expect(await reopened.list(19)).toEqual([]);
    const absent = `${ref.id[0] === "a" ? "b" : "a"}${ref.id.slice(1)}`;
    await expect(reopened.read(absent, 17)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("cannot expose an artifact through another scope even when conversation IDs collide", async () => {
    const store = await createArtifactStore({ directory, scope });
    const ref = await store.write(input);
    const otherScope = {
      ...scope,
      projectId: "other-project",
      harnessId: "other-harness",
    };
    const other = await createArtifactStore({
      directory: join(root, "other-artifacts"),
      scope: otherScope,
    });
    await expect(other.read(ref.id, 17)).rejects.toThrow();
    expect(await other.list(17)).toEqual([]);
    await expect(
      (async () =>
        (await createArtifactStore({ directory, scope: otherScope })).read(
          ref.id,
          17,
        ))(),
    ).rejects.toThrow();
    expect(await store.read(ref.id, 17)).toEqual({
      ref,
      content: input.content,
    });
  });

  it("measures the one MiB bound in UTF-8 bytes and rejects invalid surrogate conversion", async () => {
    const store = await createArtifactStore({ directory, scope });
    const content = "😀".repeat(262_144);
    const ref = await store.write({ ...input, content });
    expect(ref.byteLength).toBe(1_048_576);
    expect((await store.read(ref.id, 17)).content).toBe(content);
    for (const invalid of [`${content}a`, "\ud800", "\udfff"]) {
      await expect(
        store.write({
          ...input,
          operationId: "invalid-write",
          content: invalid,
        }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(await store.list(17)).toEqual([ref]);
  });

  it("treats names as labels rather than paths and rejects invalid identifiers without touching external files", async () => {
    const store = await createArtifactStore({ directory, scope });
    const sentinel = join(root, "sentinel.md");
    await writeFile(sentinel, "Owned sentinel");
    for (const [index, name] of [
      "../sentinel.md",
      sentinel,
      "folder/plan.md",
      "folder\\plan.md",
    ].entries()) {
      const ref = await store.write({
        ...input,
        operationId: `label-${index}`,
        name,
      });
      expect(ref.name).toBe(name);
      expect(ref.id).not.toBe(name);
      expect((await store.read(ref.id, 17)).content).toBe(input.content);
    }
    await expect(
      store.write({ ...input, name: "\u0000plan.md" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    for (const conversationId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        store.write({ ...input, conversationId }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    await expect(store.read("../sentinel.md", 17)).rejects.toThrow();
    expect(await readFile(sentinel, "utf8")).toBe("Owned sentinel");
    expect(await store.list(17)).toHaveLength(4);
  });

  it("does not publish a failed atomic write or broaden grants when a requested source is unauthorized", async () => {
    const store = await createArtifactStore({ directory, scope });
    const ref = await store.write(input);
    const forbidden = await store.write({
      ...input,
      conversationId: 18,
      operationId: "other-private-write",
    });
    await expect(
      store.grant([ref.id, forbidden.id], 17, 19),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await store.list(19)).toEqual([]);
    const rename = vi
      .spyOn(filesystem, "rename")
      .mockRejectedValueOnce(new Error("Atomic commit rejected"));
    await expect(
      store.write({
        ...input,
        operationId: "failed-commit",
        content: "Uncommitted artifact",
      }),
    ).rejects.toThrow();
    rename.mockRestore();
    expect(await store.list(17)).toEqual([ref]);
    const written = await store.write({
      ...input,
      operationId: "failed-commit",
      content: "Uncommitted artifact",
    });
    expect((await store.read(written.id, 17)).content).toBe(
      "Uncommitted artifact",
    );
    expect(
      (await readdir(directory)).some((path) => path.endsWith(".tmp")),
    ).toBe(false);
  });

  it("detects altered artifact content and a replaced store root instead of returning untrusted data", async () => {
    const store = await createArtifactStore({ directory, scope });
    const ref = await store.write(input);
    for (const file of await readdir(directory, { recursive: true })) {
      const path = join(directory, file);
      if (!(await lstat(path)).isFile()) continue;
      const source = await readFile(path, "utf8");
      if (source === input.content) await writeFile(path, "Tampered data");
      else if (source.includes(JSON.stringify(input.content)))
        await writeFile(
          path,
          source.replace(
            JSON.stringify(input.content),
            JSON.stringify("Tampered data"),
          ),
        );
    }
    await expect(store.read(ref.id, 17)).rejects.toMatchObject({
      code: "binding_mismatch",
    });
    const outside = join(root, "replacement-store");
    await filesystem.rename(directory, outside);
    await symlink(outside, directory);
    await expect(store.list(17)).rejects.toMatchObject({
      code: "binding_mismatch",
    });
  });

  it("rejects corrupted persisted metadata and validates grant limits before publishing permissions", async () => {
    const store = await createArtifactStore({ directory, scope });
    const ref = await store.write(input);
    const path = await metadataPath(ref.id);
    const original = await readFile(path, "utf8");
    const record = JSON.parse(original);
    for (const candidate of [
      {},
      { ...record, grants: [-1] },
      {
        ...record,
        ref: {
          ...record.ref,
          projectId: "other",
          scope: { ...scope, projectId: "other" },
        },
      },
      { ...record, ref: { ...record.ref, taskId: 0 } },
      { ...record, ref: { ...record.ref, sha256: "wrong" } },
    ]) {
      await writeFile(path, JSON.stringify(candidate));
      await expect(store.read(ref.id, 17)).rejects.toMatchObject({
        code: "binding_mismatch",
      });
    }
    await writeFile(path, original);
    await expect(
      store.grant(Array<string>(101).fill(ref.id), 17, 18),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await store.grant([ref.id], 17, 17);
    await writeFile(
      path,
      JSON.stringify({
        ...record,
        grants: Array.from({ length: 4096 }, (_, index) => index + 100),
      }),
    );
    await expect(store.grant([ref.id], 17, 18)).rejects.toMatchObject({
      code: "invalid_request",
    });
    await store.grant([ref.id], 17, 100);
    expect((await store.read(ref.id, 100)).content).toBe(input.content);
  });

  it("rejects malformed, oversized and multiply-linked persisted records without following outside resources", async () => {
    const store = await createArtifactStore({ directory, scope });
    const ref = await store.write(input);
    const path = await metadataPath(ref.id);
    const original = await readFile(path, "utf8");
    for (const bytes of [
      Buffer.from("{"),
      Buffer.from([0xff]),
      Buffer.alloc(200_000, 32),
    ]) {
      await writeFile(path, bytes);
      await expect(store.read(ref.id, 17)).rejects.toMatchObject({
        code: "binding_mismatch",
      });
    }
    await writeFile(path, original);
    const hardlink = join(root, "linked-metadata");
    await link(path, hardlink);
    await expect(store.read(ref.id, 17)).rejects.toMatchObject({
      code: "binding_mismatch",
    });
    await expect(store.grant([ref.id], 17, 18)).rejects.toMatchObject({
      code: "binding_mismatch",
    });
    await rm(hardlink);
    const ownerPath = join(directory, "owner.json");
    const owner = await readFile(ownerPath, "utf8");
    await writeFile(
      ownerPath,
      JSON.stringify({ kind: "other-store", scope: "foreign" }),
    );
    await expect(store.list(17)).rejects.toMatchObject({
      code: "binding_mismatch",
    });
    await writeFile(ownerPath, owner);
    expect((await store.read(ref.id, 17)).content).toBe(input.content);
  });

  it("rejects invalid text and identity metadata and sanitizes directory creation failures", async () => {
    const store = await createArtifactStore({ directory, scope });
    for (const candidate of [
      { ...input, content: 1 },
      { ...input, taskId: 0 },
      { ...input, operationId: "" },
      { ...input, mediaType: "" },
      { ...input, operationId: "\ud800" },
      { ...input, mediaType: "\ud800" },
    ])
      await expect(
        store.write(candidate as typeof input),
      ).rejects.toMatchObject({ code: "invalid_request" });
    vi.mocked(filesystem.mkdir).mockRejectedValueOnce(
      new Error("private-secret mkdir failure"),
    );
    await expect(
      createArtifactStore({ directory: join(root, "failed-store"), scope }),
    ).rejects.toMatchObject({ code: "binding_mismatch" });
    expect(await store.list(17)).toEqual([]);
  });

  it("refuses a symlinked store root rather than adopting another directory", async () => {
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "sentinel.txt"), "Owned outside sentinel");
    await symlink(outside, directory);
    await expect(createArtifactStore({ directory, scope })).rejects.toThrow();
    expect(await readdir(outside)).toEqual(["sentinel.txt"]);
  });

  it("refuses a symlink swapped into an artifact's persisted content instead of reading the target", async () => {
    const store = await createArtifactStore({ directory, scope });
    const ref = await store.write(input);
    let contentPath: string | undefined;
    for (const file of await readdir(directory, { recursive: true })) {
      const path = join(directory, file);
      if ((await lstat(path)).isFile()) {
        const stored = await readFile(path, "utf8");
        if (
          stored === input.content ||
          stored.includes(JSON.stringify(input.content))
        ) {
          contentPath = path;
          break;
        }
      }
    }
    if (!contentPath) throw new Error("Expected persisted artifact bytes");
    const target = join(root, "private.txt");
    await writeFile(target, "Private symlink target");
    await rm(contentPath);
    await symlink(target, contentPath);
    await expect(store.read(ref.id, 17)).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("Private symlink target");
  });
});
