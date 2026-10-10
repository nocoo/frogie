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
const caller = { id: "local-user" };
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
    submit: vi.fn<RuntimeService["submit"]>(async () => 23 as SubmissionId),
    getSubmission: vi.fn<RuntimeService["getSubmission"]>(
      async () => undefined,
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

async function start(
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
  return { server, runtime, watch: runtime.watch };
}

async function post(
  origin: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = { Origin: origin },
): Promise<Response> {
  if (headers.Host !== undefined) {
    return rawRequest(
      origin,
      path,
      "POST",
      {
        "Content-Type": "application/json",
        ...headers,
      },
      JSON.stringify(body),
    );
  }
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function rawRequest(
  origin: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const request = httpRequest(
      `${origin}${path}`,
      { method, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
            }),
          ),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

function rejectedHeaders(origin: string): [Record<string, string>, number][] {
  return [
    [{}, 403],
    [{ Origin: "null" }, 403],
    [{ Origin: "https://foreign.example" }, 403],
    [{ Origin: `${origin}/` }, 403],
    [{ Origin: origin, Host: "attacker.example" }, 403],
    [{ Origin: origin, "Content-Type": "text/plain" }, 400],
    [{ Origin: origin, "Content-Type": "application/jsonp" }, 400],
  ];
}

const operationPath = (name: string) =>
  `/__local/instances/${instanceId}/operations/${name}`;

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
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

  it("refreshes project states without credentials or an available Harness", async () => {
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
    const { server } = await start(undefined, test.directory);
    for (const expectedCount of [0, 2]) {
      const response = await fetch(`${server.origin}/__local/context`);
      expect(response.status).toBe(200);
      const context = (await response.json()) as { projects: DaemonProject[] };
      expect(context).toMatchObject({ instanceId, mode: "e2e", caller });
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
    "checks boundaries and forwards credential-free project %s",
    async (operation, input) => {
      const test = await directoryFixture();
      const { server } = await start(undefined, test.directory);
      const path = `/__local/projects/${operation}`;
      for (const [headers, status] of rejectedHeaders(server.origin)) {
        expect((await post(server.origin, path, input, headers)).status).toBe(
          status,
        );
      }
      expect(test.setProjectEnabled).not.toHaveBeenCalled();
      expect(test.registerProject).not.toHaveBeenCalled();
      expect(test.bindDefinition).not.toHaveBeenCalled();
      const response = await post(server.origin, path, input);
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
    const { server } = await start(undefined, test.directory);
    for (const [operation, input, status] of [
      ["delete", { projectId: "other-project" }, 404],
      ["enabled", { projectId: "other-project", enabled: "false" }, 400],
      ["enabled", { projectId: "other-project" }, 400],
      ["register", { squadId: "../private" }, 400],
      ["register", { squadId: "other-squad", enabled: true }, 400],
      ["bind", {}, 400],
      ["bind", { projectId: "other-project", caller: { id: "owner" } }, 400],
    ] as const)
      expect(
        (await post(server.origin, `/__local/projects/${operation}`, input))
          .status,
      ).toBe(status);
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
    const { server } = await start(undefined, test.directory);
    const response = await post(server.origin, "/__local/projects/bind", {
      projectId: "other-project",
    });
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
    const { server } = await start(undefined, test.directory);
    for (const [target, runtime] of [
      [scope, test.first],
      [test.otherScope, test.second],
    ] as const) {
      const input = {
        conversationId,
        submission: { type: "input", content: target.projectId },
      };
      const response = await post(server.origin, operationPath("submit"), {
        scope: target,
        input,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ scope: target, value: 23 });
      expect(runtime.calls.submit).toHaveBeenCalledExactlyOnceWith(
        { scope: target, input, caller },
        BACKGROUND_CONTEXT,
      );
    }
    const forged = await post(server.origin, operationPath("submit"), {
      scope: { ...scope, projectId: test.otherScope.projectId },
      input: {
        conversationId,
        submission: { type: "input", content: "forged" },
      },
    });
    expect(forged.status).toBe(409);
    expect(test.first.calls.submit).toHaveBeenCalledOnce();
    expect(test.second.calls.submit).toHaveBeenCalledOnce();
  });

  it("keeps project SSE watches independent when one browser unsubscribes", async () => {
    const test = await directoryFixture();
    const { server } = await start(undefined, test.directory);
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    try {
      for (const target of [scope, test.otherScope]) {
        const response = await post(
          server.origin,
          operationPath("observeConversation"),
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

  it("lists, reads and saves actual MD through the credential-free local workspace", async () => {
    const { squads, definitions } = await workspace();
    const { server } = await start(definitions);
    const request = (operation: string, input: unknown) =>
      post(server.origin, `/__local/definitions/${operation}`, input);
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
    expect(await readFile(join(squads, "minimal-squad", path), "utf8")).toBe(
      content,
    );
  });

  it("requires exact Host, Origin and JSON for every definition POST including reads", async () => {
    const { definitions } = await workspace();
    const { server } = await start(definitions);
    const list = vi.spyOn(definitions, "list");
    const load = vi.spyOn(definitions, "load");
    const save = vi.spyOn(definitions, "save");
    for (const [operation, input] of [
      ["list", {}],
      ["load", { squadId: "minimal-squad" }],
      ["save", {}],
    ] as const) {
      for (const [headers, status] of rejectedHeaders(server.origin)) {
        expect(
          (
            await post(
              server.origin,
              `/__local/definitions/${operation}`,
              input,
              headers,
            )
          ).status,
        ).toBe(status);
      }
      const noType = await fetch(
        `${server.origin}/__local/definitions/${operation}`,
        {
          method: "POST",
          headers: { Origin: server.origin },
          body: JSON.stringify(input),
        },
      );
      expect(noType.status).toBe(400);
    }
    expect(list).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects extra fields, invalid IDs, paths, unknown operations and absent workspaces", async () => {
    const { definitions } = await workspace();
    const { server } = await start(definitions);
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
    ] as const)
      expect(
        (await post(server.origin, `/__local/definitions/${operation}`, input))
          .status,
      ).toBe(400);
    expect(
      (await post(server.origin, "/__local/definitions/unknown", {})).status,
    ).toBe(404);
    const absent = await start();
    expect(
      (await post(absent.server.origin, "/__local/definitions/list", {}))
        .status,
    ).toBe(404);
  });

  it("maps missing files and invalid definitions to public diagnostics", async () => {
    const { definitions } = await workspace();
    const { server } = await start(definitions);
    const missing = await post(server.origin, "/__local/definitions/load", {
      squadId: "missing",
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: "not_found" },
    });
    const definition = await definitions.load("minimal-squad");
    const baseContent = definition.files.find(
      (file) => file.path === "SQUAD.md",
    )?.content;
    const invalid = await post(server.origin, "/__local/definitions/save", {
      squadId: "minimal-squad",
      draft: { path: "SQUAD.md", baseContent, content: "not a valid squad" },
      requestId: "invalid-definition",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "invalid_definition" },
    });
    expect(await definitions.load("minimal-squad")).toEqual(definition);
  });

  it("keeps unexpected workspace failures private", async () => {
    const { definitions } = await workspace();
    vi.spyOn(definitions, "list").mockRejectedValueOnce(
      new Error("secret path and token"),
    );
    const { server } = await start(definitions);
    const response = await post(server.origin, "/__local/definitions/list", {});
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
  it("forwards credential-free budget increments and returns the complete scoped snapshot", async () => {
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
      { scope, input },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scope, value: budget });
    expect(test.runtime.calls.extendBudget).toHaveBeenCalledWith(
      { scope, input, caller },
      expect.anything(),
    );
  });

  it("rejects wrong Host, Origin, content type and incomplete scope grants before mutation", async () => {
    const test = await start();
    const input = { requestId: "scope-grant", modelRequests: 1 };
    for (const [headers, status] of rejectedHeaders(test.server.origin)) {
      expect(
        (
          await post(
            test.server.origin,
            operationPath("extendBudget"),
            { scope, input },
            headers,
          )
        ).status,
      ).toBe(status);
    }
    for (const field of [
      "projectId",
      "environmentId",
      "squadId",
      "harnessId",
    ] as const) {
      expect(
        (
          await post(test.server.origin, operationPath("extendBudget"), {
            scope: { ...scope, [field]: "foreign" },
            input,
          })
        ).status,
      ).toBe(409);
      const { [field]: _missing, ...incomplete } = scope;
      expect(
        (
          await post(test.server.origin, operationPath("extendBudget"), {
            scope: incomplete,
            input,
          })
        ).status,
      ).toBe(400);
    }
    expect(test.runtime.calls.extendBudget).not.toHaveBeenCalled();
  });

  it("enforces UTF-8 request identity and positive safe integers while accepting partial increments", async () => {
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
    for (const field of [
      "modelRequests",
      "toolEntries",
      "deadlineAt",
    ] as const) {
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
    }
    for (const input of invalid)
      expect(
        (
          await post(test.server.origin, operationPath("extendBudget"), {
            scope,
            input,
          })
        ).status,
      ).toBe(400);
    expect(test.runtime.calls.extendBudget).not.toHaveBeenCalled();
    const inputs = [
      { requestId: "x".repeat(128), modelRequests: Number.MAX_SAFE_INTEGER },
      { requestId: "\u00e9".repeat(64), toolEntries: 1 },
      { requestId: " a ", deadlineAt: 1 },
    ];
    for (const input of inputs) {
      expect(
        (
          await post(test.server.origin, operationPath("extendBudget"), {
            scope,
            input,
          })
        ).status,
      ).toBe(200);
      expect(test.runtime.calls.extendBudget).toHaveBeenLastCalledWith(
        { scope, input, caller },
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
  it("rejects invalid read fields and pagination bounds before runtime queries", async () => {
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
      for (const input of inputs)
        expect(
          (
            await post(test.server.origin, operationPath(name), {
              scope,
              input,
            })
          ).status,
        ).toBe(400);
      expect(test.runtime.calls[name]).not.toHaveBeenCalled();
    }
    for (const [name, input] of [
      ["inspect", {}],
      ["listEntries", { conversationId, limit: 100, cursor: "x".repeat(4096) }],
      ["listTasks", { conversationId, limit: 1 }],
      ["getTask", { taskId: Number.MAX_SAFE_INTEGER }],
    ] as const) {
      expect(
        (await post(test.server.origin, operationPath(name), { scope, input }))
          .status,
      ).toBe(200);
      expect(test.runtime.calls[name]).toHaveBeenCalledOnce();
    }
  });

  it("requires exact Host, Origin, JSON and a matching complete scope for each inspection POST", async () => {
    const test = await start();
    for (const [name, input] of [
      ["inspect", {}],
      ["listEntries", { conversationId }],
      ["listTasks", {}],
      ["getTask", { taskId: 42 }],
    ] as const) {
      for (const [headers, status] of rejectedHeaders(test.server.origin))
        expect(
          (
            await post(
              test.server.origin,
              operationPath(name),
              { scope, input },
              headers,
            )
          ).status,
        ).toBe(status);
      const noType = await fetch(
        `${test.server.origin}${operationPath(name)}`,
        {
          method: "POST",
          headers: { Origin: test.server.origin },
          body: JSON.stringify({ scope, input }),
        },
      );
      expect(noType.status).toBe(400);
      for (const field of [
        "projectId",
        "environmentId",
        "squadId",
        "harnessId",
      ] as const) {
        expect(
          (
            await post(test.server.origin, operationPath(name), {
              scope: { ...scope, [field]: "foreign" },
              input,
            })
          ).status,
        ).toBe(409);
        const { [field]: _missing, ...incomplete } = scope;
        expect(
          (
            await post(test.server.origin, operationPath(name), {
              scope: incomplete,
              input,
            })
          ).status,
        ).toBe(400);
      }
      expect(test.runtime.calls[name]).not.toHaveBeenCalled();
    }
  });

  it("routes all four read operations without credentials using complete scope envelopes", async () => {
    const test = await start();
    for (const [name, input] of [
      ["inspect", {}],
      ["listEntries", { conversationId, limit: 50 }],
      ["listTasks", { limit: 50 }],
      ["getTask", { taskId: 42 }],
    ] as const) {
      const response = await post(test.server.origin, operationPath(name), {
        scope,
        input,
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.scope).toEqual(scope);
      expect(body).toHaveProperty("value");
      expect(test.runtime.calls[name]).toHaveBeenCalledWith(
        { scope, input, caller },
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
    const { server } = await start();
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

  it("honors an explicit Caddy origin with a plain local page URL", async () => {
    const publicOrigin = "https://frogie.dev.hexly.ai";
    const server = await startLocalServer({
      directory: localDirectory(instanceId, scope, runtimeService().service),
      context: BACKGROUND_CONTEXT,
      publicOrigin,
      port: 0,
    });
    activeServers.push(server);
    expect(server.origin).toBe(publicOrigin);
    expect(server.url).toBe(`${publicOrigin}/`);
  });

  it("returns 404 for both retired auth endpoints on trusted GET and POST requests", async () => {
    const { server } = await start();
    for (const path of ["/__local/auth/session", "/__local/auth/exchange"]) {
      for (const method of ["GET", "POST"]) {
        const response = await fetch(`${server.origin}${path}`, {
          method,
          headers: {
            Origin: server.origin,
            "Content-Type": "application/json",
          },
          ...(method === "POST" ? { body: "{}" } : {}),
        });
        expect(response.status).toBe(404);
        expect(response.headers.getSetCookie()).toEqual([]);
      }
    }
  });

  it("rejects unsupported configured public origins", async () => {
    await expect(
      startLocalServer({
        directory: localDirectory(instanceId, scope, runtimeService().service),
        context: BACKGROUND_CONTEXT,
        publicOrigin: "https://evil.example",
        port: 0,
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
      port: 0,
    });
    activeServers.push(server);
    const home = await fetch(server.origin);
    expect(home.status).toBe(200);
    expect(home.headers.get("Content-Type")).toContain("text/html");
    expect(await home.text()).toContain("<title>Frogie</title>");
    const asset = await fetch(`${server.origin}/assets/main.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Content-Type")).toContain("javascript");
    for (const path of ["/src/main.tsx", "/private.txt", "/__local/unknown"])
      expect((await fetch(`${server.origin}${path}`)).status).toBe(404);
    expect((await fetch(`${server.origin}/__local/context`)).status).toBe(200);
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

  it("starts on an ephemeral loopback port with a plain URL and no credentials", async () => {
    const { server } = await start();
    const url = new URL(server.url);
    expect(url.origin).toBe(server.origin);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.port).not.toBe("");
    expect(server.url).toBe(`${server.origin}/`);
    expect(url.hash).toBe("");
    expect(url.search).toBe("");
    expect(await fetch(server.origin)).toBeDefined();
  });

  it("returns complete runtime context and the fixed caller without credentials", async () => {
    const { server } = await start();
    for (const headers of [{}, { Origin: server.origin }]) {
      const response = await fetch(`${server.origin}/__local/context`, {
        headers,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await response.json()).toEqual({
        instanceId,
        mode: "e2e",
        caller,
        projects: await localDirectory(
          instanceId,
          scope,
          runtimeService().service,
        ).listProjects(),
      });
    }
  });

  it.each([
    "describe",
    "listConversations",
    "createConversation",
    "submit",
    "getSubmission",
    "cancel",
    "compact",
  ] as const)(
    "forwards %s with server scope and fixed local caller without credentials",
    async (name) => {
      const { server, runtime } = await start();
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
      const response = await post(server.origin, operationPath(name), {
        scope,
        input,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const expectedValue = await runtime.calls[name].mock.results[0]?.value;
      expect(await response.json()).toEqual({
        scope,
        value: expectedValue ?? null,
      });
      expect(runtime.calls[name].mock.calls[0]?.[0]).toMatchObject({
        scope,
        input,
        caller,
      });
    },
  );

  it.each(["projectId", "environmentId", "squadId", "harnessId"] as const)(
    "rejects a mismatched %s with 409 without runtime calls",
    async (field) => {
      const { server, runtime } = await start();
      expect(
        (
          await post(server.origin, operationPath("describe"), {
            scope: { ...scope, [field]: "other" },
            input: {},
          })
        ).status,
      ).toBe(409);
      expect(runtime.calls.describe).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { Origin: "null" }, { Origin: "http://localhost:1234" }])(
    "rejects POST without an exact Origin %# before runtime access",
    async (headers) => {
      const { server, runtime } = await start();
      expect(
        (
          await post(
            server.origin,
            operationPath("describe"),
            { scope, input: {} },
            headers,
          )
        ).status,
      ).toBe(403);
      expect(runtime.calls.describe).not.toHaveBeenCalled();
    },
  );

  it("rejects spoofed Host on local reads and writes before directory access", async () => {
    const runtime = runtimeService();
    const directory = localDirectory(instanceId, scope, runtime.service);
    const listProjects = vi.spyOn(directory, "listProjects");
    const runtimeLookup = vi.spyOn(directory, "runtime");
    const { server } = await start(undefined, directory);
    expect(
      (
        await rawRequest(server.origin, "/__local/context", "GET", {
          Host: "attacker.example",
          Origin: server.origin,
        })
      ).status,
    ).toBe(403);
    expect(listProjects).not.toHaveBeenCalled();
    expect(
      (
        await post(
          server.origin,
          operationPath("describe"),
          { scope, input: {} },
          { Host: "attacker.example", Origin: server.origin },
        )
      ).status,
    ).toBe(403);
    expect(runtimeLookup).not.toHaveBeenCalled();
    expect(runtime.calls.describe).not.toHaveBeenCalled();
  });

  it.each(["null", "http://localhost:1234"])(
    "rejects a context read with non-exact Origin: %s",
    async (origin) => {
      const directory = localDirectory(
        instanceId,
        scope,
        runtimeService().service,
      );
      const listProjects = vi.spyOn(directory, "listProjects");
      const { server } = await start(undefined, directory);
      expect(
        (
          await fetch(`${server.origin}/__local/context`, {
            headers: { Origin: origin },
          })
        ).status,
      ).toBe(403);
      expect(listProjects).not.toHaveBeenCalled();
    },
  );

  it("keeps credential-free access available beyond startup and session expiry windows", async () => {
    const { server, runtime } = await start();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      for (const elapsed of [5 * 60 * 1000, 8 * 60 * 60 * 1000]) {
        clock.mockReturnValue(now + elapsed);
        expect((await fetch(`${server.origin}/__local/context`)).status).toBe(
          200,
        );
        expect(
          (
            await post(server.origin, operationPath("describe"), {
              scope,
              input: {},
            })
          ).status,
        ).toBe(200);
      }
      expect(runtime.calls.describe).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    ["caller injection", { scope, caller: { id: "spoofed" }, input: {} }],
    ["unknown body field", { scope, input: {}, extra: true }],
    ["scope injection", { scope: { ...scope, admin: true }, input: {} }],
  ])("rejects strict schema violation: %s", async (_case, body) => {
    const { server, runtime } = await start();
    expect(
      (await post(server.origin, operationPath("describe"), body)).status,
    ).toBe(400);
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
    const { server, runtime } = await start();
    expect(
      (
        await post(server.origin, operationPath("submit"), {
          scope,
          input: { conversationId: 17, submission },
        })
      ).status,
    ).toBe(400);
    expect(runtime.calls.submit).not.toHaveBeenCalled();
  });

  it("rejects JSON without an application/json content type", async () => {
    const { server, runtime } = await start();
    const response = await fetch(
      `${server.origin}${operationPath("describe")}`,
      {
        method: "POST",
        headers: { Origin: server.origin },
        body: Buffer.from(JSON.stringify({ scope, input: {} })),
      },
    );
    expect(response.status).toBe(400);
    expect(runtime.calls.describe).not.toHaveBeenCalled();
  });

  it("rejects a chunked body over 1 MiB without runtime calls", async () => {
    const { server, runtime } = await start();
    const result = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: Number(new URL(server.origin).port),
          path: operationPath("describe"),
          method: "POST",
          headers: {
            Origin: server.origin,
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

  it("rejects malformed content type, JSON and bodies over 1 MiB", async () => {
    const { server, runtime } = await start();
    for (const [contentType, body] of [
      ["text/plain", JSON.stringify({ scope, input: {} })],
      ["application/json", "{"],
      [
        "application/json",
        JSON.stringify({ scope, input: { padding: "x".repeat(1_048_577) } }),
      ],
    ] as const) {
      const response = await fetch(
        `${server.origin}${operationPath("describe")}`,
        {
          method: "POST",
          headers: { Origin: server.origin, "Content-Type": contentType },
          body,
        },
      );
      expect(response.status).toBe(400);
    }
    expect(runtime.calls.describe).not.toHaveBeenCalled();
  });

  it("rejects unsupported paths and stale instance IDs", async () => {
    const { server, runtime } = await start();
    expect(
      (
        await post(server.origin, operationPath("executeShell"), {
          scope,
          input: {},
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await post(
          server.origin,
          "/__local/instances/old-instance/operations/describe",
          { scope, input: {} },
        )
      ).status,
    ).toBe(409);
    expect(runtime.calls.describe).not.toHaveBeenCalled();
  });

  it("rejects malformed instance encoding without affecting later requests", async () => {
    const { server } = await start();
    expect(
      (
        await post(
          server.origin,
          "/__local/instances/%zz/operations/describe",
          { scope, input: {} },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(server.origin, operationPath("describe"), {
          scope,
          input: {},
        })
      ).status,
    ).toBe(200);
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
    const { server, runtime } = await start();
    runtime.calls.describe.mockRejectedValueOnce(error);
    const response = await post(server.origin, operationPath("describe"), {
      scope,
      input: {},
    });
    expect(response.status).toBe(status);
    const result = await response.json();
    expect(result).toMatchObject({ error: { code } });
    expect(JSON.stringify(result)).not.toContain("credential-value");
  });

  it.each([null, [], {}, { scope }, { input: {}, extra: true }])(
    "rejects malformed envelope %#",
    async (body) => {
      const { server, runtime } = await start();
      expect(
        (await post(server.origin, operationPath("describe"), body)).status,
      ).toBe(400);
      expect(runtime.calls.describe).not.toHaveBeenCalled();
    },
  );

  it("rejects an occupied port without closing its owner", async () => {
    const { server } = await start();
    await expect(
      startLocalServer({
        directory: localDirectory(instanceId, scope, runtimeService().service),
        context: BACKGROUND_CONTEXT,
        port: Number(new URL(server.origin).port),
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect((await fetch(`${server.origin}/__local/context`)).status).toBe(200);
  });

  it("rejects unsupported HTTP methods", async () => {
    const { server } = await start();
    expect(
      (
        await fetch(`${server.origin}/__local/context`, {
          method: "PATCH",
          headers: { Origin: server.origin },
        })
      ).status,
    ).toBe(405);
  });
});

describe("local observation transport", () => {
  it("streams snapshot/update SSE and stops the Pi watch on server close", async () => {
    const { server, runtime, watch } = await start();
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
      { scope, input: { conversationId } },
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

  it("ends the HTTP stream when the native watch closes", async () => {
    const { server, watch } = await start();
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
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

  it("stops a late-acquired watch after client disconnect", async () => {
    const { server, runtime, watch } = await start();
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
        headers: { Origin: server.origin, "Content-Type": "application/json" },
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

  it("reports acquisition failures without leaving observations open", async () => {
    const { server, runtime } = await start();
    runtime.calls.observeConversation.mockRejectedValueOnce(
      new Error("internal secret"),
    );
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
      { scope, input: { conversationId } },
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("internal secret");
  });

  it.each([false, true])(
    "cleans up when watch start fails after headers, including stop failure: %s",
    async (stopFails) => {
      const { server, watch } = await start();
      vi.mocked(watch.start).mockImplementationOnce(() => {
        throw new Error("start failure");
      });
      if (stopFails)
        vi.mocked(watch.stop).mockRejectedValue(new Error("stop failure"));
      await post(server.origin, operationPath("observeConversation"), {
        scope,
        input: { conversationId },
      })
        .then((response) => response.text())
        .catch(() => undefined);
      await vi.waitFor(() => expect(watch.stop).toHaveBeenCalled(), {
        timeout: 2_000,
      });
    },
  );

  it("closes within five seconds when a watch refuses to stop", async () => {
    const { server, watch } = await start();
    vi.mocked(watch.stop).mockImplementation(
      () => new Promise(() => undefined),
    );
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
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

  it("ends a failed native watch and still stops it", async () => {
    const { server, runtime, watch } = await start();
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
      { scope, input: { conversationId } },
    );
    expect(response.status).toBe(200);
    rejectWatch(new Error("watch failure"));
    await response.text().catch(() => undefined);
    await vi.waitFor(() => expect(watch.stop).toHaveBeenCalled());
  });

  it("stops oversized snapshots instead of queueing an unbounded stream", async () => {
    const { server, runtime, watch } = await start();
    runtime.calls.observeConversation.mockResolvedValueOnce({
      ...watch,
      value: {
        ...snapshot,
        docs: { large: { text: "x".repeat(2 * 1024 * 1024) } },
      },
    });
    const response = await post(
      server.origin,
      operationPath("observeConversation"),
      { scope, input: { conversationId } },
    );
    expect(response.status).toBe(413);
    await response.text();
    await vi.waitFor(() => expect(watch.stop).toHaveBeenCalled());
    expect(watch.start).not.toHaveBeenCalled();
  });

  it("terminates SSE when a later update exceeds the frame limit", async () => {
    const { server, runtime, watch } = await start();
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

  it("does not send a late Pi callback after native watch close", async () => {
    const { server, runtime, watch } = await start();
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

  it("delivers a bounded large snapshot across HTTP backpressure", async () => {
    const { server, runtime, watch } = await start();
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
