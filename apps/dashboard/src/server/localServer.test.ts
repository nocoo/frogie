import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type {
  RuntimeDescription,
  RuntimeScope,
  RuntimeService,
} from "@frogie/core/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefinitionWorkspace } from "./definitions.js";
import { type LocalServer, startLocalServer } from "./localServer.js";

const scope: RuntimeScope = {
  environmentId: "test-env",
  squadId: "zeppelin",
  harnessId: "harness-1",
};
const instanceId = "instance-1";
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
  };
  const service: RuntimeService = calls;
  return { service, calls, watch };
}

const activeServers: LocalServer[] = [];
const definitionRoots: string[] = [];

async function launch(
  definitions?: ReturnType<typeof createDefinitionWorkspace>,
) {
  const runtime = runtimeService();
  const server = await startLocalServer({
    instanceId,
    scope,
    service: runtime.service,
    context: BACKGROUND_CONTEXT,
    port: 0,
    ...(definitions === undefined ? {} : { definitions }),
  });
  activeServers.push(server);
  return { server, runtime };
}

async function start(
  definitions?: ReturnType<typeof createDefinitionWorkspace>,
) {
  const { server, runtime } = await launch(definitions);
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
      Cookie: cookie,
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

describe("startLocalServer", () => {
  it("starts on an ephemeral loopback port and exposes only an opaque startup token in the URL fragment", async () => {
    const server = await startLocalServer({
      instanceId,
      scope,
      service: runtimeService().service,
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
      scope,
      description,
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
      await server.close();
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
        instanceId,
        scope,
        service: runtimeService().service,
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
    const before = performance.now();
    await withTimeout(server.close(), 5_800);
    expect(performance.now() - before).toBeLessThan(5_800);
    await response.body?.cancel();
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
