import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type {
  DaemonDirectory,
  DaemonProject,
  RuntimeBudgetSnapshot,
  RuntimeDescription,
  RuntimeScope,
  RuntimeService,
} from "@frogie/core/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { version } from "../../../../package.json";
import { localDirectory } from "../../../../tests/fixtures/local-directory.js";
import { createDefinitionWorkspace } from "./definitions.js";
import { type LocalServer, startLocalServer } from "./localServer.js";

const scope: RuntimeScope = {
  projectId: "frogie",
  environmentId: "test-env",
  squadId: "zeppelin",
  harnessId: "harness-1",
};
const instanceId = "instance-1";
const budget: RuntimeBudgetSnapshot = {
  limits: { modelRequests: 12, toolEntries: 24, modelConcurrency: 2 },
  consumed: { modelRequests: 3, toolEntries: 5 },
};
type Watch = Awaited<ReturnType<RuntimeService["observeConversation"]>>;
type View = Watch["value"];
type ConversationId = Parameters<
  RuntimeService["observeConversation"]
>[0]["input"]["conversationId"];
type SubmissionId = Awaited<ReturnType<RuntimeService["submit"]>>;
type CompactTaskId = Awaited<ReturnType<RuntimeService["compact"]>>;
const conversationId = 17 as ConversationId;
const description: RuntimeDescription = {
  protocolVersion: 1,
  runtimeId: "runtime-1",
  scope,
  bindingHash: "binding-hash",
  piVersion: "1.1.0",
  hostVersion: "0.1.0",
  models: [],
  tools: [],
  extensions: [],
  operations: [],
};
const snapshot: View = {
  conversation: { id: conversationId } as View["conversation"],
  entries: [],
  docs: {},
};
const update: View = {
  ...snapshot,
  entries: [
    {
      id: 1 as View["entries"][number]["id"],
      conversationId,
      kind: "pi.user",
    } as View["entries"][number],
  ],
};

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function runtimeService() {
  let resolveClosed!: (end: Awaited<Watch["closed"]>) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed = new Promise<Awaited<Watch["closed"]>>((resolve) => {
    resolveClosed = resolve;
  });
  const watch: Watch = {
    value: snapshot,
    start: vi.fn<Watch["start"]>((listener) => {
      void listener(snapshot, [], BACKGROUND_CONTEXT);
      timer = setTimeout(() => {
        void listener(update, [], BACKGROUND_CONTEXT);
      }, 0);
    }),
    stop: vi.fn(async () => {
      if (timer !== undefined) clearTimeout(timer);
      const end: Awaited<Watch["closed"]> = { reason: "stopped" };
      resolveClosed(end);
      return end;
    }),
    closed,
  };
  const calls = {
    describe: vi.fn<RuntimeService["describe"]>(async () => description),
    listConversations: vi.fn<RuntimeService["listConversations"]>(
      async () => [],
    ),
    observeConversation: vi.fn<RuntimeService["observeConversation"]>(
      async () => watch,
    ),
    createConversation: vi.fn<RuntimeService["createConversation"]>(
      async (call) => {
        const id = (Number(conversationId) + 1) as ConversationId;
        return {
          conversationId: id,
          binding: {
            conversationId: id,
            roleId: call.input.roleId,
            definitionHash: "definition-hash",
            configHash: "config-hash",
            title: "Reviewer",
          },
        };
      },
    ),
    submit: vi.fn<RuntimeService["submit"]>(
      async (_call: Parameters<RuntimeService["submit"]>[0]) =>
        23 as SubmissionId,
    ),
    getSubmission: vi.fn<RuntimeService["getSubmission"]>(
      async (_call: Parameters<RuntimeService["getSubmission"]>[0]) =>
        undefined,
    ),
    cancel: vi.fn<RuntimeService["cancel"]>(async () => "aborted"),
    compact: vi.fn<RuntimeService["compact"]>(async () => 42 as CompactTaskId),
    inspect: vi.fn<RuntimeService["inspect"]>(async (call) => ({
      scope: call.scope,
      scheduling: "paused",
      graph: { tasks: {} },
      usage: { models: {}, tools: {} },
    })),
    listEntries: vi.fn<RuntimeService["listEntries"]>(async () => ({
      items: [],
      cursor: null,
    })),
    listTasks: vi.fn<RuntimeService["listTasks"]>(async () => ({
      items: [],
      cursor: null,
    })),
    getTask: vi.fn<RuntimeService["getTask"]>(async () => undefined),
    extendBudget: vi.fn<RuntimeService["extendBudget"]>(async () => budget),
  };
  const service: RuntimeService = calls;
  return { service, calls, watch };
}

const activeServers: LocalServer[] = [];
const definitionRoots: string[] = [];

async function launch(
  definitions?: ReturnType<typeof createDefinitionWorkspace>,
  directory?: DaemonDirectory,
) {
  const runtime = runtimeService();
  const server = await startLocalServer({
    directory: directory ?? localDirectory(instanceId, scope, runtime.service),
    context: BACKGROUND_CONTEXT,
    port: 0,
    ...(definitions === undefined ? {} : { definitions }),
  });
  activeServers.push(server);
  return { server, runtime };
}

async function start(
  definitions?: ReturnType<typeof createDefinitionWorkspace>,
  directory?: DaemonDirectory,
) {
  const { server, runtime } = await launch(definitions, directory);
  const token = new URLSearchParams(new URL(server.url).hash.slice(1)).get(
    "token",
  );
  if (!token) throw new Error("Missing startup token");
  const exchange = await fetch(`${server.origin}/__local/auth/exchange`, {
    method: "POST",
    headers: {
      Origin: server.origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
  const credentials = (await exchange.json()) as {
    csrf: string;
    caller: { id: string };
  };
  const setCookie = exchange.headers.getSetCookie()[0];
  if (!setCookie) throw new Error("Missing local session cookie");
  const cookie = setCookie.split(";", 1)[0] ?? "";
  return { server, runtime, credentials, cookie, watch: runtime.watch };
}

async function post(
  origin: string,
  path: string,
  cookie: string,
  csrf: string,
  body: unknown,
  requestOrigin = origin,
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      "X-Frogie-CSRF": csrf,
    },
    body: JSON.stringify(body),
  });
}

const operationPath = (name: string) =>
  `/__local/instances/${instanceId}/operations/${name}`;

afterEach(async () => {
  const servers = activeServers.splice(0);
  await Promise.all(servers.map((server) => server.close()));
  for (const root of definitionRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("local project transport", () => {
  async function directoryFixture() {
    const first = runtimeService();
    const second = runtimeService();
    const otherScope = {
      ...scope,
      projectId: "other-project",
      squadId: "other-squad",
      harnessId: "other-harness",
    };
    const firstDirectory = localDirectory(instanceId, scope, first.service);
    const secondDirectory = localDirectory(
      instanceId,
      otherScope,
      second.service,
    );
    const [otherProject] = await secondDirectory.listProjects();
    if (!otherProject) throw new Error("Missing fixture project");
    const listProjects = vi.fn(async () => [
      ...(await firstDirectory.listProjects()),
      ...(await secondDirectory.listProjects()),
    ]);
    const setProjectEnabled = vi.fn<DaemonDirectory["setProjectEnabled"]>(
      async (projectId, enabled) => ({
        ...otherProject,
        projectId,
        enabled,
        state: enabled ? "running" : "stopped",
      }),
    );
    const bindDefinition = vi.fn<DaemonDirectory["bindDefinition"]>(
      async () => ({
        ...otherProject,
        scope: { ...otherScope, harnessId: "new-harness" },
        definitionHash: "new-definition",
      }),
    );
    const registerProject = vi.fn<DaemonDirectory["registerProject"]>(
      async () => otherProject,
    );
    const runtime = vi.fn<DaemonDirectory["runtime"]>((target) =>
      (target.projectId === scope.projectId
        ? firstDirectory
        : secondDirectory
      ).runtime(target),
    );
    const directory: DaemonDirectory = {
      ...firstDirectory,
      listProjects,
      runtime,
      setProjectEnabled,
      bindDefinition,
      registerProject,
    };
    return {
      directory,
      first,
      second,
      otherScope,
      listProjects,
      setProjectEnabled,
      bindDefinition,
      registerProject,
      runtime,
    };
  }

  it("refreshes project states without requiring an available Harness", async () => {
    const test = await directoryFixture();
    const projects = await test.listProjects();
    test.listProjects.mockResolvedValueOnce([]);
    test.listProjects.mockResolvedValueOnce(
      projects.map((project) => ({
        ...project,
        enabled: false,
        state: "stopped",
      })),
    );
    const { server, cookie } = await start(undefined, test.directory);
    for (const expectedCount of [0, 2]) {
      const response = await fetch(`${server.origin}/__local/context`, {
        headers: { Origin: server.origin, Cookie: cookie },
      });
      expect(response.status).toBe(200);
      const context = (await response.json()) as {
        instanceId: string;
        mode: string;
        projects: DaemonProject[];
      };
      expect(context).toMatchObject({ instanceId, mode: "e2e" });
      expect(context.projects).toHaveLength(expectedCount);
      for (const project of context.projects)
        expect(project.state).toBe("stopped");
    }
    expect(test.runtime).not.toHaveBeenCalled();
  });

  it.each([
    ["enabled", { projectId: "other-project", enabled: false }],
    ["register", { squadId: "other-squad" }],
    ["bind", { projectId: "other-project" }],
  ] as const)(
    "authorizes and forwards project %s",
    async (operation, input) => {
      const test = await directoryFixture();
      const { server, cookie, credentials } = await start(
        undefined,
        test.directory,
      );
      const path = `/__local/projects/${operation}`;
      for (const [requestCookie, csrf, requestOrigin, status] of [
        ["", credentials.csrf, server.origin, 401],
        [cookie, "", server.origin, 403],
        [cookie, credentials.csrf, "http://localhost:1234", 403],
      ] as const) {
        const response = await post(
          server.origin,
          path,
          requestCookie,
          csrf,
          input,
          requestOrigin,
        );
        expect(response.status).toBe(status);
      }
      expect(test.setProjectEnabled).not.toHaveBeenCalled();
      expect(test.registerProject).not.toHaveBeenCalled();
      expect(test.bindDefinition).not.toHaveBeenCalled();

      const response = await post(
        server.origin,
        path,
        cookie,
        credentials.csrf,
        input,
      );
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toMatchObject({
        value: {
          projectId: "other-project",
          scope: {
            ...test.otherScope,
            harnessId:
              operation === "bind" ? "new-harness" : test.otherScope.harnessId,
          },
        },
      });
      if (operation === "enabled") {
        expect(test.setProjectEnabled).toHaveBeenCalledExactlyOnceWith(
          "other-project",
          false,
        );
        expect(result).toMatchObject({
          value: { enabled: false, state: "stopped" },
        });
      } else if (operation === "register") {
        expect(test.registerProject).toHaveBeenCalledExactlyOnceWith(
          "other-squad",
        );
      } else {
        expect(test.bindDefinition).toHaveBeenCalledExactlyOnceWith(
          "other-project",
        );
        expect(result).toMatchObject({
          value: {
            definitionHash: "new-definition",
            scope: { harnessId: "new-harness" },
          },
        });
      }
    },
  );

  it("rejects unknown project operations and strict input violations before mutation", async () => {
    const test = await directoryFixture();
    const { server, cookie, credentials } = await start(
      undefined,
      test.directory,
    );
    for (const [operation, input, status] of [
      ["delete", { projectId: "other-project" }, 404],
      ["enabled", { projectId: "other-project", enabled: "false" }, 400],
      ["enabled", { projectId: "other-project" }, 400],
      ["register", { squadId: "../private" }, 400],
      ["register", { squadId: "other-squad", enabled: true }, 400],
      ["bind", {}, 400],
      ["bind", { projectId: "other-project", caller: { id: "owner" } }, 400],
    ] as const) {
      const response = await post(
        server.origin,
        `/__local/projects/${operation}`,
        cookie,
        credentials.csrf,
        input,
      );
      expect(response.status).toBe(status);
    }
    expect(test.setProjectEnabled).not.toHaveBeenCalled();
    expect(test.registerProject).not.toHaveBeenCalled();
    expect(test.bindDefinition).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404],
    ["conflict", 409],
    ["storage_in_use", 409],
    ["invalid_definition", 400],
    ["unrecognized", 500],
  ])("sanitizes project management failure %s", async (code, status) => {
    const test = await directoryFixture();
    test.bindDefinition.mockRejectedValueOnce(
      Object.assign(new Error("private-secret at /private/model.json"), {
        code,
      }),
    );
    const { server, cookie, credentials } = await start(
      undefined,
      test.directory,
    );
    const response = await post(
      server.origin,
      "/__local/projects/bind",
      cookie,
      credentials.csrf,
      { projectId: "other-project" },
    );
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).not.toContain("private-secret");
    expect(text).not.toContain("/private/");
    expect(JSON.parse(text)).toMatchObject({
      error: {
        code: code === "unrecognized" ? "runtime_unavailable" : code,
        retryable: false,
      },
    });
  });

  it("routes overlapping conversation IDs only to their full project scope", async () => {
    const test = await directoryFixture();
    const { server, cookie, credentials } = await start(
      undefined,
      test.directory,
    );
    for (const [target, runtime] of [
      [scope, test.first],
      [test.otherScope, test.second],
    ] as const) {
      const input = {
        conversationId,
        submission: { type: "input", content: target.projectId },
      };
      const response = await post(
        server.origin,
        operationPath("submit"),
        cookie,
        credentials.csrf,
        { scope: target, input },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ scope: target, value: 23 });
      expect(runtime.calls.submit).toHaveBeenCalledExactlyOnceWith(
        { scope: target, input, caller: credentials.caller },
        BACKGROUND_CONTEXT,
      );
    }
    const forged = await post(
      server.origin,
      operationPath("submit"),
      cookie,
      credentials.csrf,
      {
        scope: { ...scope, projectId: test.otherScope.projectId },
        input: {
          conversationId,
          submission: { type: "input", content: "forged" },
        },
      },
    );
    expect(forged.status).toBe(409);
    expect(test.first.calls.submit).toHaveBeenCalledOnce();
    expect(test.second.calls.submit).toHaveBeenCalledOnce();
  });

  it("keeps project SSE watches independent when one browser unsubscribes", async () => {
    const test = await directoryFixture();
    const { server, cookie, credentials } = await start(
      undefined,
      test.directory,
    );
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    try {
      for (const target of [scope, test.otherScope]) {
        const response = await post(
          server.origin,
          operationPath("observeConversation"),
          cookie,
          credentials.csrf,
          { scope: target, input: { conversationId } },
        );
        expect(response.status).toBe(200);
        if (!response.body) throw new Error("Missing SSE body");
        const reader = response.body.getReader();
        readers.push(reader);
        const first = await withTimeout(reader.read(), 2_000);
        const data = new TextDecoder()
          .decode(first.value)
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!data) throw new Error("Missing SSE snapshot");
        expect(JSON.parse(data.slice(6))).toMatchObject({
          scope: target,
          conversationId,
          type: "snapshot",
        });
      }
      const [firstReader] = readers;
      if (!firstReader) throw new Error("Missing first project stream");
      await firstReader.cancel();
      await vi.waitFor(() =>
        expect(test.first.watch.stop).toHaveBeenCalledOnce(),
      );
      expect(test.second.watch.stop).not.toHaveBeenCalled();
      expect(test.first.calls.cancel).not.toHaveBeenCalled();
      expect(test.second.calls.cancel).not.toHaveBeenCalled();
    } finally {
      await Promise.all(readers.map((reader) => reader.cancel()));
    }
  });
});

describe("local definition transport", () => {
  async function workspace() {
    const root = await mkdtemp(join(tmpdir(), "frogie-http-definitions-"));
    definitionRoots.push(root);
    const squads = join(root, "squads");
    await mkdir(squads);
    await cp(
      fileURLToPath(
        new URL("../../../../tests/fixtures/minimal-squad", import.meta.url),
      ),
      join(squads, "minimal-squad"),
      { recursive: true },
    );
    return { squads, definitions: createDefinitionWorkspace(squads) };
  }

  it("lists, reads and saves actual MD through the authenticated workspace", async () => {
    const { squads, definitions } = await workspace();
    const { server, cookie, credentials } = await start(definitions);
    const request = (operation: string, input: unknown) =>
      post(
        server.origin,
        `/__local/definitions/${operation}`,
        cookie,
        credentials.csrf,
        input,
      );
    const listed = await request("list", {});
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      value: [{ id: "minimal-squad" }],
    });
    const loaded = await request("load", { squadId: "minimal-squad" });
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toEqual({
      value: await definitions.load("minimal-squad"),
    });
    const path = "SQUAD.md";
    const baseContent = await readFile(
      join(squads, "minimal-squad", path),
      "utf8",
    );
    const content = `${baseContent}\nHTTP edit.`;
    const saved = await request("save", {
      squadId: "minimal-squad",
      draft: { path, baseContent, content },
      requestId: "save-http",
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      value: await definitions.load("minimal-squad"),
    });
    expect(await readFile(join(squads, "minimal-squad", path), "utf8")).toBe(
      content,
    );
    const conflict = await request("save", {
      squadId: "minimal-squad",
      draft: { path, baseContent, content: `${baseContent}\nStale edit.` },
      requestId: "conflict-http",
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: "conflict" },
    });
  });

  it("requires session, exact Origin and CSRF for every definition operation", async () => {
    const { definitions } = await workspace();
    const { server, cookie, credentials } = await start(definitions);
    for (const [operation, input] of [
      ["list", {}],
      ["load", { squadId: "minimal-squad" }],
      ["save", {}],
    ] as const) {
      const path = `/__local/definitions/${operation}`;
      expect(
        (
          await post(
            server.origin,
            path,
            "other=value",
            credentials.csrf,
            input,
          )
        ).status,
      ).toBe(401);
      expect(
        (await post(server.origin, path, cookie, "wrong", input)).status,
      ).toBe(403);
      expect(
        (
          await post(
            server.origin,
            path,
            cookie,
            credentials.csrf,
            input,
            "https://foreign.example",
          )
        ).status,
      ).toBe(403);
    }
  });

  it("rejects extra fields, invalid IDs, paths, unknown operations and absent workspaces", async () => {
    const { definitions } = await workspace();
    const { server, cookie, credentials } = await start(definitions);
    for (const [operation, input] of [
      ["list", { caller: { id: "forged" } }],
      ["load", { squadId: "../escape" }],
      [
        "save",
        {
          squadId: "minimal-squad",
          draft: { path: "../escape.md", content: "x", baseContent: "" },
          requestId: "bad",
        },
      ],
      [
        "save",
        {
          squadId: "minimal-squad",
          draft: { path: "SQUAD.md", content: "x", baseContent: "" },
        },
      ],
    ] as const) {
      expect(
        (
          await post(
            server.origin,
            `/__local/definitions/${operation}`,
            cookie,
            credentials.csrf,
            input,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await post(
          server.origin,
          "/__local/definitions/unknown",
          cookie,
          credentials.csrf,
          {},
        )
      ).status,
    ).toBe(404);
    const absent = await start();
    expect(
      (
        await post(
          absent.server.origin,
          "/__local/definitions/list",
          absent.cookie,
          absent.credentials.csrf,
          {},
        )
      ).status,
    ).toBe(404);
  });

  it("maps missing files and invalid definitions to public diagnostics", async () => {
    const { definitions } = await workspace();
    const { server, cookie, credentials } = await start(definitions);
    const missing = await post(
      server.origin,
      "/__local/definitions/load",
      cookie,
      credentials.csrf,
      { squadId: "missing" },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: "not_found" },
    });
    const definition = await definitions.load("minimal-squad");
    const baseContent = definition.files.find(
      (file) => file.path === "SQUAD.md",
    )?.content;
    const invalid = await post(
      server.origin,
      "/__local/definitions/save",
      cookie,
      credentials.csrf,
      {
        squadId: "minimal-squad",
        draft: { path: "SQUAD.md", baseContent, content: "not a valid squad" },
        requestId: "invalid-definition",
      },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "invalid_definition" },
    });
  });

  it("keeps unexpected workspace failures private", async () => {
    const { definitions } = await workspace();
    vi.spyOn(definitions, "list").mockRejectedValueOnce(
      new Error("secret path and token"),
    );
    const { server, cookie, credentials } = await start(definitions);
    const response = await post(
      server.origin,
      "/__local/definitions/list",
      cookie,
      credentials.csrf,
      {},
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "runtime_unavailable",
        message: "Runtime operation failed",
        retryable: false,
      },
    });
  });
});

describe("budget transport HTTP", () => {
  it("forwards authenticated budget increments and returns the complete scoped snapshot", async () => {
    const test = await start();
    const input = {
      requestId: "extend-http",
      modelRequests: 4,
      toolEntries: 6,
      deadlineAt: 2_000_000_000_000,
    };
    const response = await post(
      test.server.origin,
      operationPath("extendBudget"),
      test.cookie,
      test.credentials.csrf,
      { scope, input },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scope, value: budget });
    expect(test.runtime.calls.extendBudget).toHaveBeenCalledWith(
      { scope, input, caller: test.credentials.caller },
      expect.anything(),
    );
  });
  it("rejects unauthenticated, cross-origin, CSRF and incomplete scope grants before mutation", async () => {
    const test = await start();
    const input = { requestId: "scope-grant", modelRequests: 1 };
    for (const [cookie, csrf, origin, status] of [
      ["", test.credentials.csrf, test.server.origin, 401],
      [test.cookie, "", test.server.origin, 403],
      [test.cookie, test.credentials.csrf, "http://untrusted.example", 403],
    ] as const) {
      const response = await post(
        test.server.origin,
        operationPath("extendBudget"),
        cookie,
        csrf,
        { scope, input },
        origin,
      );
      expect(response.status).toBe(status);
    }
    for (const field of [
      "projectId",
      "environmentId",
      "squadId",
      "harnessId",
    ] as const) {
      const response = await post(
        test.server.origin,
        operationPath("extendBudget"),
        test.cookie,
        test.credentials.csrf,
        { scope: { ...scope, [field]: "foreign" }, input },
      );
      expect(response.status).toBe(409);
      const { [field]: _missing, ...incomplete } = scope;
      const absent = await post(
        test.server.origin,
        operationPath("extendBudget"),
        test.cookie,
        test.credentials.csrf,
        { scope: incomplete, input },
      );
      expect(absent.status).toBe(400);
    }
    expect(test.runtime.calls.extendBudget).not.toHaveBeenCalled();
  });
  it("enforces UTF-8 request identity and positive safe integer changes without rejecting valid partial increments", async () => {
    const test = await start();
    const invalid: unknown[] = [
      {},
      { requestId: "no-change" },
      { requestId: "", modelRequests: 1 },
      { requestId: " \t\n", modelRequests: 1 },
      { requestId: "x".repeat(129), modelRequests: 1 },
      { requestId: "\u00e9".repeat(65), modelRequests: 1 },
      { requestId: 7, modelRequests: 1 },
      { requestId: "extra", modelRequests: 1, modelConcurrency: 2 },
    ];
    for (const field of ["modelRequests", "toolEntries", "deadlineAt"] as const)
      for (const value of [
        0,
        -1,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        "1",
        null,
        true,
      ])
        invalid.push({ requestId: "invalid-number", [field]: value });
    for (const input of invalid) {
      const response = await post(
        test.server.origin,
        operationPath("extendBudget"),
        test.cookie,
        test.credentials.csrf,
        { scope, input },
      );
      expect(response.status).toBe(400);
    }
    expect(test.runtime.calls.extendBudget).not.toHaveBeenCalled();
    const inputs = [
      { requestId: "x".repeat(128), modelRequests: Number.MAX_SAFE_INTEGER },
      { requestId: "\u00e9".repeat(64), toolEntries: 1 },
      { requestId: " a ", deadlineAt: 1 },
    ];
    for (const input of inputs) {
      const response = await post(
        test.server.origin,
        operationPath("extendBudget"),
        test.cookie,
        test.credentials.csrf,
        { scope, input },
      );
      expect(response.status).toBe(200);
      expect(test.runtime.calls.extendBudget).toHaveBeenLastCalledWith(
        { scope, input, caller: test.credentials.caller },
        expect.anything(),
      );
    }
    expect(test.runtime.calls.extendBudget).toHaveBeenCalledTimes(
      inputs.length,
    );
  });
  it("maps budget failures to safe HTTP errors without exposing runtime messages", async () => {
    const test = await start();
    for (const [code, status] of [
      ["budget_exhausted", 429],
      ["conflict", 409],
      ["capability_missing", 400],
    ] as const) {
      test.runtime.calls.extendBudget.mockRejectedValueOnce(
        Object.assign(new Error("private-token /private/provider-key.json"), {
          code,
        }),
      );
      const response = await post(
        test.server.origin,
        operationPath("extendBudget"),
        test.cookie,
        test.credentials.csrf,
        { scope, input: { requestId: `error-${code}`, toolEntries: 1 } },
      );
      expect(response.status).toBe(status);
      const text = await response.text();
      expect(text).not.toContain("private-token");
      expect(text).not.toContain("/private/");
      expect(JSON.parse(text)).toMatchObject({
        error: { code, message: expect.any(String), retryable: false },
      });
    }
  });
});

describe("execution inspection HTTP transport", () => {
  it("rejects invalid read fields and pagination bounds before querying the runtime", async () => {
    const test = await start();
    for (const [name, inputs] of [
      ["inspect", [{ extra: true }]],
      [
        "listEntries",
        [
          {},
          { conversationId: 0 },
          { conversationId: 1.5 },
          { conversationId: Number.MAX_SAFE_INTEGER + 1 },
          { conversationId, limit: 0 },
          { conversationId, limit: 101 },
          { conversationId, limit: 1.5 },
          { conversationId, cursor: "" },
          { conversationId, cursor: "x".repeat(4097) },
          { conversationId, extra: true },
        ],
      ],
      [
        "listTasks",
        [
          { conversationId: 0 },
          { limit: 0 },
          { limit: 101 },
          { cursor: "" },
          { cursor: "x".repeat(4097) },
          { extra: true },
        ],
      ],
      [
        "getTask",
        [
          {},
          { taskId: 0 },
          { taskId: 1.5 },
          { taskId: Number.MAX_SAFE_INTEGER + 1 },
          { taskId: 42, extra: true },
        ],
      ],
    ] as const) {
      for (const input of inputs) {
        const response = await post(
          test.server.origin,
          operationPath(name),
          test.cookie,
          test.credentials.csrf,
          { scope, input },
        );
        expect(response.status).toBe(400);
      }
      expect(test.runtime.calls[name]).not.toHaveBeenCalled();
    }
    for (const [name, input] of [
      ["inspect", {}],
      ["listEntries", { conversationId, limit: 100, cursor: "x".repeat(4096) }],
      ["listTasks", { conversationId, limit: 1 }],
      ["getTask", { taskId: Number.MAX_SAFE_INTEGER }],
    ] as const) {
      expect(
        (
          await post(
            test.server.origin,
            operationPath(name),
            test.cookie,
            test.credentials.csrf,
            { scope, input },
          )
        ).status,
      ).toBe(200);
      expect(test.runtime.calls[name]).toHaveBeenCalledOnce();
    }
  });

  it("requires authentication, same Origin, CSRF and a matching complete scope for each inspection read", async () => {
    const test = await start();
    for (const [name, input] of [
      ["inspect", {}],
      ["listEntries", { conversationId }],
      ["listTasks", {}],
      ["getTask", { taskId: 42 }],
    ] as const) {
      for (const [cookie, csrf, origin] of [
        ["", test.credentials.csrf, test.server.origin],
        [test.cookie, "", test.server.origin],
        [test.cookie, test.credentials.csrf, "http://untrusted.example"],
      ] as const) {
        const response = await post(
          test.server.origin,
          operationPath(name),
          cookie,
          csrf,
          { scope, input },
          origin,
        );
        expect([401, 403]).toContain(response.status);
      }
      for (const field of [
        "projectId",
        "environmentId",
        "squadId",
        "harnessId",
      ] as const) {
        expect(
          (
            await post(
              test.server.origin,
              operationPath(name),
              test.cookie,
              test.credentials.csrf,
              { scope: { ...scope, [field]: "foreign" }, input },
            )
          ).status,
        ).toBe(409);
      }
      expect(test.runtime.calls[name]).not.toHaveBeenCalled();
    }
  });

  it("routes four read operations through authenticated CSRF and complete scope envelopes", async () => {
    const test = await start();
    for (const [name, input] of [
      ["inspect", {}],
      ["listEntries", { conversationId, limit: 50 }],
      ["listTasks", { limit: 50 }],
      ["getTask", { taskId: 42 }],
    ] as const) {
      const response = await post(
        test.server.origin,
        operationPath(name),
        test.cookie,
        test.credentials.csrf,
        { scope, input },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.scope).toEqual(scope);
      expect(body).toHaveProperty("value");
      expect(test.runtime.calls[name]).toHaveBeenCalledWith(
        { scope, input, caller: test.credentials.caller },
        expect.anything(),
      );
      expect(body.value).toEqual(
        name === "inspect"
          ? {
              scope,
              scheduling: "paused",
              graph: { tasks: {} },
              usage: { models: {}, tools: {} },
            }
          : name === "getTask"
            ? null
            : { items: [], cursor: null },
      );
    }
  });
});

describe("startLocalServer", () => {
  it("reports the authoritative application version without runtime data", async () => {
    const { server } = await launch();
    const response = await fetch(`${server.origin}/api/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", version });
    expect(
      (
        await fetch(`${server.origin}/api/live`, {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
  });
  it("honors an explicit Caddy origin and resumes the cookie session", async () => {
    const publicOrigin = "https://frogie.dev.hexly.ai";
    const server = await startLocalServer({
      directory: localDirectory(instanceId, scope, runtimeService().service),
      context: BACKGROUND_CONTEXT,
      publicOrigin,
    });
    activeServers.push(server);
    expect(server.origin).toBe(publicOrigin);
    expect(server.url.startsWith(`${publicOrigin}/#token=`)).toBe(true);
  });

  it("returns session CSRF only for an authenticated browser", async () => {
    const { server, cookie, credentials } = await start();
    const endpoint = `${server.origin}/__local/auth/session`;
    expect((await fetch(endpoint)).status).toBe(401);
    const resumed = await fetch(endpoint, { headers: { Cookie: cookie } });
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toEqual(credentials);
    expect(resumed.headers.get("Cache-Control")).toBe("no-store");
    expect(
      (
        await fetch(endpoint, {
          headers: { Cookie: cookie, Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
  });

  it("rejects unsupported configured public origins", async () => {
    await expect(
      startLocalServer({
        directory: localDirectory(instanceId, scope, runtimeService().service),
        context: BACKGROUND_CONTEXT,
        publicOrigin: "https://evil.example",
      }),
    ).rejects.toThrow();
  });

  it("serves only the built public shell with exact Host checking and no source fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "frogie-public-"));
    definitionRoots.push(root);
    await mkdir(join(root, "dist/assets"), { recursive: true });
    await writeFile(
      join(root, "dist/index.html"),
      "<!doctype html><title>Frogie</title>",
    );
    await writeFile(
      join(root, "dist/assets/main.js"),
      "console.log('Frogie');",
    );
    await writeFile(join(root, "private.txt"), "secret");
    const server = await startLocalServer({
      directory: localDirectory(instanceId, scope, runtimeService().service),
      context: BACKGROUND_CONTEXT,
      publicDirectory: join(root, "dist"),
    });
    activeServers.push(server);
    const home = await fetch(server.origin);
    expect(home.status).toBe(200);
    expect(home.headers.get("Content-Type")).toContain("text/html");
    expect(await home.text()).toContain("<title>Frogie</title>");
    const asset = await fetch(`${server.origin}/assets/main.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Content-Type")).toContain("javascript");
    expect((await fetch(`${server.origin}/src/main.tsx`)).status).toBe(404);
    expect((await fetch(`${server.origin}/private.txt`)).status).toBe(404);
    expect((await fetch(`${server.origin}/__local/context`)).status).toBe(401);
    expect((await fetch(`${server.origin}/__local/unknown`)).status).toBe(404);
    const wrongHost = await new Promise<number | undefined>(
      (resolve, reject) => {
        const request = httpRequest(
          server.origin,
          { headers: { Host: "evil.example" } },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode));
          },
        );
        request.on("error", reject);
        request.end();
      },
    );
    expect(wrongHost).toBe(403);
    expect(
      (
        await fetch(server.origin, {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    const head = await fetch(server.origin, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("starts on an ephemeral loopback port and exposes only an opaque startup token in the URL fragment", async () => {
    const server = await startLocalServer({
      directory: localDirectory(instanceId, scope, runtimeService().service),
      context: BACKGROUND_CONTEXT,
      port: 0,
    });
    activeServers.push(server);
    const url = new URL(server.url);
    expect(url.origin).toBe(server.origin);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.port).not.toBe("");
    expect(url.hash).toMatch(/^#token=[^&\s]+$/);
    expect(url.search).toBe("");
    expect(await fetch(server.origin)).toBeDefined();
  });

  it("exchanges the startup token only for the exact server Origin", async () => {
    const { server } = await launch();
    const token = new URLSearchParams(new URL(server.url).hash.slice(1)).get(
      "token",
    );
    expect(token).toBeTruthy();

    const wrongOrigin = await fetch(`${server.origin}/__local/auth/exchange`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:1234",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });
    expect(wrongOrigin.status).toBe(403);
  });

  it("exchanges the token for a session cookie, CSRF token and server caller", async () => {
    const { server, credentials, cookie } = await start();
    expect(credentials).toEqual({
      csrf: expect.any(String),
      caller: { id: expect.any(String) },
    });
    expect(cookie).not.toBe("");
    expect(cookie).not.toContain("token=");
    expect(cookie).not.toContain(credentials.csrf);
    expect(credentials.caller.id).not.toBe("");
    expect(new URL(server.url).hash).toContain("token=");
  });

  it("returns authorized runtime context for the authenticated caller", async () => {
    const { server, cookie } = await start();
    const anonymous = await fetch(`${server.origin}/__local/context`, {
      headers: { Origin: server.origin },
    });
    expect(anonymous.status).toBe(401);
    const response = await fetch(`${server.origin}/__local/context`, {
      headers: { Origin: server.origin, Cookie: cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      instanceId,
      mode: "e2e",
      projects: await localDirectory(
        instanceId,
        scope,
        runtimeService().service,
      ).listProjects(),
    });
  });

  it.each([
    "describe",
    "listConversations",
    "createConversation",
    "submit",
    "getSubmission",
    "cancel",
    "compact",
  ])("forwards %s with server scope and authenticated caller", async (name) => {
    const { server, cookie, credentials, runtime } = await start();
    const input =
      name === "createConversation"
        ? { roleId: "reviewer" }
        : name === "submit"
          ? {
              conversationId: 17,
              submission: {
                type: "input",
                content: "Hello",
                requestId: "request-1",
                whenBusy: "followUp",
              },
            }
          : name === "getSubmission"
            ? { submissionId: 23 }
            : name === "cancel" || name === "compact"
              ? { conversationId: 17 }
              : {};
    const response = await post(
      server.origin,
      operationPath(name),
      cookie,
      credentials.csrf,
      { scope, input },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const expectedValue =
      await runtime.calls[name as keyof typeof runtime.calls].mock.results[0]
        ?.value;
    expect(await response.json()).toEqual({
      scope,
      value: expectedValue ?? null,
    });
    const call =
      runtime.calls[name as keyof typeof runtime.calls].mock.calls[0]?.[0];
    expect(call).toMatchObject({ scope, input, caller: credentials.caller });
  });

  it("rejects scope mismatch with 409 without calling the runtime", async () => {
    const { server, cookie, credentials, runtime } = await start();
    const response = await post(
      server.origin,
      operationPath("describe"),
      cookie,
      credentials.csrf,
      { scope: { ...scope, harnessId: "other" }, input: {} },
    );
    expect(response.status).toBe(409);
    expect(runtime.calls.describe).not.toHaveBeenCalled();
  });

  it("rejects a POST with no session cookie", async () => {
    const { server, credentials } = await start();
    const response = await fetch(
      `${server.origin}${operationPath("describe")}`,
      {
        method: "POST",
        headers: {
          Origin: server.origin,
          "Content-Type": "application/json",
          "X-Frogie-CSRF": credentials.csrf,
        },
        body: JSON.stringify({ scope, input: {} }),
      },
    );
    expect(response.status).toBe(401);
  });

  it("rejects an invalid session cookie", async () => {
    const { server, credentials } = await start();
    const response = await fetch(
      `${server.origin}${operationPath("describe")}`,
      {
        method: "POST",
        headers: {
          Origin: server.origin,
          "Content-Type": "application/json",
          Cookie: "frogie_session=invalid",
          "X-Frogie-CSRF": credentials.csrf,
        },
        body: JSON.stringify({ scope, input: {} }),
      },
    );
    expect(response.status).toBe(401);
  });

  it("rejects a valid session cookie without a CSRF token", async () => {
    const { server, cookie } = await start();
    const response = await fetch(
      `${server.origin}${operationPath("describe")}`,
      {
        method: "POST",
        headers: {
          Origin: server.origin,
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ scope, input: {} }),
      },
    );
    expect(response.status).toBe(403);
  });

  it("rejects a valid session and CSRF token from a different Origin", async () => {
    const { server, cookie, credentials } = await start();
    const response = await post(
      server.origin,
      operationPath("describe"),
      cookie,
      credentials.csrf,
      { scope, input: {} },
      "http://localhost:1234",
    );
    expect(response.status).toBe(403);
  });

  it.each([
    ["caller injection", { scope, caller: { id: "spoofed" }, input: {} }],
    ["unknown body field", { scope, input: {}, extra: true }],
    ["scope injection", { scope: { ...scope, admin: true }, input: {} }],
  ])("rejects strict schema violation: %s", async (_case, body) => {
    const { server, cookie, credentials, runtime } = await start();
    const response = await post(
      server.origin,
      operationPath("describe"),
      cookie,
      credentials.csrf,
      body,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(runtime.calls.describe).not.toHaveBeenCalled();
  });

  it.each([
    ["write submissions", { type: "write", entry: { kind: "pi.user" } }],
    [
      "unsupported busy policy",
      { type: "input", content: "hello", whenBusy: "queue" },
    ],
    [
      "unknown submission field",
      { type: "input", content: "hello", admin: true },
    ],
  ])("rejects non-MVP Pi submit shape: %s", async (_case, submission) => {
    const { server, cookie, credentials, runtime } = await start();
    const response = await post(
      server.origin,
      operationPath("submit"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId: 17, submission } },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(runtime.calls.submit).not.toHaveBeenCalled();
  });

  it("rejects JSON without an application/json content type", async () => {
    const { server, cookie, credentials, runtime } = await start();
    const response = await fetch(
      `${server.origin}${operationPath("describe")}`,
      {
        method: "POST",
        headers: {
          Origin: server.origin,
          Cookie: cookie,
          "X-Frogie-CSRF": credentials.csrf,
        },
        body: JSON.stringify({ scope, input: {} }),
      },
    );
    expect(response.status).toBe(400);
    expect(runtime.calls.describe).not.toHaveBeenCalled();
  });

  it("rejects a chunked request body over 1 MiB without calling the runtime", async () => {
    const { server, cookie, credentials, runtime } = await start();
    const port = Number(new URL(server.origin).port);
    const result = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: operationPath("describe"),
          method: "POST",
          headers: {
            Origin: server.origin,
            Cookie: cookie,
            "X-Frogie-CSRF": credentials.csrf,
            "Content-Type": "application/json",
          },
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode ?? 0));
        },
      );
      request.once("error", reject);
      request.write(`{"scope":${JSON.stringify(scope)},"input":{"padding":"`);
      request.write("x".repeat(1_100_000));
      request.end('"}}');
    });
    expect(result).toBe(400);
    expect(runtime.calls.describe).not.toHaveBeenCalled();
  });

  it("rejects malformed content type, invalid JSON and bodies over 1 MiB", async () => {
    const { server, cookie, credentials, runtime } = await start();
    const headers = {
      Origin: server.origin,
      Cookie: cookie,
      "X-Frogie-CSRF": credentials.csrf,
    };
    const contentType = await fetch(
      `${server.origin}${operationPath("describe")}`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "text/plain" },
        body: JSON.stringify({ scope, input: {} }),
      },
    );
    const malformed = await fetch(
      `${server.origin}${operationPath("describe")}`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{",
      },
    );
    const oversized = await fetch(
      `${server.origin}${operationPath("describe")}`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          input: { padding: "x".repeat(1_048_577) },
        }),
      },
    );
    expect(contentType.status).toBeGreaterThanOrEqual(400);
    expect(malformed.status).toBeGreaterThanOrEqual(400);
    expect(oversized.status).toBeGreaterThanOrEqual(400);
    expect(runtime.calls.describe).not.toHaveBeenCalled();
  });

  it("rejects unsupported operation paths and stale instance IDs", async () => {
    const { server, cookie, credentials, runtime } = await start();
    const unknownOperation = await post(
      server.origin,
      operationPath("executeShell"),
      cookie,
      credentials.csrf,
      { scope, input: {} },
    );
    const staleInstance = await post(
      server.origin,
      "/__local/instances/old-instance/operations/describe",
      cookie,
      credentials.csrf,
      { scope, input: {} },
    );
    expect(unknownOperation.status).toBe(404);
    expect(staleInstance.status).toBe(409);
    expect(runtime.calls.describe).not.toHaveBeenCalled();
  });

  it("streams observeConversation as fetchable snapshot/update SSE and stops the Pi watch on close", async () => {
    const { server, cookie, credentials, runtime, watch } = await start();
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId: 17 } },
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing event stream body");
    let text = "";
    try {
      while (!text.includes("snapshot") || !text.includes("update")) {
        const next = await withTimeout(reader.read(), 2_000);
        if (next.done) break;
        text += new TextDecoder().decode(next.value);
      }
      expect(text).toContain("snapshot");
      expect(text).toContain("update");
      expect(runtime.calls.observeConversation).toHaveBeenCalledOnce();
      await withTimeout(server.close(), 1_000);
      activeServers.splice(activeServers.indexOf(server), 1);
      expect(watch.stop).toHaveBeenCalled();
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  });

  it("rejects malformed instance encoding without affecting subsequent requests", async () => {
    const { server, cookie, credentials } = await start();
    const invalid = await post(
      server.origin,
      "/__local/instances/%zz/operations/describe",
      cookie,
      credentials.csrf,
      { scope, input: {} },
    );
    expect(invalid.status).toBe(400);
    const healthy = await post(
      server.origin,
      operationPath("describe"),
      cookie,
      credentials.csrf,
      { scope, input: {} },
    );
    expect(healthy.status).toBe(200);
  });

  it("ends the HTTP stream when the native watch closes", async () => {
    const { server, cookie, credentials, watch } = await start();
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId } },
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing stream");
    try {
      expect((await withTimeout(reader.read(), 2_000)).done).toBe(false);
      await watch.stop();
      let ended = false;
      while (!ended) ended = (await withTimeout(reader.read(), 2_000)).done;
      expect(ended).toBe(true);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  });

  it("stops a late-acquired watch after its client disconnects", async () => {
    const { server, cookie, credentials, runtime, watch } = await start();
    let resolveWatch!: (value: Watch) => void;
    let entered!: () => void;
    const entering = new Promise<void>((resolve) => {
      entered = resolve;
    });
    runtime.calls.observeConversation.mockImplementationOnce(async () => {
      entered();
      return new Promise<Watch>((resolve) => {
        resolveWatch = resolve;
      });
    });
    const controller = new AbortController();
    const response = fetch(
      `${server.origin}${operationPath("observeConversation")}`,
      {
        method: "POST",
        headers: {
          Origin: server.origin,
          Cookie: cookie,
          "X-Frogie-CSRF": credentials.csrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scope, input: { conversationId } }),
        signal: controller.signal,
      },
    );
    const outcome = response.then(
      () => "resolved",
      () => "rejected",
    );
    try {
      await withTimeout(entering, 2_000);
      controller.abort();
      expect(await outcome).toBe("rejected");
      await new Promise((resolve) => setTimeout(resolve, 25));
      resolveWatch(watch);
      await vi.waitFor(() => expect(watch.stop).toHaveBeenCalledOnce(), {
        timeout: 2_000,
      });
      expect(watch.start).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      resolveWatch?.(watch);
      await outcome;
    }
  });

  it.each([
    [
      Object.assign(new Error("credential-value"), { code: "not_found" }),
      404,
      "not_found",
    ],
    [
      Object.assign(new Error("credential-value"), { code: "EPRIVATE" }),
      500,
      "runtime_unavailable",
    ],
    [new Error("credential-value"), 500, "runtime_unavailable"],
    [null, 500, "runtime_unavailable"],
  ] as const)("sanitizes runtime errors %#", async (error, status, code) => {
    const { server, cookie, credentials, runtime } = await start();
    runtime.calls.describe.mockRejectedValueOnce(error);
    const response = await post(
      server.origin,
      operationPath("describe"),
      cookie,
      credentials.csrf,
      { scope, input: {} },
    );
    expect(response.status).toBe(status);
    const result = await response.json();
    expect(result).toMatchObject({ error: { code } });
    expect(JSON.stringify(result)).not.toContain("credential-value");
  });

  it.each([null, [], {}, { scope }, { input: {}, extra: true }])(
    "rejects malformed envelope %#",
    async (body) => {
      const { server, cookie, credentials } = await start();
      const response = await post(
        server.origin,
        operationPath("describe"),
        cookie,
        credentials.csrf,
        body,
      );
      expect(response.status).toBe(400);
    },
  );

  it("rejects a port already owned by another server without closing that server", async () => {
    const { server } = await launch();
    await expect(
      startLocalServer({
        directory: localDirectory(instanceId, scope, runtimeService().service),
        context: BACKGROUND_CONTEXT,
        port: Number(new URL(server.origin).port),
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    const response = await fetch(`${server.origin}/__local/context`);
    expect(response.status).toBe(401);
  });

  it("rejects malformed exchange requests and unsupported HTTP methods", async () => {
    const { server } = await launch();
    for (const body of [{}, { token: "unknown", injected: true }]) {
      const response = await fetch(`${server.origin}/__local/auth/exchange`, {
        method: "POST",
        headers: { Origin: server.origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    const unsupported = await fetch(`${server.origin}/__local/context`, {
      method: "PATCH",
    });
    expect(unsupported.status).toBe(405);
  });

  it("reports acquisition failures without leaving an observation open", async () => {
    const { server, cookie, credentials, runtime } = await start();
    runtime.calls.observeConversation.mockRejectedValueOnce(
      new Error("internal secret"),
    );
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId } },
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("internal secret");
  });

  it("cleans up a watch whose start fails after HTTP headers were committed", async () => {
    const { server, cookie, credentials, runtime, watch } = await start();
    vi.mocked(watch.start).mockImplementationOnce(() => {
      throw new Error("start failure");
    });
    runtime.calls.observeConversation.mockResolvedValueOnce(watch);
    await post(
      server.origin,
      operationPath("observeConversation"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId } },
    )
      .then((response) => response.text())
      .catch(() => undefined);
    await vi.waitFor(() => expect(watch.stop).toHaveBeenCalled(), {
      timeout: 2_000,
    });
  });

  it("closes within five seconds when a watch refuses to stop", async () => {
    const { server, cookie, credentials, watch } = await start();
    vi.mocked(watch.stop).mockImplementation(
      () => new Promise(() => undefined),
    );
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId } },
    );
    expect(response.status).toBe(200);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const before = Date.now();
      let completed = false;
      const closing = withTimeout(server.close(), 5_800).then(() => {
        completed = true;
      });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(watch.stop).toHaveBeenCalledOnce();
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(completed).toBe(true);
      await closing;
      expect(Date.now() - before).toBe(5_000);
      expect(Date.now() - before).toBeLessThan(5_800);
    } finally {
      vi.useRealTimers();
      await response.body?.cancel().catch(() => undefined);
    }
  });

  it("ends an observation whose native watch fails and still stops it", async () => {
    const { server, cookie, credentials, runtime, watch } = await start();
    let rejectWatch!: (reason: Error) => void;
    const closed = new Promise<Awaited<Watch["closed"]>>((_, reject) => {
      rejectWatch = reject;
    });
    vi.mocked(watch.stop).mockRejectedValue(new Error("stop failure"));
    vi.mocked(watch.start).mockImplementation(() => undefined);
    runtime.calls.observeConversation.mockResolvedValueOnce({
      ...watch,
      closed,
    });
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId } },
    );
    expect(response.status).toBe(200);
    rejectWatch(new Error("watch failure"));
    await response.text().catch(() => undefined);
    await vi.waitFor(() => expect(watch.stop).toHaveBeenCalled());
  });

  it("settles cleanup when starting and stopping an observation both fail", async () => {
    const { server, cookie, credentials, watch } = await start();
    vi.mocked(watch.start).mockImplementationOnce(() => {
      throw new Error("start failure");
    });
    vi.mocked(watch.stop).mockRejectedValue(new Error("stop failure"));
    await post(
      server.origin,
      operationPath("observeConversation"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId } },
    )
      .then((response) => response.text())
      .catch(() => undefined);
    await vi.waitFor(() => expect(watch.stop).toHaveBeenCalled());
  });

  it.each(["environmentId", "squadId"] as const)(
    "rejects a different %s",
    async (key) => {
      const { server, cookie, credentials } = await start();
      const response = await post(
        server.origin,
        operationPath("describe"),
        cookie,
        credentials.csrf,
        { scope: { ...scope, [key]: "different" }, input: {} },
      );
      expect(response.status).toBe(409);
    },
  );

  it("stops snapshots exceeding the writable buffer instead of queueing an unbounded stream", async () => {
    const { server, cookie, credentials, runtime, watch } = await start();
    runtime.calls.observeConversation.mockResolvedValueOnce({
      ...watch,
      value: {
        ...snapshot,
        docs: { large: { text: "x".repeat(2 * 1024 * 1024) } },
      },
    });
    await post(
      server.origin,
      operationPath("observeConversation"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId } },
    )
      .then((response) => response.text())
      .catch(() => undefined);
    await vi.waitFor(() => expect(watch.stop).toHaveBeenCalled());
    expect(watch.start).not.toHaveBeenCalled();
  });

  it("terminates an SSE stream when a later update exceeds the frame limit", async () => {
    const { server, cookie, credentials, runtime, watch } = await start();
    const oversized: View = {
      ...snapshot,
      docs: { large: { text: "x".repeat(1_048_576) } },
    };
    let listener: Parameters<Watch["start"]>[0] | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updateWatch: Watch = {
      ...watch,
      start: vi.fn((callback) => {
        listener = callback;
        timer = setTimeout(
          () => void callback(oversized, [], BACKGROUND_CONTEXT),
          0,
        );
      }),
      stop: vi.fn(async () => {
        if (timer !== undefined) clearTimeout(timer);
        return watch.stop();
      }),
    };
    runtime.calls.observeConversation.mockResolvedValueOnce(updateWatch);
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId } },
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing stream");
    let text = "";
    try {
      for (;;) {
        try {
          const chunk = await withTimeout(reader.read(), 2_000);
          if (chunk.done) break;
          text += new TextDecoder().decode(chunk.value);
        } catch {
          break;
        }
      }
      expect(text).toContain("event: snapshot");
      expect(text).not.toContain("event: update");
      expect(updateWatch.stop).toHaveBeenCalledOnce();
      expect(listener).toBeDefined();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      await reader.cancel().catch(() => undefined);
    }
  });

  it("does not send a late Pi watch callback after the native watch closes", async () => {
    const { server, cookie, credentials, runtime, watch } = await start();
    let listener: Parameters<Watch["start"]>[0] | undefined;
    let closeNativeWatch!: (end: Awaited<Watch["closed"]>) => void;
    const nativeClosed = new Promise<Awaited<Watch["closed"]>>((resolve) => {
      closeNativeWatch = resolve;
    });
    const controlledWatch: Watch = {
      ...watch,
      closed: nativeClosed,
      start: vi.fn((callback) => {
        listener = callback;
      }),
    };
    runtime.calls.observeConversation.mockResolvedValueOnce(controlledWatch);
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId } },
    );
    expect(response.status).toBe(200);
    closeNativeWatch({ reason: "stopped" });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing stream");
    try {
      const initial = await withTimeout(reader.read(), 2_000);
      expect(new TextDecoder().decode(initial.value)).toContain(
        "event: snapshot",
      );
      expect((await withTimeout(reader.read(), 2_000)).done).toBe(true);
      await listener?.(update, [], BACKGROUND_CONTEXT);
      expect((await withTimeout(reader.read(), 2_000)).done).toBe(true);
      expect(controlledWatch.stop).toHaveBeenCalledOnce();
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  });

  it("delivers a bounded large snapshot across normal HTTP backpressure", async () => {
    const { server, cookie, credentials, runtime, watch } = await start();
    const value: View = {
      ...snapshot,
      docs: { large: { text: "x".repeat(128 * 1024) } },
    };
    runtime.calls.observeConversation.mockResolvedValueOnce({
      ...watch,
      value,
    });
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
      cookie,
      credentials.csrf,
      { scope, input: { conversationId } },
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing stream");
    try {
      let text = "";
      while (!text.includes("\n\n")) {
        const part = await withTimeout(reader.read(), 2_000);
        if (part.done) break;
        text += new TextDecoder().decode(part.value);
      }
      const line = text.split("\n").find((entry) => entry.startsWith("data: "));
      expect(JSON.parse(line?.slice(6) ?? "null")).toMatchObject({
        type: "snapshot",
        value,
      });
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  });
});
