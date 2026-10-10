import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startDaemonServer } from "./localRuntime.js";
import { startPreview } from "./preview.js";

vi.mock("./localRuntime.js", () => ({ startDaemonServer: vi.fn() }));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "frogie-preview-test-"));
  vi.mocked(startDaemonServer)
    .mockReset()
    .mockResolvedValue({
      origin: "test",
      url: "test",
      close: async () => undefined,
    });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("copies tracked definitions into an owned isolated workspace before booting", async () => {
  const directory = join(root, "preview");
  await startPreview({
    directory,
    port: 0,
    definitionsDirectory: resolve("tests/fixtures"),
  });
  expect(
    JSON.parse(await readFile(join(directory, "owner.json"), "utf8")),
  ).toMatchObject({ runId: expect.any(String), root: directory });
  expect(
    await readFile(
      join(directory, "workspace/squads/minimal-squad/SQUAD.md"),
      "utf8",
    ),
  ).toContain("id: minimal-squad");
  expect(startDaemonServer).toHaveBeenCalledWith({
    directory,
    port: 0,
    definitionsDirectory: join(directory, "workspace/squads"),
    mode: "e2e",
  });
});
it("copies the repository squads by default", async () => {
  const directory = join(root, "default");
  await startPreview({ directory });
  expect(
    await readFile(
      join(directory, "workspace/squads/zeppelin/SQUAD.md"),
      "utf8",
    ),
  ).toContain("id: zeppelin");
});
it("preserves a preexisting unowned directory", async () => {
  const directory = join(root, "existing");
  await mkdir(directory);
  await writeFile(join(directory, "keep.txt"), "Keep");
  await expect(startPreview({ directory })).rejects.toMatchObject({
    code: "EEXIST",
  });
  expect(await readFile(join(directory, "keep.txt"), "utf8")).toBe("Keep");
  expect(startDaemonServer).not.toHaveBeenCalled();
});
