import type {
  RuntimeDescription,
  RuntimeError,
  RuntimeScope,
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
const context = { instanceId: "instance-1", scope, description };
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
    const response = responses.shift();
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

  it("submits with only the connected scope and input, and injects CSRF headers", async () => {
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

    await expect(client.submit(input)).resolves.toBe(29);
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

    await expect(client.listConversations({})).resolves.toEqual(rows);
    await expect(
      client.getSubmission({ submissionId: 29 as never }),
    ).resolves.toBeUndefined();
    await expect(
      client.getSubmission({ submissionId: 29 as never }),
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
      client.createConversation({ roleId: "reviewer" }),
    ).resolves.toEqual(created);
    await expect(
      client.cancel({ conversationId: 17 as never }),
    ).resolves.toBeUndefined();
    await expect(
      client.compact({
        conversationId: 17 as never,
        instructions: "Keep decisions",
      }),
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
      "scope mismatch",
      frame("snapshot", { scope: { ...scope, harnessId: "other" } }),
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
    client.observe({ conversationId: 17 as never }, listener, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(listener).not.toHaveBeenCalled();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      code: expect.any(String),
    });
    client.dispose();
  });

  it.each([
    ["malformed JSON data", sseResponse(["event: snapshot\\ndata: {\\n\\n"])],
    [
      "event/type mismatch",
      sseResponse([
        `event: update\\ndata: ${JSON.stringify(frame("snapshot"))}\\n\\n`,
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
      );
      await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
      client.dispose();
    },
  );

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
    const pending = client.describe({});
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
      await expect(client.describe({})).rejects.toMatchObject({ code });
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
      await expect(client.describe({})).rejects.toMatchObject({
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
            new TextEncoder().encode("event: snapshot\\ndata: {\\n\\n"),
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
    client.observe({ conversationId: 17 as ConversationId }, vi.fn(), onError);
    await vi.waitFor(() => expect(fixture.calls).toHaveLength(3));
    enqueue(new TextEncoder().encode("event: snapshot\ndata: {\n\n"));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    await withTimeout(cancelled, 1_000);
    const signal = requestInit(callAt(fixture.calls, 2)).signal;
    expect(signal?.aborted).toBe(true);
    client.dispose();
  });

  it("rejects unsupported protocol versions and mismatched context scope", async () => {
    for (const invalidContext of [
      { ...context, description: { ...description, protocolVersion: 2 } },
      { ...context, scope: { ...scope, harnessId: "other" } },
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

    await expect(client.describe({})).rejects.toThrow();
    await expect(client.listConversations({})).rejects.toThrow();
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });
});
