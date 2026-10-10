import type { DefinitionBundle } from "@frogie/core/definitions";
import type { RuntimeError, RuntimeScope } from "@frogie/core/protocol";
import { describe, expect, it, vi } from "vitest";
import { createLocalDashboardApi } from "./dashboardApi.js";
import { connectLocalRuntime } from "./localClient.js";

const scope: RuntimeScope = {
  projectId: "frogie",
  environmentId: "test",
  squadId: "zeppelin",
  harnessId: "test-harness",
};
const otherScope: RuntimeScope = {
  projectId: "other-project",
  environmentId: "other-environment",
  squadId: "other-squad",
  harnessId: "other-harness",
};
const origin = "http://127.0.0.1:4321";
const caller = { id: "untrusted-ignored" };
const bundle = {
  squadId: "zeppelin",
  contentHash: "current",
  files: [],
} as unknown as DefinitionBundle;

async function fixture(values: unknown[] = []) {
  const responses = [
    {
      caller: { id: "local-user" },
      instanceId: "test-instance",
      mode: "e2e",
      projects: [scope, otherScope].map((scope) => ({
        projectId: scope.projectId,
        title: scope.squadId,
        scope,
        enabled: true,
        state: "running",
        definitionHash: "current",
        rootConversationId: 17,
      })),
    },
    ...values,
  ];
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const value = responses.shift();
    return value instanceof Response ? value : Response.json(value);
  });
  const client = await connectLocalRuntime({ origin, fetch });
  const onError = vi.fn<(error: RuntimeError) => void>();
  return {
    fetch,
    client,
    onError,
    api: createLocalDashboardApi(client, onError),
  };
}

describe("local Dashboard adapter", () => {
  it("uses unauthenticated JSON definition routes and returns the entire updated bundle", async () => {
    const summaries = [
      { id: "zeppelin", projectId: "frogie", title: "Zeppelin" },
    ];
    const { api, fetch, client } = await fixture([
      { value: summaries },
      { value: bundle },
      { value: { ...bundle, contentHash: "saved" } },
    ]);
    const draft = { path: "SQUAD.md", baseContent: "old", content: "new" };
    expect(await api.listSquads()).toEqual(summaries);
    expect(await api.loadFiles(scope)).toEqual(bundle);
    expect(await api.saveFile(scope, draft, "save-once")).toEqual({
      ...bundle,
      contentHash: "saved",
    });
    for (const [index, operation, body] of [
      [1, "list", {}],
      [2, "load", { squadId: scope.squadId }],
      [3, "save", { squadId: scope.squadId, draft, requestId: "save-once" }],
    ] as const) {
      const call = fetch.mock.calls[index];
      expect(String(call?.[0])).toBe(
        `${origin}/__local/definitions/${operation}`,
      );
      expect(call?.[1]?.method).toBe("POST");
      expect(call?.[1]?.credentials).toBe("omit");
      const headers = new Headers(call?.[1]?.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.has("Cookie")).toBe(false);
      expect(headers.has("Authorization")).toBe(false);
      expect(headers.has("X-Frogie-CSRF")).toBe(false);
      expect(JSON.parse(String(call?.[1]?.body))).toEqual(body);
    }
    client.dispose();
  });

  it("maps native operations and identifiers without trusting caller-supplied identities", async () => {
    const values = [
      [{ conversation: { id: 17 }, binding: {} }],
      { conversationId: 18, binding: {} },
      21,
      { id: 21, status: "done" },
      "aborted",
      22,
      null,
    ];
    const { api, client, fetch } = await fixture(
      values.map((value) => ({ scope, value })),
    );
    const id = 17 as Parameters<typeof api.cancel>[1];
    const submissionId = 21 as Parameters<typeof api.getSubmission>[1];
    expect(await api.listConversations(scope)).toEqual([17]);
    expect(
      await api.createConversation({
        scope,
        caller,
        input: { roleId: "command" },
      }),
    ).toMatchObject({ conversationId: 18 });
    expect(
      await api.submit({
        scope,
        caller,
        input: {
          conversationId: id,
          submission: { type: "input", content: "hello", requestId: "one" },
        },
      }),
    ).toBe(21);
    expect(await api.getSubmission(scope, submissionId)).toMatchObject({
      status: "done",
    });
    expect(await api.cancel(scope, id, submissionId)).toBeUndefined();
    expect(await api.compact(scope, id)).toBeUndefined();
    expect(await api.cancel(scope, id)).toBeUndefined();
    for (const [, init] of fetch.mock.calls.slice(1))
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("caller");
    expect(JSON.parse(String(fetch.mock.calls[5]?.[1]?.body))).toEqual({
      scope,
      input: { conversationId: id, submissionId },
    });
    expect(JSON.parse(String(fetch.mock.calls[7]?.[1]?.body))).toEqual({
      scope,
      input: { conversationId: id },
    });
    client.dispose();
  });

  it("passes another registered project scope through every runtime and definition operation", async () => {
    const otherBundle = { ...bundle, squadId: otherScope.squadId };
    const { api, fetch, client } = await fixture([
      { value: otherBundle },
      { value: otherBundle },
      ...[
        [],
        { conversationId: 18, binding: {} },
        21,
        { id: 21, status: "done" },
        null,
        22,
      ].map((value) => ({ scope: otherScope, value })),
    ]);
    const id = 17 as Parameters<typeof api.cancel>[1];
    const submissionId = 21 as Parameters<typeof api.getSubmission>[1];
    const draft = { path: "SQUAD.md", content: "x", baseContent: "y" };
    expect(await api.loadFiles(otherScope)).toEqual(otherBundle);
    expect(await api.saveFile(otherScope, draft, "one")).toEqual(otherBundle);
    expect(await api.listConversations(otherScope)).toEqual([]);
    expect(
      await api.createConversation({
        scope: otherScope,
        caller,
        input: { roleId: "reviewer" },
      }),
    ).toMatchObject({ conversationId: 18 });
    expect(
      await api.submit({
        scope: otherScope,
        caller,
        input: {
          conversationId: id,
          submission: { type: "input", content: "hello" },
        },
      }),
    ).toBe(21);
    expect(await api.getSubmission(otherScope, submissionId)).toMatchObject({
      id: 21,
    });
    await api.cancel(otherScope, id);
    await api.compact(otherScope, id);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      squadId: otherScope.squadId,
    });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
      squadId: otherScope.squadId,
      draft,
      requestId: "one",
    });
    for (const [, init] of fetch.mock.calls.slice(3))
      expect(JSON.parse(String(init?.body)).scope).toEqual(otherScope);
    expect(fetch).toHaveBeenCalledTimes(9);
    client.dispose();
  });

  it.each(["projectId", "environmentId", "squadId", "harnessId"] as const)(
    "preserves the runtime rejection for a forged %s instead of rejecting another scope locally",
    async (key) => {
      const other = { ...scope, [key]: "forged" };
      const { api, fetch, client } = await fixture([
        Response.json(
          {
            error: { code: "binding_mismatch", message: "Scope is not bound" },
          },
          { status: 409 },
        ),
      ]);
      await expect(api.listConversations(other)).rejects.toMatchObject({
        code: "binding_mismatch",
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
        scope: other,
        input: {},
      });
      client.dispose();
    },
  );

  it("passes observation frames, release and errors through unchanged", async () => {
    const { api, client, onError } = await fixture();
    const listener = vi.fn();
    const stop = vi.fn();
    const observe = vi.spyOn(client, "observe").mockReturnValue(stop);
    const id = 17 as Parameters<typeof api.cancel>[1];
    expect(api.observe(otherScope, id, listener)).toBe(stop);
    expect(observe).toHaveBeenCalledWith(
      { conversationId: id },
      listener,
      onError,
      otherScope,
    );
    client.dispose();
  });

  it("rejects missing definition response envelopes", async () => {
    const { api, client } = await fixture([null, {}, { value: null }]);
    await expect(api.listSquads()).rejects.toThrow();
    await expect(api.loadFiles(scope)).rejects.toThrow();
    await expect(
      api.saveFile(
        scope,
        { path: "SQUAD.md", content: "x", baseContent: "" },
        "one",
      ),
    ).rejects.toThrow();
    client.dispose();
  });
});
