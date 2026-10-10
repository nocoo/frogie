import type {
  DaemonContext,
  DaemonProject,
  RuntimeBudgetSnapshot,
  RuntimeDescription,
  RuntimeEntry,
  RuntimeError,
  RuntimeInspection,
  RuntimeScope,
  RuntimeTask,
} from "@frogie/core/protocol";
import { describe, expect, it, vi } from "vitest";
import { connectLocalRuntime, type LocalRuntimeClient } from "./localClient.js";

const origin = "http://127.0.0.1:4123";
const scope: RuntimeScope = {
  projectId: "frogie",
  environmentId: "e2e",
  squadId: "zeppelin",
  harnessId: "harness-1",
};
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
  operations: ["describe", "listConversations", "submit", "getSubmission"],
};
const otherScope: RuntimeScope = {
  projectId: "other-project",
  environmentId: "other-environment",
  squadId: "other-squad",
  harnessId: "other-harness",
};
const project: DaemonProject = {
  projectId: scope.projectId,
  title: "Zeppelin",
  scope,
  enabled: true,
  state: "running",
  definitionHash: "definition-hash",
  rootConversationId: 17,
};
const otherProject: DaemonProject = {
  ...project,
  projectId: otherScope.projectId,
  title: "Other Squad",
  scope: otherScope,
};
const context: DaemonContext = {
  instanceId: "instance-1",
  mode: "e2e",
  projects: [project, otherProject],
};
type FetchCall = { input: string | URL | Request; init?: RequestInit };
type ObserveInput = Parameters<LocalRuntimeClient["observe"]>[0];
type ObservationFrame = Parameters<
  Parameters<LocalRuntimeClient["observe"]>[1]
>[0];
type ConversationId = ObserveInput["conversationId"];

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

function fetchFixture(responses: Array<unknown | Response>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    calls.push({ input, ...(init === undefined ? {} : { init }) });
    const response = await responses.shift();
    if (response instanceof Response) return response;
    return Response.json(response);
  });
  return { fetch, calls };
}

function callAt(calls: FetchCall[], index: number): FetchCall {
  const call = calls[index];
  if (!call) throw new Error(`Fetch call ${index} was not made`);
  return call;
}

function requestUrl(call: FetchCall): URL {
  return new URL(
    typeof call.input === "string" || call.input instanceof URL
      ? call.input.toString()
      : call.input.url,
  );
}

function requestInit(call: FetchCall): RequestInit {
  return call.init ?? (call.input instanceof Request ? call.input : {});
}

function headers(call: FetchCall): Headers {
  return new Headers(requestInit(call).headers);
}

function successfulFetch() {
  return fetchFixture([
    { csrf: "csrf-token", caller: { id: "local-user" } },
    context,
  ]);
}

function sseResponse(chunks: readonly string[], status = 200): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { status, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}

function frame(
  type: "snapshot" | "update",
  overrides: Partial<ObservationFrame> = {},
): ObservationFrame {
  return {
    type,
    scope,
    conversationId: 17 as ConversationId,
    value: {
      conversation: {
        id: 17 as ConversationId,
      } as ObservationFrame["value"]["conversation"],
      entries: [],
      docs: {},
    },
    ...overrides,
  };
}

const inspectionFixture: RuntimeInspection = {
  scope,
  scheduling: "paused",
  graph: { tasks: {} },
  usage: { models: {}, tools: {} },
};
const taskFixture: RuntimeTask = {
  id: 42 as never,
  conversationId: 17 as never,
  kind: "pi.tool",
  background: false,
  abortRequested: false,
  state: { status: "terminal", outcome: "completed" },
  tool: {
    callId: "call-1",
    name: "read_artifact",
    arguments: { id: "artifact" },
    argumentsSource: "requested",
    output: "Public tool output",
  },
};
const entryFixture: RuntimeEntry = {
  id: 1 as never,
  conversationId: 17 as never,
  kind: "pi.user",
  messages: [{ role: "user", content: "Public entry" }],
};
const budgetFixture: RuntimeBudgetSnapshot = {
  limits: { modelRequests: 12, toolEntries: 24, modelConcurrency: 2 },
  consumed: { modelRequests: 3, toolEntries: 5 },
};

describe("budget transport client", () => {
  it("posts a complete target scope and preserves the validated budget snapshot", async () => {
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      { scope: otherScope, value: budgetFixture },
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    try {
      const input = {
        requestId: "extend-client",
        modelRequests: 4,
        toolEntries: 6,
        deadlineAt: 2_000_000_000_000,
      };
      expect(await client.extendBudget(input, otherScope)).toEqual(
        budgetFixture,
      );
      const call = callAt(fixture.calls, 2);
      expect(requestUrl(call).pathname).toBe(
        "/__local/instances/instance-1/operations/extendBudget",
      );
      expect(JSON.parse(String(requestInit(call).body))).toEqual({
        scope: otherScope,
        input,
      });
      expect(requestInit(call).method).toBe("POST");
      expect(requestInit(call).credentials).toBe("same-origin");
      expect(headers(call).get("X-Frogie-CSRF")).toBe("csrf-token");
    } finally {
      client.dispose();
    }
  });
  it("accepts optional inspection budgets and complete zero, deadline and stopped snapshots", async () => {
    const zero = {
      limits: { modelRequests: 0, toolEntries: 0, modelConcurrency: 1 },
      consumed: { modelRequests: 0, toolEntries: 0 },
    };
    const snapshots = [
      zero,
      ...(["model_requests", "tool_entries", "deadline"] as const).map(
        (reason) => ({
          ...budgetFixture,
          limits: {
            ...budgetFixture.limits,
            deadlineAt: Number.MAX_SAFE_INTEGER,
          },
          stopped: { reason, at: 1 },
        }),
      ),
    ];
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      { scope, value: inspectionFixture },
      ...snapshots.flatMap((budget) => [
        { scope, value: { ...inspectionFixture, budget } },
        { scope, value: budget },
      ]),
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    try {
      expect(await client.inspect({}, scope)).toEqual(inspectionFixture);
      for (const budget of snapshots) {
        expect((await client.inspect({}, scope)).budget).toEqual(budget);
        expect(
          await client.extendBudget(
            { requestId: "boundary-client", toolEntries: 1 },
            scope,
          ),
        ).toEqual(budget);
      }
    } finally {
      client.dispose();
    }
  });
  it("rejects incomplete or malformed budget DTOs both in inspection and extension responses", async () => {
    const invalid: unknown[] = [
      null,
      {},
      { limits: budgetFixture.limits },
      { consumed: budgetFixture.consumed },
      { ...budgetFixture, extra: true },
      { ...budgetFixture, limits: { ...budgetFixture.limits, extra: true } },
      {
        ...budgetFixture,
        consumed: { ...budgetFixture.consumed, extra: true },
      },
    ];
    for (const field of [
      "modelRequests",
      "toolEntries",
      "modelConcurrency",
      "deadlineAt",
    ] as const) {
      for (const value of [
        -1,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        "1",
        null,
        true,
        ...(field === "modelConcurrency" || field === "deadlineAt" ? [0] : []),
      ])
        invalid.push({
          ...budgetFixture,
          limits: { ...budgetFixture.limits, [field]: value },
        });
      if (field !== "deadlineAt") {
        const { [field]: _missing, ...limits } = budgetFixture.limits;
        invalid.push({ ...budgetFixture, limits });
      }
    }
    for (const field of ["modelRequests", "toolEntries"] as const) {
      for (const value of [
        -1,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        "1",
        null,
        true,
      ])
        invalid.push({
          ...budgetFixture,
          consumed: { ...budgetFixture.consumed, [field]: value },
        });
      const { [field]: _missing, ...consumed } = budgetFixture.consumed;
      invalid.push({ ...budgetFixture, consumed });
    }
    for (const stopped of [
      {},
      { reason: "unknown", at: 1 },
      { reason: "deadline" },
      { reason: "deadline", at: 0 },
      { reason: "deadline", at: -1 },
      { reason: "deadline", at: 1.5 },
      { reason: "deadline", at: Number.MAX_SAFE_INTEGER + 1 },
      { reason: "deadline", at: "1" },
      { reason: "deadline", at: 1, secret: "private" },
      null,
    ])
      invalid.push({ ...budgetFixture, stopped });
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      ...invalid.flatMap((budget) => [
        { scope, value: { ...inspectionFixture, budget } },
        { scope, value: budget },
      ]),
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    try {
      for (const _budget of invalid) {
        await expect(client.inspect({}, scope)).rejects.toThrow();
        await expect(
          client.extendBudget(
            { requestId: "invalid-response", modelRequests: 1 },
            scope,
          ),
        ).rejects.toThrow();
      }
    } finally {
      client.dispose();
    }
  });
  it("rejects absent extension snapshots and each mismatched response scope", async () => {
    const values = [
      { scope, value: null },
      { scope },
      ...(["projectId", "environmentId", "squadId", "harnessId"] as const).map(
        (field) => ({
          scope: { ...scope, [field]: "foreign" },
          value: budgetFixture,
        }),
      ),
    ];
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      ...values,
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    try {
      for (const _value of values)
        await expect(
          client.extendBudget(
            { requestId: "scope-check", toolEntries: 1 },
            scope,
          ),
        ).rejects.toMatchObject({ code: "binding_mismatch" });
    } finally {
      client.dispose();
    }
  });
  it("preserves safe budget error codes and aborts late extension responses after disposal", async () => {
    const failures = [
      ["budget_exhausted", 429, "Runtime budget exhausted"],
      ["conflict", 409, "Request conflicts with stored state"],
      ["capability_missing", 400, "Required capability is unavailable"],
    ] as const;
    let resolve!: (response: Response) => void;
    const late = new Promise<Response>((accept) => {
      resolve = accept;
    });
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      ...failures.map(([code, status, message]) =>
        Response.json(
          { error: { code, message, retryable: false } },
          { status },
        ),
      ),
      late,
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    try {
      for (const [code, _status, message] of failures)
        await expect(
          client.extendBudget(
            { requestId: `error-${code}`, modelRequests: 1 },
            scope,
          ),
        ).rejects.toMatchObject({ code, message, retryable: false });
      const pending = client.extendBudget(
        { requestId: "late-response", toolEntries: 1 },
        scope,
      );
      const rejected = expect(pending).rejects.toMatchObject({
        code: "runtime_unavailable",
      });
      client.dispose();
      expect(requestInit(callAt(fixture.calls, 5)).signal?.aborted).toBe(true);
      resolve(Response.json({ scope, value: budgetFixture }));
      await rejected;
      await expect(
        client.extendBudget({ requestId: "disposed", toolEntries: 1 }, scope),
      ).rejects.toMatchObject({ code: "runtime_unavailable" });
      expect(fixture.calls).toHaveLength(6);
    } finally {
      client.dispose();
    }
  });
});

describe("execution inspection client", () => {
  it("rejects each outer scope mismatch and an inconsistent inspection inner scope", async () => {
    const values = [
      ...(["projectId", "environmentId", "squadId", "harnessId"] as const).map(
        (field) => ({
          scope: { ...scope, [field]: "forged" },
          value: inspectionFixture,
        }),
      ),
      { scope, value: { ...inspectionFixture, scope: otherScope } },
    ];
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      ...values,
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    for (const _value of values)
      await expect(client.inspect({}, scope)).rejects.toMatchObject({
        code: "binding_mismatch",
      });
    client.dispose();
  });

  it("rejects malformed inspection graphs, usage and identity fields without accepting partial DTOs", async () => {
    const graphTask = {
      id: 42,
      kind: "pi.tool",
      conversationId: 17,
      background: false,
      abortRequested: false,
      state: { status: "running", phase: "execute" },
      conversations: [],
    };
    const invalid = [
      null,
      {},
      { ...inspectionFixture, scheduling: "unknown" },
      {
        ...inspectionFixture,
        graph: { tasks: { 42: { ...graphTask, id: 0 } } },
      },
      {
        ...inspectionFixture,
        graph: { tasks: { 42: { ...graphTask, conversationId: 1.5 } } },
      },
      {
        ...inspectionFixture,
        graph: {
          tasks: {
            42: { ...graphTask, conversations: [Number.MAX_SAFE_INTEGER + 1] },
          },
        },
      },
      { ...inspectionFixture, usage: { models: [], tools: {} } },
      {
        ...inspectionFixture,
        usage: { models: { fixture: { totalTokens: -1 } }, tools: {} },
      },
    ];
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      ...invalid.map((value) => ({ scope, value })),
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    for (const _value of invalid)
      await expect(client.inspect({}, scope)).rejects.toThrow();
    client.dispose();
  });

  it("validates paged entry and task identity arrays and bounded cursor envelopes", async () => {
    const invalid = [
      null,
      {},
      { items: {}, cursor: null },
      { items: [], cursor: "" },
      { items: [], cursor: "x".repeat(4097) },
      { items: [], cursor: 1 },
      { items: [{ ...entryFixture, id: 0 }], cursor: null },
      {
        items: [
          { ...entryFixture, conversationId: Number.MAX_SAFE_INTEGER + 1 },
        ],
        cursor: null,
      },
      {
        items: [
          {
            ...entryFixture,
            messages: [{ role: "system", content: "Private" }],
          },
        ],
        cursor: null,
      },
      {
        items: [
          {
            ...entryFixture,
            messages: [
              {
                role: "assistant",
                content: "Body",
                toolCalls: [{ id: "call", name: "tool" }],
              },
            ],
          },
        ],
        cursor: null,
      },
    ];
    const tasks = [
      { items: [{ ...taskFixture, id: 0 }], cursor: null },
      { items: [{ ...taskFixture, owner: 1.5 }], cursor: null },
      {
        items: [{ ...taskFixture, state: { status: "waiting", on: [0] } }],
        cursor: null,
      },
      {
        items: [
          {
            ...taskFixture,
            tool: { ...taskFixture.tool, argumentsSource: "final" },
          },
        ],
        cursor: null,
      },
      { items: Array(101).fill(taskFixture), cursor: null },
    ];
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      ...[...invalid, ...tasks].map((value) => ({ scope, value })),
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    for (const _value of invalid)
      await expect(
        client.listEntries({ conversationId: 17 as never }, scope),
      ).rejects.toThrow();
    for (const _value of tasks)
      await expect(client.listTasks({}, scope)).rejects.toThrow();
    client.dispose();
  });

  it("uses authenticated definition requests without borrowing a selected runtime scope", async () => {
    const bundle = {
      squadId: "zeppelin",
      projectId: "frogie",
      files: [],
      contentHash: "definition-hash",
    };
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      { value: [project] },
      { value: bundle },
      { value: { ...bundle, contentHash: "saved-hash" } },
      null,
      { value: [] },
      { value: null },
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    expect(await client.listSquads()).toEqual([project]);
    expect(await client.loadDefinition("zeppelin")).toEqual(bundle);
    const draft = { path: "SQUAD.md", content: "New", baseContent: "Old" };
    expect(
      await client.saveDefinition("zeppelin", draft, "save-once"),
    ).toMatchObject({ contentHash: "saved-hash" });
    for (const [index, name, body] of [
      [2, "list", {}],
      [3, "load", { squadId: "zeppelin" }],
      [4, "save", { squadId: "zeppelin", draft, requestId: "save-once" }],
    ] as const) {
      const call = callAt(fixture.calls, index);
      expect(requestUrl(call).pathname).toBe(`/__local/definitions/${name}`);
      expect(JSON.parse(String(requestInit(call).body))).toEqual(body);
      expect(headers(call).get("X-Frogie-CSRF")).toBe("csrf-token");
    }
    await expect(client.listSquads()).rejects.toThrow();
    await expect(client.loadDefinition("zeppelin")).rejects.toThrow();
    await expect(
      client.saveDefinition("zeppelin", draft, "another-save"),
    ).rejects.toThrow();
    client.dispose();
  });

  it("reports unsafe observation errors and disconnected streams without fabricating inspection success", async () => {
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      Response.json({ error: { code: "forbidden" } }, { status: 403 }),
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    let resolve!: (error: RuntimeError) => void;
    const error = new Promise<RuntimeError>((accept) => {
      resolve = accept;
    });
    client.observe({ conversationId: 17 as never }, vi.fn(), resolve, scope);
    expect(await error).toMatchObject({ code: "runtime_unavailable" });
    client.dispose();
  });

  it("returns a validated task while allowing native fork entries to retain ancestor conversation identities", async () => {
    const ancestor = { ...entryFixture, conversationId: 16 as never };
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      { scope, value: taskFixture },
      { scope, value: { items: [ancestor], cursor: null } },
      { scope, value: { ...taskFixture, id: Number.MAX_SAFE_INTEGER + 1 } },
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    expect(await client.getTask({ taskId: 42 as never }, scope)).toEqual(
      taskFixture,
    );
    expect(
      await client.listEntries({ conversationId: 17 as never }, scope),
    ).toEqual({ items: [ancestor], cursor: null });
    await expect(
      client.getTask({ taskId: 42 as never }, scope),
    ).rejects.toThrow();
    client.dispose();
  });
  it("routes the four reads with the requested scope and maps absent task null to undefined", async () => {
    const inspection: RuntimeInspection = {
      scope: otherScope,
      scheduling: "paused",
      graph: { tasks: {} },
      usage: { models: {}, tools: {} },
    };
    const entry: RuntimeEntry = {
      id: 1 as never,
      conversationId: 17 as never,
      kind: "pi.user",
      messages: [{ role: "user", content: "Public history" }],
    };
    const task: RuntimeTask = {
      id: 42 as never,
      conversationId: 17 as never,
      kind: "fixture.task",
      background: false,
      abortRequested: false,
      state: { status: "terminal", outcome: "completed" },
    };
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      { scope: otherScope, value: inspection },
      {
        scope: otherScope,
        value: { items: [entry], cursor: "entries-cursor" },
      },
      { scope: otherScope, value: { items: [task], cursor: null } },
      { scope: otherScope, value: null },
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    expect(await client.inspect({}, otherScope)).toEqual(inspection);
    expect(
      await client.listEntries(
        { conversationId: 17 as never, limit: 50 },
        otherScope,
      ),
    ).toEqual({ items: [entry], cursor: "entries-cursor" });
    expect(await client.listTasks({ limit: 50 }, otherScope)).toEqual({
      items: [task],
      cursor: null,
    });
    expect(
      await client.getTask({ taskId: 42 as never }, otherScope),
    ).toBeUndefined();
    for (const [index, name, input] of [
      [2, "inspect", {}],
      [3, "listEntries", { conversationId: 17, limit: 50 }],
      [4, "listTasks", { limit: 50 }],
      [5, "getTask", { taskId: 42 }],
    ] as const) {
      const call = callAt(fixture.calls, index);
      expect(requestUrl(call).pathname).toBe(
        `/__local/instances/instance-1/operations/${name}`,
      );
      expect(JSON.parse(String(requestInit(call).body))).toEqual({
        scope: otherScope,
        input,
      });
      expect(headers(call).get("X-Frogie-CSRF")).toBe("csrf-token");
    }
    client.dispose();
  });
});

describe("connectLocalRuntime", () => {
  it("resumes the HTTPS session without reusing a startup token", async () => {
    const fixture = successfulFetch();
    const client = await connectLocalRuntime({
      origin: "https://frogie.dev.hexly.ai",
      fetch: fixture.fetch,
    });
    expect(requestUrl(callAt(fixture.calls, 0)).href).toBe(
      "https://frogie.dev.hexly.ai/__local/auth/session",
    );
    expect(requestInit(callAt(fixture.calls, 0)).method).toBe("GET");
    expect(requestInit(callAt(fixture.calls, 0)).credentials).toBe(
      "same-origin",
    );
    expect(client.context).toEqual(context);
    client.dispose();
  });

  it("exchanges a provided token on the exact HTTPS domain", async () => {
    const fixture = successfulFetch();
    const client = await connectLocalRuntime({
      origin: "https://frogie.dev.hexly.ai",
      token: "once",
      fetch: fixture.fetch,
    });
    expect(requestUrl(callAt(fixture.calls, 0)).href).toBe(
      "https://frogie.dev.hexly.ai/__local/auth/exchange",
    );
    client.dispose();
  });

  it("exchanges the fragment token, loads context and connects with same-origin credentials", async () => {
    const fixture = successfulFetch();
    const client = await connectLocalRuntime({
      origin,
      token: "startup-secret",
      fetch: fixture.fetch,
    });

    expect(client.context).toEqual(context);
    expect(client.caller).toEqual({ id: "local-user" });
    expect(fixture.calls).toHaveLength(2);
    const exchange = callAt(fixture.calls, 0);
    const loadContext = callAt(fixture.calls, 1);
    expect(requestUrl(exchange).pathname).toBe("/__local/auth/exchange");
    expect(requestUrl(exchange).search).toBe("");
    expect(requestUrl(exchange).hash).toBe("");
    expect(JSON.parse(String(requestInit(exchange).body))).toEqual({
      token: "startup-secret",
    });
    expect(requestInit(exchange).credentials).toBe("same-origin");
    expect(requestInit(exchange).redirect).toBe("error");
    expect(requestUrl(loadContext).pathname).toBe("/__local/context");
    expect(requestInit(loadContext).credentials).toBe("same-origin");
    expect(requestInit(loadContext).redirect).toBe("error");
  });

  it("submits with only the requested scope and input, and injects CSRF headers", async () => {
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      { scope, value: 29 },
    ]);
    const client = await connectLocalRuntime({
      origin,
      token: "startup-secret",
      fetch: fixture.fetch,
    });
    const input = {
      conversationId: 17 as never,
      submission: { type: "input" as const, content: "Hello", requestId: "r1" },
    };

    await expect(client.submit(input, scope)).resolves.toBe(29);
    const call = callAt(fixture.calls, 2);
    expect(requestUrl(call).pathname).toBe(
      "/__local/instances/instance-1/operations/submit",
    );
    expect(JSON.parse(String(requestInit(call).body))).toEqual({
      scope,
      input,
    });
    expect(JSON.parse(String(requestInit(call).body))).not.toHaveProperty(
      "caller",
    );
    expect(headers(call).get("X-Frogie-CSRF")).toBe("csrf-token");
    expect(requestInit(call).credentials).toBe("same-origin");
    expect(requestInit(call).redirect).toBe("error");
  });

  it("lists conversations and maps null and populated getSubmission results", async () => {
    const rows = [{ conversation: { id: 17 }, binding: { roleId: "command" } }];
    const submission = { id: 29, conversationId: 17, status: "done" };
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      { scope, value: rows },
      { scope, value: null },
      { scope, value: submission },
    ]);
    const client = await connectLocalRuntime({
      origin,
      token: "startup-secret",
      fetch: fixture.fetch,
    });

    await expect(client.listConversations({}, scope)).resolves.toEqual(rows);
    await expect(
      client.getSubmission({ submissionId: 29 as never }, scope),
    ).resolves.toBeUndefined();
    await expect(
      client.getSubmission({ submissionId: 29 as never }, scope),
    ).resolves.toEqual(submission);
    expect(
      JSON.parse(String(requestInit(callAt(fixture.calls, 2)).body)),
    ).toEqual({
      scope,
      input: {},
    });
    expect(
      JSON.parse(String(requestInit(callAt(fixture.calls, 3)).body)),
    ).toEqual({
      scope,
      input: { submissionId: 29 },
    });
    expect(
      JSON.parse(String(requestInit(callAt(fixture.calls, 4)).body)),
    ).toEqual({
      scope,
      input: { submissionId: 29 },
    });
  });

  it("refreshes project states within the same authenticated daemon session", async () => {
    const updated = { ...project, enabled: false, state: "stopped" as const };
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      { ...context, projects: [updated, otherProject] },
      { ...context, projects: [] },
    ]);
    const client = await connectLocalRuntime({
      origin,
      token: "once",
      fetch: fixture.fetch,
    });
    expect(await client.listProjects()).toEqual([updated, otherProject]);
    expect(await client.listProjects()).toEqual([]);
    for (const index of [2, 3]) {
      const call = callAt(fixture.calls, index);
      expect(requestUrl(call).pathname).toBe("/__local/context");
      expect(requestInit(call)).toMatchObject({
        method: "GET",
        credentials: "same-origin",
        redirect: "error",
      });
      expect(requestInit(call).body).toBeUndefined();
    }
    expect(
      fixture.calls.filter((call) =>
        requestUrl(call).pathname.includes("/auth/"),
      ),
    ).toHaveLength(1);
    client.dispose();
  });

  it.each([
    { ...context, instanceId: "replacement-instance" },
    { ...context, mode: "local" },
    { ...context, projects: [{ ...otherProject, projectId: "forged" }] },
    {
      ...context,
      projects: [{ ...otherProject, scope: { ...otherScope, harnessId: "" } }],
    },
    { ...context, projects: [null] },
    null,
  ])(
    "rejects a directory refresh that changes daemon identity or project ownership (%#)",
    async (response) => {
      const fixture = fetchFixture([
        { csrf: "csrf-token", caller: { id: "local-user" } },
        context,
        response,
      ]);
      const client = await connectLocalRuntime({
        origin,
        fetch: fixture.fetch,
      });
      await expect(client.listProjects()).rejects.toMatchObject({
        code: "binding_mismatch",
      });
      client.dispose();
    },
  );

  it("authenticates project management routes independently of the selected runtime", async () => {
    const stopped = {
      ...otherProject,
      enabled: false,
      state: "stopped" as const,
    };
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      { value: stopped },
      { value: otherProject },
      { value: { ...project, definitionHash: "new-hash" } },
    ]);
    const client = await connectLocalRuntime({
      origin,
      token: "startup-secret",
      fetch: fixture.fetch,
    });
    expect(await client.setProjectEnabled(otherScope.projectId, false)).toEqual(
      stopped,
    );
    expect(await client.registerProject(otherScope.squadId)).toEqual(
      otherProject,
    );
    expect(await client.bindDefinition(scope.projectId)).toMatchObject({
      definitionHash: "new-hash",
    });
    for (const [index, route, body] of [
      [2, "enabled", { projectId: otherScope.projectId, enabled: false }],
      [3, "register", { squadId: otherScope.squadId }],
      [4, "bind", { projectId: scope.projectId }],
    ] as const) {
      const call = callAt(fixture.calls, index);
      expect(requestUrl(call).pathname).toBe(`/__local/projects/${route}`);
      expect(JSON.parse(String(requestInit(call).body))).toEqual(body);
      expect(requestInit(call)).toMatchObject({
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
      });
      expect(headers(call).get("X-Frogie-CSRF")).toBe("csrf-token");
      expect(headers(call).get("Content-Type")).toBe("application/json");
      expect(String(requestInit(call).body)).not.toContain("startup-secret");
    }
    client.dispose();
  });

  it.each([
    null,
    {},
    { value: null },
    { value: [] },
    { value: { ...project, projectId: "forged" } },
    { value: { ...project, scope: { ...scope, squadId: "" } } },
    { value: { ...project, state: "unknown" } },
  ])(
    "rejects malformed project management response envelopes (%#)",
    async (result) => {
      const fixture = fetchFixture([
        { csrf: "csrf-token", caller: { id: "local-user" } },
        context,
        result,
        result,
        result,
      ]);
      const client = await connectLocalRuntime({
        origin,
        fetch: fixture.fetch,
      });
      await expect(
        client.setProjectEnabled(scope.projectId, false),
      ).rejects.toMatchObject({ code: "runtime_unavailable" });
      await expect(client.registerProject(scope.squadId)).rejects.toMatchObject(
        { code: "runtime_unavailable" },
      );
      await expect(
        client.bindDefinition(scope.projectId),
      ).rejects.toMatchObject({ code: "runtime_unavailable" });
      client.dispose();
    },
  );

  it("accepts empty directories and stopped or failed projects without a runtime description", async () => {
    for (const projects of [
      [],
      [
        {
          ...project,
          enabled: false,
          state: "stopped",
          rootConversationId: undefined,
        },
        {
          ...otherProject,
          state: "error",
          rootConversationId: undefined,
          error: {
            code: "invalid_definition",
            message: "Missing role",
            retryable: false,
          },
        },
      ],
    ]) {
      const loaded = { ...context, projects };
      const fixture = fetchFixture([
        { csrf: "csrf-token", caller: { id: "local-user" } },
        loaded,
      ]);
      const client = await connectLocalRuntime({
        origin,
        fetch: fixture.fetch,
      });
      expect(client.context).toEqual(JSON.parse(JSON.stringify(loaded)));
      client.dispose();
    }
  });

  it("routes consecutive operations to distinct projects using each complete scope", async () => {
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      { scope: otherScope, value: { ...description, scope: otherScope } },
      { scope, value: description },
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    expect(await client.describe({}, otherScope)).toMatchObject({
      scope: otherScope,
    });
    expect(await client.describe({}, scope)).toEqual(description);
    for (const [index, expected] of [
      [2, otherScope],
      [3, scope],
    ] as const) {
      const call = callAt(fixture.calls, index);
      expect(requestUrl(call).pathname).toBe(
        "/__local/instances/instance-1/operations/describe",
      );
      expect(JSON.parse(String(requestInit(call).body))).toEqual({
        scope: expected,
        input: {},
      });
    }
    client.dispose();
  });

  it.each(["projectId", "environmentId", "squadId", "harnessId"] as const)(
    "rejects an operation response whose %s differs from the requested project",
    async (field) => {
      const fixture = fetchFixture([
        { csrf: "csrf-token", caller: { id: "local-user" } },
        context,
        { scope: { ...otherScope, [field]: "forged" }, value: description },
      ]);
      const client = await connectLocalRuntime({
        origin,
        fetch: fixture.fetch,
      });
      await expect(client.describe({}, otherScope)).rejects.toMatchObject({
        code: "binding_mismatch",
      });
      client.dispose();
    },
  );

  it("uses the global fetch implementation when no fetch adapter is supplied", async () => {
    const fixture = successfulFetch();
    vi.stubGlobal("fetch", fixture.fetch);
    try {
      const client = await connectLocalRuntime({ origin, token: "secret" });
      expect(client.context).toEqual(context);
      expect(fixture.fetch).toHaveBeenCalledTimes(2);
      client.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("encodes a daemon instance ID in runtime operation URLs", async () => {
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      { ...context, instanceId: "daemon/name ?#" },
      { scope, value: description },
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    await client.describe({}, scope);
    expect(requestUrl(callAt(fixture.calls, 2)).pathname).toBe(
      "/__local/instances/daemon%2Fname%20%3F%23/operations/describe",
    );
    expect(requestUrl(callAt(fixture.calls, 2)).search).toBe("");
    expect(requestUrl(callAt(fixture.calls, 2)).hash).toBe("");
    client.dispose();
  });

  it("keeps observations with identical conversation IDs isolated by their complete project scopes", async () => {
    const streams = [scope, otherScope].map((scope) => {
      let enqueue!: (value: ObservationFrame) => void;
      const cancel = vi.fn();
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            enqueue = (value) =>
              controller.enqueue(
                new TextEncoder().encode(
                  `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`,
                ),
              );
          },
          cancel,
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
      return {
        scope,
        response,
        enqueue,
        cancel,
        listener: vi.fn(),
        onError: vi.fn(),
      };
    });
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      ...streams.map((stream) => stream.response),
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    const stops = streams.map((stream) =>
      client.observe(
        { conversationId: 17 as ConversationId },
        stream.listener,
        stream.onError,
        stream.scope,
      ),
    );
    try {
      for (const stream of streams)
        stream.enqueue(frame("snapshot", { scope: stream.scope }));
      await vi.waitFor(() => {
        for (const stream of streams)
          expect(stream.listener).toHaveBeenCalledOnce();
      });
      for (const [index, stream] of streams.entries()) {
        expect(stream.listener.mock.calls[0]?.[0]).toMatchObject({
          scope: stream.scope,
          conversationId: 17,
        });
        const call = callAt(fixture.calls, index + 2);
        expect(JSON.parse(String(requestInit(call).body))).toEqual({
          scope: stream.scope,
          input: { conversationId: 17 },
        });
        expect(headers(call).get("X-Frogie-CSRF")).toBe("csrf-token");
        expect(requestInit(call)).toMatchObject({
          credentials: "same-origin",
          redirect: "error",
          method: "POST",
        });
      }
      stops[0]?.();
      stops[0]?.();
      await vi.waitFor(() => expect(streams[0]?.cancel).toHaveBeenCalledOnce());
      streams[1]?.enqueue(
        frame("update", {
          scope: otherScope,
          value: {
            ...frame("snapshot").value,
            docs: { marker: { project: "other" } },
          },
        }),
      );
      await vi.waitFor(() =>
        expect(streams[1]?.listener).toHaveBeenCalledTimes(2),
      );
      expect(streams[0]?.listener).toHaveBeenCalledOnce();
      expect(requestInit(callAt(fixture.calls, 3)).signal?.aborted).toBe(false);
      for (const stream of streams)
        expect(stream.onError).not.toHaveBeenCalled();
    } finally {
      for (const stop of stops) stop();
      client.dispose();
    }
  });

  it.each([
    [
      Response.json(
        { error: { code: "forbidden", message: "Not authorized" } },
        { status: 403 },
      ),
      "forbidden",
    ],
    [
      Response.json({ error: { code: "forbidden" } }, { status: 403 }),
      "runtime_unavailable",
    ],
  ] as const)(
    "preserves project management HTTP errors without accepting malformed error details (%#)",
    async (response, code) => {
      const fixture = fetchFixture([
        { csrf: "csrf-token", caller: { id: "local-user" } },
        context,
        response,
      ]);
      const client = await connectLocalRuntime({
        origin,
        fetch: fixture.fetch,
      });
      await expect(
        client.bindDefinition(otherScope.projectId),
      ).rejects.toMatchObject({ code });
      client.dispose();
    },
  );

  it("rejects late project directory results after the daemon client is disposed", async () => {
    let resolve!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((accept) => {
      resolve = accept;
    });
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      pendingResponse,
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    const pending = client.listProjects();
    client.dispose();
    expect(requestInit(callAt(fixture.calls, 2)).signal?.aborted).toBe(true);
    resolve(Response.json(context));
    await expect(pending).rejects.toMatchObject({
      code: "runtime_unavailable",
    });
  });

  it("routes createConversation, cancel and compact with their input and null mapping", async () => {
    const created = {
      conversationId: 18,
      binding: {
        conversationId: 18,
        roleId: "reviewer",
        definitionHash: "definition-hash",
        configHash: "config-hash",
        title: "Reviewer",
      },
    };
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      { scope, value: created },
      { scope, value: null },
      { scope, value: 43 },
    ]);
    const client = await connectLocalRuntime({
      origin,
      token: "secret",
      fetch: fixture.fetch,
    });
    await expect(
      client.createConversation({ roleId: "reviewer" }, scope),
    ).resolves.toEqual(created);
    await expect(
      client.cancel({ conversationId: 17 as never }, scope),
    ).resolves.toBeUndefined();
    await expect(
      client.compact(
        {
          conversationId: 17 as never,
          instructions: "Keep decisions",
        },
        scope,
      ),
    ).resolves.toBe(43);

    expect(requestUrl(callAt(fixture.calls, 2)).pathname).toContain(
      "/createConversation",
    );
    expect(
      JSON.parse(String(requestInit(callAt(fixture.calls, 2)).body)),
    ).toEqual({ scope, input: { roleId: "reviewer" } });
    expect(requestUrl(callAt(fixture.calls, 3)).pathname).toContain("/cancel");
    expect(
      JSON.parse(String(requestInit(callAt(fixture.calls, 3)).body)),
    ).toEqual({ scope, input: { conversationId: 17 } });
    expect(requestUrl(callAt(fixture.calls, 4)).pathname).toContain("/compact");
    expect(
      JSON.parse(String(requestInit(callAt(fixture.calls, 4)).body)),
    ).toEqual({
      scope,
      input: { conversationId: 17, instructions: "Keep decisions" },
    });
    client.dispose();
  });

  it("parses snapshot and update frames split across CRLF, UTF-8 and JSON chunks", async () => {
    const snapshot = frame("snapshot");
    const update = frame("update", {
      value: {
        ...snapshot.value,
        entries: [
          { id: 1 as never, conversationId: 17 as never, kind: "pi.user" },
        ],
        docs: { metadata: { marker: "😀" } },
      },
    });
    const serialized = `event: snapshot\r\ndata: ${JSON.stringify(snapshot)}\r\n\r\nevent: update\r\ndata: ${JSON.stringify(update)}\r\n\r\n`;
    const bytes = new TextEncoder().encode(serialized);
    const emojiBytes = new TextEncoder().encode("😀");
    const emojiStart = bytes.findIndex(
      (byte, index) =>
        byte === emojiBytes[0] &&
        emojiBytes.every((part, offset) => bytes[index + offset] === part),
    );
    const firstCrLf = bytes.indexOf(13);
    const dataStart = serialized.indexOf("data: {");
    const jsonStart = bytes.indexOf(123, dataStart);
    const crLfAfterEmoji = bytes.indexOf(13, emojiStart + emojiBytes.length);
    expect(firstCrLf).toBeGreaterThanOrEqual(0);
    expect(bytes[firstCrLf + 1]).toBe(10);
    expect(emojiStart).toBeGreaterThanOrEqual(0);
    const chunks = [
      bytes.slice(0, firstCrLf + 1),
      bytes.slice(firstCrLf + 1, jsonStart + 5),
      bytes.slice(jsonStart + 5, emojiStart + 2),
      bytes.slice(emojiStart + 2, crLfAfterEmoji + 1),
      bytes.slice(crLfAfterEmoji + 1),
    ];
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    ]);
    const client = await connectLocalRuntime({
      origin,
      token: "secret",
      fetch: fixture.fetch,
    });
    const frames: ObservationFrame[] = [];
    const errors: RuntimeError[] = [];
    const unsubscribe = client.observe(
      { conversationId: 17 as never },
      (value) => frames.push(value),
      (error) => errors.push(error),
      scope,
    );
    await vi.waitFor(() => expect(frames).toHaveLength(2));
    expect(frames[0]).toEqual(snapshot);
    expect(frames[1]).toEqual(update);
    expect(errors).toEqual([]);
    const observeSignal = requestInit(callAt(fixture.calls, 2)).signal;
    unsubscribe();
    expect(observeSignal?.aborted).toBe(true);
    client.dispose();
  });

  it.each([
    [
      "harness mismatch",
      frame("snapshot", { scope: { ...scope, harnessId: "other" } }),
    ],
    [
      "project mismatch",
      frame("snapshot", { scope: { ...scope, projectId: "other" } }),
    ],
    [
      "environment mismatch",
      frame("snapshot", { scope: { ...scope, environmentId: "other" } }),
    ],
    [
      "squad mismatch",
      frame("snapshot", { scope: { ...scope, squadId: "other" } }),
    ],
    [
      "nested conversation mismatch",
      frame("snapshot", {
        value: {
          ...frame("snapshot").value,
          conversation: {
            id: 18 as ConversationId,
          } as ObservationFrame["value"]["conversation"],
        },
      }),
    ],
    [
      "conversation mismatch",
      frame("snapshot", { conversationId: 18 as ConversationId }),
    ],
  ])("reports a %s frame without delivering it", async (_case, badFrame) => {
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      sseResponse([`event: snapshot\ndata: ${JSON.stringify(badFrame)}\n\n`]),
    ]);
    const client = await connectLocalRuntime({
      origin,
      token: "secret",
      fetch: fixture.fetch,
    });
    const listener = vi.fn();
    const onError = vi.fn();
    client.observe({ conversationId: 17 as never }, listener, onError, scope);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(listener).not.toHaveBeenCalled();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      code: "binding_mismatch",
    });
    client.dispose();
  });

  it.each([
    ["malformed JSON data", sseResponse(["event: snapshot\ndata: {\n\n"])],
    [
      "event/type mismatch",
      sseResponse([
        `event: update\ndata: ${JSON.stringify(frame("snapshot"))}\n\n`,
      ]),
    ],
    [
      "an empty stream",
      new Response(null, { headers: { "Content-Type": "text/event-stream" } }),
    ],
  ])(
    "reports %s through onError without delivering a frame",
    async (_case, response) => {
      const fixture = fetchFixture([
        { csrf: "csrf-token", caller: { id: "local-user" } },
        context,
        response,
      ]);
      const client = await connectLocalRuntime({
        origin,
        token: "secret",
        fetch: fixture.fetch,
      });
      const listener = vi.fn();
      const onError = vi.fn();
      const unsubscribe = client.observe(
        { conversationId: 17 as ConversationId },
        listener,
        onError,
        scope,
      );
      await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
      client.dispose();
    },
  );

  it("rejects a successful observation response with the wrong content type and cancels its body", async () => {
    const cancel = vi.fn();
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      new Response(new ReadableStream<Uint8Array>({ cancel }), {
        headers: { "Content-Type": "application/json" },
      }),
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    const listener = vi.fn();
    const onError = vi.fn();
    const stop = client.observe(
      { conversationId: 17 as ConversationId },
      listener,
      onError,
      scope,
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(cancel).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      code: "runtime_unavailable",
    });
    stop();
    client.dispose();
  });

  it("contains a frame listener exception and aborts that observation", async () => {
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      sseResponse([
        `event: snapshot\ndata: ${JSON.stringify(frame("snapshot"))}\n\n`,
      ]),
    ]);
    const client = await connectLocalRuntime({ origin, fetch: fixture.fetch });
    const listener = vi.fn(() => {
      throw new Error("Consumer frame failure");
    });
    const onError = vi.fn();
    client.observe(
      { conversationId: 17 as ConversationId },
      listener,
      onError,
      scope,
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(listener).toHaveBeenCalledOnce();
    expect(requestInit(callAt(fixture.calls, 2)).signal?.aborted).toBe(true);
    client.dispose();
  });

  it("keeps a successful observe stream open until unsubscribe, then cancels its reader", async () => {
    let enqueue!: (chunk: Uint8Array) => void;
    let cancelStream!: () => void;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          enqueue = (chunk) => controller.enqueue(chunk);
        },
        cancel() {
          cancelStream();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      response,
    ]);
    const client = await connectLocalRuntime({
      origin,
      token: "secret",
      fetch: fixture.fetch,
    });
    const cancelled = new Promise<void>((resolve) => {
      cancelStream = resolve;
    });
    const onError = vi.fn();
    const listener = vi.fn();
    const unsubscribe = client.observe(
      { conversationId: 17 as ConversationId },
      listener,
      onError,
      scope,
    );
    const snapshotData = new TextEncoder().encode(
      `event: snapshot\ndata: ${JSON.stringify(frame("snapshot"))}\n\n`,
    );
    await vi.waitFor(() => expect(fixture.calls).toHaveLength(3));
    enqueue(snapshotData);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    unsubscribe();
    await withTimeout(cancelled, 1_000);
    expect(onError).not.toHaveBeenCalled();
    client.dispose();
  });

  it("reports a non-successful observe response through onError once", async () => {
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      Response.json(
        { error: { code: "forbidden", message: "Forbidden" } },
        { status: 403 },
      ),
    ]);
    const client = await connectLocalRuntime({
      origin,
      token: "secret",
      fetch: fixture.fetch,
    });
    const onError = vi.fn();
    const unsubscribe = client.observe(
      { conversationId: 17 as never },
      vi.fn(),
      onError,
      scope,
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: "forbidden" });
    unsubscribe();
    client.dispose();
  });

  it.each(["unsubscribe", "dispose"] as const)(
    "aborts observation on %s and suppresses late callbacks",
    async (stopKind) => {
      let resolveStream!: (response: Response) => void;
      const streamResponse = new Promise<Response>((resolve) => {
        resolveStream = resolve;
      });
      const fixture = fetchFixture([
        { csrf: "csrf-token", caller: { id: "local-user" } },
        context,
        streamResponse,
      ]);
      const client = await connectLocalRuntime({
        origin,
        token: "secret",
        fetch: fixture.fetch,
      });
      const listener = vi.fn();
      const onError = vi.fn();
      const unsubscribe = client.observe(
        { conversationId: 17 as never },
        listener,
        onError,
        scope,
      );
      await vi.waitFor(() => expect(fixture.calls).toHaveLength(3));
      const signal = requestInit(callAt(fixture.calls, 2)).signal;
      if (stopKind === "unsubscribe") unsubscribe();
      else client.dispose();
      expect(signal?.aborted).toBe(true);
      resolveStream(
        sseResponse([
          `event: snapshot\ndata: ${JSON.stringify(frame("snapshot"))}\n\n`,
        ]),
      );
      await Promise.resolve();
      expect(listener).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      client.dispose();
    },
  );

  it("aborts a pending ordinary request when disposed", async () => {
    const calls: FetchCall[] = [];
    let abortRequest!: () => void;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      calls.push({ input, ...(init === undefined ? {} : { init }) });
      if (calls.length === 1)
        return Response.json({
          csrf: "csrf-token",
          caller: { id: "local-user" },
        });
      if (calls.length === 2) return Response.json(context);
      return new Promise<Response>((_resolve, reject) => {
        abortRequest = () => reject(new Error("aborted"));
        init?.signal?.addEventListener("abort", abortRequest, { once: true });
      });
    });

    const client = await connectLocalRuntime({
      origin,
      token: "secret",
      fetch,
    });
    const pending = client.describe({}, scope);
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    const operationInit = calls[2]?.init;
    const requestSignal = operationInit?.signal;
    client.dispose();
    expect(requestSignal?.aborted).toBe(true);
    await expect(pending).rejects.toThrow();
  });

  it.each([
    "not a URL",
    "https://127.0.0.1:4123",
    "http://localhost:4123",
    "http://127.0.0.1:4123/path",
  ])("rejects a non-loopback or malformed origin: %s", async (badOrigin) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      connectLocalRuntime({ origin: badOrigin, token: "secret", fetch }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid auth bootstrap response", async () => {
    for (const response of [undefined, {}, { csrf: "csrf-token" }]) {
      const fixture = fetchFixture([response, context]);
      await expect(
        connectLocalRuntime({ origin, token: "secret", fetch: fixture.fetch }),
      ).rejects.toThrow();
    }
  });

  it.each([
    [
      Response.json(
        { error: { code: "forbidden", message: "Forbidden" } },
        { status: 403 },
      ),
      "forbidden",
    ],
    [
      Response.json({ error: { code: "forbidden" } }, { status: 403 }),
      "runtime_unavailable",
    ],
    [new Response("not-json", { status: 500 }), "runtime_unavailable"],
  ])(
    "maps operation HTTP failures to safe runtime errors",
    async (response, code) => {
      const fixture = fetchFixture([
        { csrf: "csrf-token", caller: { id: "local-user" } },
        context,
        response,
      ]);
      const client = await connectLocalRuntime({
        origin,
        token: "secret",
        fetch: fixture.fetch,
      });
      await expect(client.describe({}, scope)).rejects.toMatchObject({ code });
      client.dispose();
    },
  );

  it("rejects an operation response whose scope or value envelope is malformed", async () => {
    for (const result of [
      { scope: { ...scope, squadId: "other" }, value: description },
      { scope, other: description },
      null,
    ]) {
      const fixture = fetchFixture([
        { csrf: "csrf-token", caller: { id: "local-user" } },
        context,
        result,
      ]);
      const client = await connectLocalRuntime({
        origin,
        token: "secret",
        fetch: fixture.fetch,
      });
      await expect(client.describe({}, scope)).rejects.toMatchObject({
        code: "binding_mismatch",
      });
      client.dispose();
    }
  });

  it("reports malformed UTF-8 and incomplete SSE frames through onError", async () => {
    const invalidUtf8 = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0xff, 0xfe]));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    const incomplete = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode("event: snapshot\ndata: {\n"),
          );
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    for (const response of [invalidUtf8, incomplete]) {
      const fixture = fetchFixture([
        { csrf: "csrf-token", caller: { id: "local-user" } },
        context,
        response,
      ]);
      const client = await connectLocalRuntime({
        origin,
        token: "secret",
        fetch: fixture.fetch,
      });
      const onError = vi.fn();
      client.observe(
        { conversationId: 17 as ConversationId },
        vi.fn(),
        onError,
        scope,
      );
      await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
      client.dispose();
    }
  });

  it("rejects observe after dispose without making a request", async () => {
    const fixture = successfulFetch();
    const client = await connectLocalRuntime({
      origin,
      token: "secret",
      fetch: fixture.fetch,
    });
    client.dispose();
    expect(() =>
      client.observe(
        { conversationId: 17 as ConversationId },
        vi.fn(),
        vi.fn(),
        scope,
      ),
    ).toThrow();
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });

  it("contains an onError callback exception and still aborts and releases the stream", async () => {
    let enqueue!: (chunk: Uint8Array) => void;
    let cancelStream!: () => void;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          enqueue = (chunk) => controller.enqueue(chunk);
        },
        cancel() {
          cancelStream();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    const fixture = fetchFixture([
      { csrf: "csrf-token", caller: { id: "local-user" } },
      context,
      response,
    ]);
    const client = await connectLocalRuntime({
      origin,
      token: "secret",
      fetch: fixture.fetch,
    });
    const cancelled = new Promise<void>((resolve) => {
      cancelStream = resolve;
    });
    const onError = vi.fn(() => {
      throw new Error("consumer callback failure");
    });
    client.observe(
      { conversationId: 17 as ConversationId },
      vi.fn(),
      onError,
      scope,
    );
    await vi.waitFor(() => expect(fixture.calls).toHaveLength(3));
    enqueue(new TextEncoder().encode("event: snapshot\ndata: {\n\n"));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    await withTimeout(cancelled, 1_000);
    const signal = requestInit(callAt(fixture.calls, 2)).signal;
    expect(signal?.aborted).toBe(true);
    client.dispose();
  });

  it("rejects malformed daemon contexts and mismatched project identities", async () => {
    for (const invalidContext of [
      null,
      {},
      { ...context, instanceId: "" },
      { ...context, mode: "unknown" },
      { ...context, projects: {} },
      {
        ...context,
        projects: [{ ...project, scope: { ...scope, projectId: "other" } }],
      },
      {
        ...context,
        projects: [{ ...project, scope: { ...scope, harnessId: "" } }],
      },
      { ...context, projects: [{ ...project, state: "unknown" }] },
    ]) {
      const fixture = fetchFixture([
        { csrf: "csrf-token", caller: { id: "local-user" } },
        invalidContext,
      ]);
      await expect(
        connectLocalRuntime({ origin, token: "secret", fetch: fixture.fetch }),
      ).rejects.toThrow();
    }
  });

  it("rejects operations after dispose without making another request", async () => {
    const fixture = successfulFetch();
    const client = await connectLocalRuntime({
      origin,
      token: "startup-secret",
      fetch: fixture.fetch,
    });
    client.dispose();
    client.dispose();

    await expect(client.describe({}, scope)).rejects.toThrow();
    await expect(client.listConversations({}, scope)).rejects.toThrow();
    await expect(client.listProjects()).rejects.toThrow();
    await expect(
      client.setProjectEnabled(scope.projectId, false),
    ).rejects.toThrow();
    await expect(client.registerProject(scope.squadId)).rejects.toThrow();
    await expect(client.bindDefinition(scope.projectId)).rejects.toThrow();
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });
});
