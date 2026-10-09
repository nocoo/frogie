import type { DefinitionBundle } from "@frogie/core/definitions";
import type { RuntimeError, RuntimeScope } from "@frogie/core/protocol";
import { describe, expect, it, vi } from "vitest";
import { createLocalDashboardApi } from "./dashboardApi.js";
import { connectLocalRuntime } from "./localClient.js";

const scope: RuntimeScope = {
  environmentId: "test",
  squadId: "zeppelin",
  harnessId: "test-harness",
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
    { csrf: "csrf", caller: { id: "local-user" } },
    {
      instanceId: "test-instance",
      scope,
      description: { protocolVersion: 1, scope },
    },
    ...values,
  ];
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(responses.shift()),
  );
  const client = await connectLocalRuntime({ origin, token: "token", fetch });
  const onError = vi.fn<(error: RuntimeError) => void>();
  return {
    fetch,
    client,
    onError,
    api: createLocalDashboardApi(client, onError),
  };
}

describe("local Dashboard adapter", () => {
  it("uses authenticated definition routes and returns the entire updated bundle", async () => {
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
      [2, "list", {}],
      [3, "load", { squadId: scope.squadId }],
      [4, "save", { squadId: scope.squadId, draft, requestId: "save-once" }],
    ] as const) {
      const call = fetch.mock.calls[index];
      expect(String(call?.[0])).toBe(
        `${origin}/__local/definitions/${operation}`,
      );
      expect(call?.[1]?.method).toBe("POST");
      expect(new Headers(call?.[1]?.headers).get("X-Frogie-CSRF")).toBe("csrf");
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
    for (const [, init] of fetch.mock.calls.slice(2))
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("caller");
    expect(JSON.parse(String(fetch.mock.calls[6]?.[1]?.body))).toEqual({
      scope,
      input: { conversationId: id, submissionId },
    });
    expect(JSON.parse(String(fetch.mock.calls[8]?.[1]?.body))).toEqual({
      scope,
      input: { conversationId: id },
    });
    client.dispose();
  });

  it.each(["environmentId", "squadId", "harnessId"] as const)(
    "rejects every scoped operation after %s changes",
    async (key) => {
      const { api, fetch, client } = await fixture();
      const other = { ...scope, [key]: "other" };
      const id = 17 as Parameters<typeof api.cancel>[1];
      const submissionId = 21 as Parameters<typeof api.getSubmission>[1];
      const operations: Array<() => unknown> = [
        () => api.loadFiles(other),
        () =>
          api.saveFile(
            other,
            { path: "SQUAD.md", content: "x", baseContent: "y" },
            "one",
          ),
        () => api.listConversations(other),
        () =>
          api.createConversation({
            scope: other,
            caller,
            input: { roleId: "command" },
          }),
        () =>
          api.submit({
            scope: other,
            caller,
            input: {
              conversationId: id,
              submission: { type: "input", content: "hello" },
            },
          }),
        () => api.getSubmission(other, submissionId),
        () => api.cancel(other, id),
        () => api.compact(other, id),
        () => api.observe(other, id, vi.fn()),
      ];
      for (const operation of operations)
        await expect(Promise.resolve().then(operation)).rejects.toMatchObject({
          code: "binding_mismatch",
        });
      expect(fetch).toHaveBeenCalledTimes(2);
      client.dispose();
    },
  );

  it("passes observation frames, release and errors through unchanged", async () => {
    const { api, client, onError } = await fixture();
    const listener = vi.fn();
    const stop = vi.fn();
    const observe = vi.spyOn(client, "observe").mockReturnValue(stop);
    const id = 17 as Parameters<typeof api.cancel>[1];
    expect(api.observe(scope, id, listener)).toBe(stop);
    expect(observe).toHaveBeenCalledWith(
      { conversationId: id },
      listener,
      onError,
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
