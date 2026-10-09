import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import * as runtimeModule from "@frogie/core/runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startLocalServer } from "./localServer.js";
import { startPreview } from "./preview.js";

vi.mock("./localServer.js", () => ({ startLocalServer: vi.fn() }));

const publicOrigin = "https://frogie.dev.hexly.ai";
const serverClose = vi.fn(async () => undefined);
const openRuntime = runtimeModule.openRuntime;
const runtimes: Awaited<ReturnType<typeof openRuntime>>[] = [];
const previews: Awaited<ReturnType<typeof startPreview>>[] = [];
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "frogie-preview-test-"));
  serverClose.mockClear();
  vi.mocked(startLocalServer)
    .mockReset()
    .mockResolvedValue({
      origin: publicOrigin,
      url: `${publicOrigin}/#token=preview-test-token`,
      close: serverClose,
    });
  vi.spyOn(runtimeModule, "openRuntime").mockImplementation(async (...args) => {
    const runtime = await openRuntime(...args);
    runtimes.push(runtime);
    vi.spyOn(runtime, "close");
    return runtime;
  });
});

afterEach(async () => {
  for (const preview of previews.splice(0)) await preview.close();
  for (const runtime of runtimes.splice(0))
    await runtime.close(BACKGROUND_CONTEXT);
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("runs a no-cost Pi conversation with editable definitions and preserves its SQLite on close", async () => {
  const directory = join(root, "owned-preview");
  const preview = await startPreview({ directory });
  previews.push(preview);
  expect(preview.origin).toBe(publicOrigin);
  expect(preview.url).toBe(`${publicOrigin}/#token=preview-test-token`);
  expect(startLocalServer).toHaveBeenCalledOnce();
  const options = vi.mocked(startLocalServer).mock.calls[0]?.[0];
  expect(options).toMatchObject({ publicOrigin, port: 7033 });
  if (!options?.definitions) throw new Error("Expected definition workspace");
  expect(options.publicDirectory?.replaceAll("\\", "/")).toMatch(
    /\/apps\/dashboard\/dist$/,
  );
  const squads = await options.definitions.list();
  expect(squads).toHaveLength(1);
  const squad = squads[0];
  if (!squad) throw new Error("Expected preview squad");
  const definition = await options.definitions.load(squad.id);
  expect(definition.squadId).toBe(options.scope.squadId);
  expect(definition.roles.length).toBeGreaterThan(0);
  const call = { scope: options.scope, caller: { id: "local-user" } };
  const created = await options.service.createConversation(
    { ...call, input: { roleId: definition.rootRoleId } },
    options.context,
  );
  const submissionId = await options.service.submit(
    {
      ...call,
      input: {
        conversationId: created.conversationId,
        submission: { type: "input", content: "Verify preview communication" },
      },
    },
    options.context,
  );
  await vi.waitFor(async () => {
    const submission = await options.service.getSubmission(
      { ...call, input: { submissionId } },
      options.context,
    );
    expect(submission?.status).toBe("done");
  });
  const watch = await options.service.observeConversation(
    { ...call, input: { conversationId: created.conversationId } },
    options.context,
  );
  try {
    const answer = JSON.stringify(
      watch.value.entries.flatMap((entry) =>
        (entry.model ?? []).filter((message) => message.role === "assistant"),
      ),
    );
    expect(answer).toContain("本地测试模式");
    expect(answer).toContain("Verify preview communication");
  } finally {
    await watch.stop();
  }
  await preview.close();
  await preview.close();
  expect(serverClose).toHaveBeenCalledOnce();
  expect(runtimes[0]?.close).toHaveBeenCalledOnce();
  const files = await readdir(directory, { recursive: true });
  expect(files.some((file) => file.endsWith(".sqlite"))).toBe(true);
  expect(files.some((file) => file.endsWith("SQUAD.md"))).toBe(true);
});

it("passes an explicit port to the loopback server", async () => {
  const preview = await startPreview({
    directory: join(root, "custom-port"),
    port: 0,
  });
  previews.push(preview);
  expect(startLocalServer).toHaveBeenCalledWith(
    expect.objectContaining({ publicOrigin, port: 0 }),
  );
});

it("rejects an existing data directory without altering it", async () => {
  const directory = join(root, "existing");
  await mkdir(directory);
  await writeFile(join(directory, "keep.txt"), "Existing user data");
  await expect(startPreview({ directory })).rejects.toMatchObject({
    code: "EEXIST",
  });
  expect(await readFile(join(directory, "keep.txt"), "utf8")).toBe(
    "Existing user data",
  );
  expect(await readdir(directory)).toEqual(["keep.txt"]);
  expect(startLocalServer).not.toHaveBeenCalled();
  expect(runtimeModule.openRuntime).not.toHaveBeenCalled();
});

it("closes its actual runtime if server startup fails", async () => {
  const error = new Error("Port unavailable");
  vi.mocked(startLocalServer).mockRejectedValueOnce(error);
  await expect(
    startPreview({ directory: join(root, "failed-start") }),
  ).rejects.toBe(error);
  expect(runtimes).toHaveLength(1);
  expect(runtimes[0]?.close).toHaveBeenCalledOnce();
});
