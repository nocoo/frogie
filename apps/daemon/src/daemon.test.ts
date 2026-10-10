import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type {
  ConversationId,
  ConversationView,
  ConversationWatch,
} from "@earendil-works/pi-durable";
import type {
  DaemonDirectory,
  DaemonProject,
  RuntimeScope,
  RuntimeService,
} from "@frogie/core/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { daemonModelServer } from "../../../tests/fixtures/daemon-model-server.js";
import { startDaemon } from "./daemon.js";

type Daemon = DaemonDirectory & { close(): Promise<void> };
const caller = { id: "daemon-test-owner" };
const fixture = fileURLToPath(
  new URL("../../../tests/fixtures/minimal-squad", import.meta.url),
);
const projects = [
  { projectId: "daemon-alpha", squadId: "alpha-squad", title: "Alpha Squad" },
  { projectId: "daemon-beta", squadId: "beta-squad", title: "Beta Squad" },
] as const;
let root: string;
let directory: string;
let definitionsDirectory: string;
const daemons: Daemon[] = [];

async function bounded<T>(
  promise: Promise<T>,
  operation: string,
  milliseconds = 10_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${operation} exceeded ${milliseconds}ms`)),
          milliseconds,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function copySquad(project: {
  projectId: string;
  squadId: string;
  title: string;
}) {
  const target = join(definitionsDirectory, project.squadId);
  await cp(fixture, target, { recursive: true });
  const path = join(target, "SQUAD.md");
  const source = await readFile(path, "utf8");
  await writeFile(
    path,
    source
      .replace("id: minimal-squad", `id: ${project.squadId}`)
      .replace("projectId: frogie", `projectId: ${project.projectId}`)
      .replace("title: Minimal Squad", `title: ${project.title}`),
  );
  return target;
}

async function launch(): Promise<Daemon> {
  const daemon = await bounded<Daemon>(
    startDaemon({ directory, definitionsDirectory, mode: "e2e" }),
    "daemon startup",
  );
  daemons.push(daemon);
  return daemon;
}

async function project(daemon: Daemon, projectId = "daemon-alpha") {
  const found = (await daemon.listProjects()).find(
    (value: DaemonProject) => value.projectId === projectId,
  );
  if (!found) throw new Error(`Missing project ${projectId}`);
  return found;
}

function rootId(value: DaemonProject): ConversationId {
  if (value.rootConversationId === undefined)
    throw new Error(`Missing root for ${value.projectId}`);
  return value.rootConversationId as ConversationId;
}

async function snapshot(
  service: RuntimeService,
  scope: RuntimeScope,
  conversationId: ConversationId,
) {
  const watch = await service.observeConversation(
    { scope, caller, input: { conversationId } },
    context,
  );
  try {
    return watch.value;
  } finally {
    await watch.stop();
  }
}

async function answer(
  daemon: Daemon,
  value: DaemonProject,
  content: string,
  requestId = content,
) {
  const service = daemon.runtime(value.scope);
  const conversationId = rootId(value);
  const call = { scope: value.scope, caller };
  const watch: ConversationWatch = await service.observeConversation(
    { ...call, input: { conversationId } },
    context,
  );
  let resolve!: (view: ConversationView) => void;
  let reject!: (error: unknown) => void;
  const settled = new Promise<ConversationView>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  let submissionId: Awaited<ReturnType<RuntimeService["submit"]>> | undefined;
  async function check(view: ConversationView) {
    if (submissionId === undefined) return;
    const record = await service.getSubmission(
      { ...call, input: { submissionId } },
      context,
    );
    if (record?.status === "unanswered")
      reject(new Error(`Submission failed: ${record.reason}`));
    if (
      record?.status === "done" &&
      record.type === "input" &&
      view.entries.some((entry) => entry.id === record.answer)
    )
      resolve(view);
  }
  watch.start(async (view) => {
    try {
      await check(view);
    } catch (error) {
      reject(error);
    }
  });
  try {
    submissionId = await service.submit(
      {
        ...call,
        input: {
          conversationId,
          submission: { type: "input", content, requestId },
        },
      },
      context,
    );
    await check(watch.value);
    const view = await bounded(settled, `answer for ${value.projectId}`);
    const submission = await service.getSubmission(
      { ...call, input: { submissionId } },
      context,
    );
    expect(submission).toMatchObject({
      id: submissionId,
      conversationId,
      requestId,
      status: "done",
    });
    const assistants = view.entries.flatMap((entry) =>
      (entry.model ?? []).filter((message) => message.role === "assistant"),
    );
    expect(assistants.length).toBeGreaterThan(0);
    return { submissionId, submission, entries: view.entries };
  } finally {
    await watch.stop();
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "frogie-daemon-test-"));
  directory = join(root, "runtime");
  definitionsDirectory = join(root, "definitions");
  await Promise.all(projects.map(copySquad));
});

afterEach(async () => {
  try {
    const results = await Promise.allSettled(
      daemons
        .splice(0)
        .map((daemon) => bounded(daemon.close(), "daemon cleanup")),
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length)
      throw new AggregateError(errors, "Daemon cleanup failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe("daemon directory", { timeout: 30_000 }, () => {
  it("enumerates independent roots and SQLite while rejecting invalid scopes before parallel submissions", async () => {
    const daemon = await launch();
    expect(daemon.instanceId).toEqual(expect.any(String));
    expect(daemon.instanceId.length).toBeGreaterThan(0);
    expect(daemon.mode).toBe("e2e");
    const listed = await daemon.listProjects();
    expect(
      listed.map((value: DaemonProject) => value.projectId).sort(),
    ).toEqual(projects.map((value) => value.projectId));
    for (const expected of projects) {
      const value = await project(daemon, expected.projectId);
      expect(value).toMatchObject({
        projectId: expected.projectId,
        enabled: true,
        state: "running",
        scope: { projectId: expected.projectId, squadId: expected.squadId },
      });
      for (const field of [
        "projectId",
        "environmentId",
        "squadId",
        "harnessId",
      ] as const)
        expect(value.scope[field].length).toBeGreaterThan(0);
      expect(value.definitionHash.length).toBeGreaterThan(0);
      const service = daemon.runtime(value.scope);
      expect(
        await service.describe(
          { scope: value.scope, caller, input: {} },
          context,
        ),
      ).toMatchObject({
        protocolVersion: 1,
        scope: value.scope,
        runtimeId: expect.any(String),
      });
      const conversations = await service.listConversations(
        { scope: value.scope, caller, input: {} },
        context,
      );
      expect(conversations).toEqual([
        expect.objectContaining({
          conversation: expect.objectContaining({ id: rootId(value) }),
          binding: expect.objectContaining({
            roleId: "command",
            definitionHash: value.definitionHash,
          }),
        }),
      ]);
    }
    const alpha = await project(daemon);
    const beta = await project(daemon, "daemon-beta");
    const alphaService = daemon.runtime(alpha.scope);
    const created = await alphaService.createConversation(
      { scope: alpha.scope, caller, input: { roleId: "reviewer" } },
      context,
    );
    expect(created.conversationId).not.toBe(rootId(alpha));
    expect(
      await daemon
        .runtime(beta.scope)
        .listConversations({ scope: beta.scope, caller, input: {} }, context),
    ).toHaveLength(1);
    for (const field of [
      "projectId",
      "environmentId",
      "squadId",
      "harnessId",
    ] as const) {
      const forged = { ...alpha.scope, [field]: "unbound-value" };
      expect(() => daemon.runtime(forged)).toThrow(
        expect.objectContaining({ code: "binding_mismatch" }),
      );
      await expect(
        alphaService.submit(
          {
            scope: forged,
            caller,
            input: {
              conversationId: rootId(alpha),
              submission: { type: "input", content: "Must never enter Pi" },
            },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
      expect(
        (await snapshot(alphaService, alpha.scope, rootId(alpha))).entries,
      ).toHaveLength(0);
      expect(
        (await snapshot(daemon.runtime(beta.scope), beta.scope, rootId(beta)))
          .entries,
      ).toHaveLength(0);
      const incomplete = { ...alpha.scope };
      Reflect.deleteProperty(incomplete, field);
      expect(() => daemon.runtime(incomplete as RuntimeScope)).toThrow();
      await expect(
        alphaService.submit(
          {
            scope: incomplete as RuntimeScope,
            caller,
            input: {
              conversationId: rootId(alpha),
              submission: {
                type: "input",
                content: "Incomplete scope must reject",
              },
            },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "binding_mismatch" });
      for (const value of await daemon.listProjects())
        expect(
          (
            await snapshot(
              daemon.runtime(value.scope),
              value.scope,
              rootId(value),
            )
          ).entries,
        ).toHaveLength(0);
    }
    const [first, second] = await Promise.all([
      answer(daemon, alpha, "Only alpha received this request", "same-request"),
      answer(daemon, beta, "Only beta received this request", "same-request"),
    ]);
    expect(JSON.stringify(first.entries)).toContain(
      "Only alpha received this request",
    );
    expect(JSON.stringify(first.entries)).not.toContain(
      "Only beta received this request",
    );
    expect(JSON.stringify(second.entries)).toContain(
      "Only beta received this request",
    );
    expect(JSON.stringify(second.entries)).not.toContain(
      "Only alpha received this request",
    );
    await daemon.close();
    const databases = await Promise.all(
      [alpha, beta].map(async (value) => {
        const path = join(
          directory,
          "projects",
          value.projectId,
          "environments",
          value.scope.environmentId,
          "harnesses",
          value.scope.harnessId,
          "session.sqlite",
        );
        expect((await readFile(path)).subarray(0, 16).toString()).toBe(
          "SQLite format 3\u0000",
        );
        return stat(path);
      }),
    );
    expect(databases[0]?.ino).not.toBe(databases[1]?.ino);
  });

  it("has requests from both real Pi Harnesses in flight before either model response is released", async () => {
    const server = await daemonModelServer();
    let running: Promise<unknown[]> | undefined;
    let daemon: Daemon | undefined;
    try {
      daemon = await bounded<Daemon>(
        startDaemon({
          directory,
          definitionsDirectory,
          mode: "local",
          model: server.model,
        }),
        "local daemon startup",
      );
      daemons.push(daemon);
      expect(daemon.mode).toBe("local");
      const alpha = await project(daemon);
      const beta = await project(daemon, "daemon-beta");
      running = Promise.all([
        answer(daemon, alpha, "Alpha model barrier input"),
        answer(daemon, beta, "Beta model barrier input"),
      ]);
      await bounded(
        Promise.race([
          server.entered,
          running.then(() => {
            throw new Error(
              "Model work completed before the barrier was released",
            );
          }),
        ]),
        "two model requests reaching the barrier",
      );
      expect(server.requests).toHaveLength(2);
      const inputs = server.requests.map((request) =>
        JSON.stringify(request.messages),
      );
      expect(
        inputs.filter((input) => input.includes("Alpha model barrier input")),
      ).toHaveLength(1);
      expect(
        inputs.filter((input) => input.includes("Beta model barrier input")),
      ).toHaveLength(1);
      expect(
        inputs.every(
          (input) =>
            !(
              input.includes("Alpha model barrier input") &&
              input.includes("Beta model barrier input")
            ),
        ),
      ).toBe(true);
      server.release();
      await bounded(running, "parallel model replies");
    } finally {
      server.release();
      try {
        if (running)
          await bounded(
            running.catch(() => undefined),
            "model barrier cleanup",
          );
      } finally {
        try {
          if (daemon) await bounded(daemon.close(), "local daemon cleanup");
        } finally {
          await bounded(server.close(), "model server cleanup");
        }
      }
    }
  });

  it("stops one project while the other continues and reenables the original binding", async () => {
    const daemon = await launch();
    const alpha = await project(daemon);
    const beta = await project(daemon, "daemon-beta");
    const oldService = daemon.runtime(alpha.scope);
    const history = await answer(
      daemon,
      alpha,
      "Alpha history before stopping",
    );
    expect(
      await bounded(
        daemon.setProjectEnabled(alpha.projectId, false),
        "stop alpha",
      ),
    ).toMatchObject({ enabled: false, state: "stopped", scope: alpha.scope });
    expect(await project(daemon, beta.projectId)).toMatchObject({
      state: "running",
      scope: beta.scope,
    });
    await expect(
      oldService.submit(
        {
          scope: alpha.scope,
          caller,
          input: {
            conversationId: rootId(alpha),
            submission: {
              type: "input",
              content: "Stopped project must reject",
            },
          },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "runtime_unavailable" });
    await answer(daemon, beta, "Beta still works after alpha stops");
    const resumed = await bounded(
      daemon.setProjectEnabled(alpha.projectId, true),
      "restart alpha",
    );
    expect(resumed).toMatchObject({
      enabled: true,
      state: "running",
      scope: alpha.scope,
      rootConversationId: rootId(alpha),
    });
    expect(
      (
        await snapshot(
          daemon.runtime(resumed.scope),
          resumed.scope,
          rootId(resumed),
        )
      ).entries,
    ).toEqual(history.entries);
    await answer(
      daemon,
      resumed,
      "Alpha continues in its original conversation",
    );
  });

  it("rejects a second owner, remains operational and closes idempotently while releasing watchers and its lock", async () => {
    const daemon = await launch();
    const alpha = await project(daemon);
    const service = daemon.runtime(alpha.scope);
    const before = await daemon.listProjects();
    const files = await readdir(directory, { recursive: true });
    await expect(
      bounded(
        startDaemon({ directory, definitionsDirectory, mode: "e2e" }),
        "second owner startup",
      ),
    ).rejects.toMatchObject({ code: "storage_in_use" });
    expect(await daemon.listProjects()).toEqual(before);
    expect(await readdir(directory, { recursive: true })).toEqual(files);
    await answer(daemon, alpha, "First owner remains operational");
    const watch = await service.observeConversation(
      { scope: alpha.scope, caller, input: { conversationId: rootId(alpha) } },
      context,
    );
    try {
      await bounded(
        Promise.all([daemon.close(), daemon.close()]),
        "concurrent daemon close",
      );
      await bounded(daemon.close(), "repeated daemon close");
      expect(["session_closed", "stopped", "cancelled"]).toContain(
        (await bounded(watch.closed, "watch closure")).reason,
      );
      await expect(
        service.submit(
          {
            scope: alpha.scope,
            caller,
            input: {
              conversationId: rootId(alpha),
              submission: {
                type: "input",
                content: "Closed daemon must reject",
              },
            },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: "runtime_unavailable" });
      const reopened = await launch();
      expect(reopened.instanceId).toBe(daemon.instanceId);
      expect(await project(reopened)).toMatchObject({
        scope: alpha.scope,
        rootConversationId: rootId(alpha),
      });
    } finally {
      await watch.stop();
    }
  });

  it("reopens both original SQLite histories and stable runtime identities without duplicating submissions", async () => {
    const daemon = await launch();
    const alpha = await project(daemon);
    const beta = await project(daemon, "daemon-beta");
    const scopes = [alpha, beta];
    const descriptions = await Promise.all(
      scopes.map((value) =>
        daemon
          .runtime(value.scope)
          .describe({ scope: value.scope, caller, input: {} }, context),
      ),
    );
    const histories = await Promise.all(
      scopes.map((value) =>
        answer(
          daemon,
          value,
          `${value.projectId} persisted input`,
          "persisted-request",
        ),
      ),
    );
    await daemon.close();
    const reopened = await launch();
    expect(reopened.instanceId).toBe(daemon.instanceId);
    for (const [index, previous] of scopes.entries()) {
      const current = await project(reopened, previous.projectId);
      expect(current).toMatchObject({
        scope: previous.scope,
        rootConversationId: rootId(previous),
        definitionHash: previous.definitionHash,
        state: "running",
      });
      const service = reopened.runtime(current.scope);
      expect(
        await service.describe(
          { scope: current.scope, caller, input: {} },
          context,
        ),
      ).toEqual(descriptions[index]);
      const history = histories[index];
      if (!history) throw new Error("Missing saved history");
      expect(
        (await snapshot(service, current.scope, rootId(current))).entries,
      ).toEqual(history.entries);
      expect(
        await service.getSubmission(
          {
            scope: current.scope,
            caller,
            input: { submissionId: history.submissionId },
          },
          context,
        ),
      ).toEqual(history.submission);
      expect(
        await service.submit(
          {
            scope: current.scope,
            caller,
            input: {
              conversationId: rootId(current),
              submission: {
                type: "input",
                content: `${current.projectId} persisted input`,
                requestId: "persisted-request",
              },
            },
          },
          context,
        ),
      ).toBe(history.submissionId);
      expect(
        (await snapshot(service, current.scope, rootId(current))).entries,
      ).toEqual(history.entries);
      await answer(
        reopened,
        current,
        `${current.projectId} continued after restart`,
      );
    }
  });

  it("persists a stopped project across daemon restarts while another project remains usable", async () => {
    const daemon = await launch();
    const alpha = await project(daemon);
    await daemon.setProjectEnabled(alpha.projectId, false);
    await daemon.close();
    const reopened = await launch();
    expect(await project(reopened)).toMatchObject({
      enabled: false,
      state: "stopped",
      scope: alpha.scope,
    });
    await answer(
      reopened,
      await project(reopened, "daemon-beta"),
      "Running project after restart",
    );
  });

  it("keeps a project with an invalid role definition isolated from healthy projects", async () => {
    const target = await copySquad({
      projectId: "daemon-broken",
      squadId: "broken-squad",
      title: "Broken Squad",
    });
    const role = join(target, "roles", "command", "ROLE.md");
    await writeFile(
      role,
      (await readFile(role, "utf8")).replace(
        "skills: [planning]",
        "skills: [missing-skill]",
      ),
    );
    const daemon = await launch();
    const broken = await project(daemon, "daemon-broken");
    expect(broken).toMatchObject({
      state: "error",
      error: { code: "invalid_definition" },
    });
    expect(() => daemon.runtime(broken.scope)).toThrow(
      expect.objectContaining({ code: "runtime_unavailable" }),
    );
    await Promise.all([
      answer(
        daemon,
        await project(daemon),
        "Healthy alpha with broken neighbor",
      ),
      answer(
        daemon,
        await project(daemon, "daemon-beta"),
        "Healthy beta with broken neighbor",
      ),
    ]);
    expect(await project(daemon, broken.projectId)).toMatchObject({
      state: "error",
    });
  });

  it("registers a newly added definition without replacing existing project bindings", async () => {
    const daemon = await launch();
    const before = await daemon.listProjects();
    await copySquad({
      projectId: "daemon-gamma",
      squadId: "gamma-squad",
      title: "Gamma Squad",
    });
    const registered = await daemon.registerProject("gamma-squad");
    expect(registered).toMatchObject({
      projectId: "daemon-gamma",
      state: "running",
      enabled: true,
      scope: { projectId: "daemon-gamma", squadId: "gamma-squad" },
    });
    expect(await daemon.listProjects()).toHaveLength(3);
    for (const value of before)
      expect(await project(daemon, value.projectId)).toEqual(value);
    await answer(daemon, registered, "New project works immediately");
  });

  it("retains the frozen binding after source edits until an explicit bind", async () => {
    const daemon = await launch();
    const alpha = await project(daemon);
    const beta = await project(daemon, "daemon-beta");
    const role = join(
      definitionsDirectory,
      alpha.scope.squadId,
      "roles",
      "command",
      "ROLE.md",
    );
    await writeFile(
      role,
      `${await readFile(role, "utf8")}\nUse the revised mission wording.\n`,
    );
    expect(await project(daemon)).toEqual(alpha);
    await daemon.close();
    const reopened = await launch();
    expect(await project(reopened)).toMatchObject({
      scope: alpha.scope,
      definitionHash: alpha.definitionHash,
      rootConversationId: rootId(alpha),
    });
    const rebound = await reopened.bindDefinition(alpha.projectId);
    expect(rebound.projectId).toBe(alpha.projectId);
    expect(rebound.scope.squadId).toBe(alpha.scope.squadId);
    expect(rebound.definitionHash).not.toBe(alpha.definitionHash);
    expect(rebound.state).toBe("running");
    expect(await project(reopened, beta.projectId)).toMatchObject({
      scope: beta.scope,
      definitionHash: beta.definitionHash,
      rootConversationId: rootId(beta),
    });
    await answer(reopened, rebound, "Explicitly bound definition works");
  });
});
