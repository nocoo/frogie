import type { DefinitionBundle } from "@frogie/core/definitions";
import type {
  CreateConversationOutput,
  ObservationFrame,
  RuntimeError,
  SubmitInput,
  SubmitOutput,
} from "@frogie/core/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDashboardViewModel,
  type DashboardApi,
  type DashboardScope,
  type DashboardViewModel,
  type SquadSummary,
} from "./DashboardViewModel.js";

const scopeA: DashboardScope = {
  environmentId: "local-a",
  squadId: "alpha",
  harnessId: "harness-a",
};
const scopeB: DashboardScope = {
  environmentId: "local-b",
  squadId: "beta",
  harnessId: "harness-b",
};
const conversation = 1 as SubmitInput["conversationId"];
const submission = 2 as SubmitOutput;
const caller = { id: "local-user" };
const models: DashboardViewModel[] = [];
const squads: readonly SquadSummary[] = [
  { id: "alpha", projectId: "frogie", title: "Alpha" },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function definition(scope = scopeA): DefinitionBundle {
  return {
    schemaVersion: 1,
    squadId: scope.squadId,
    projectId: "frogie",
    title: scope.squadId,
    rootRoleId: "command",
    content: "Mission",
    roles: [],
    skills: [],
    workflows: [],
    files: [
      {
        path: "SQUAD.md",
        content: "Original source",
        encoding: "utf8",
        mode: 0o644,
      },
    ],
    contentHash: scope.squadId,
  };
}

function frame(scope = scopeA): ObservationFrame {
  return {
    type: "snapshot",
    scope,
    conversationId: conversation,
    value: { conversation: { id: conversation }, entries: [], docs: {} },
  };
}

function createdConversation(): CreateConversationOutput {
  return {
    conversationId: conversation,
    binding: {
      conversationId: conversation,
      roleId: "command",
      definitionHash: "definition-hash",
      configHash: "config-hash",
      title: "Review",
    },
  };
}

function fixture() {
  const api = {
    listSquads: vi.fn<DashboardApi["listSquads"]>().mockResolvedValue(squads),
    loadFiles: vi
      .fn<DashboardApi["loadFiles"]>()
      .mockImplementation(async (scope) => definition(scope)),
    saveFile: vi
      .fn<DashboardApi["saveFile"]>()
      .mockImplementation(async (scope, draft) => {
        const original = definition(scope);
        return {
          ...original,
          files: original.files.map((file) =>
            file.path === draft.path
              ? { ...file, content: draft.content }
              : file,
          ),
        };
      }),
    listConversations: vi
      .fn<DashboardApi["listConversations"]>()
      .mockResolvedValue([]),
    createConversation: vi.fn<DashboardApi["createConversation"]>(),
    submit: vi.fn<DashboardApi["submit"]>().mockResolvedValue(submission),
    getSubmission: vi
      .fn<DashboardApi["getSubmission"]>()
      .mockResolvedValue(undefined),
    observe: vi.fn<DashboardApi["observe"]>().mockReturnValue(vi.fn()),
    cancel: vi.fn<DashboardApi["cancel"]>().mockResolvedValue(undefined),
    compact: vi.fn<DashboardApi["compact"]>().mockResolvedValue(undefined),
  } satisfies DashboardApi;
  const vm = createDashboardViewModel(api, caller);
  models.push(vm);
  return { api, vm };
}

afterEach(() => {
  for (const vm of models.splice(0)) vm.dispose();
});

describe("DashboardViewModel", () => {
  it("constructs an idle stable snapshot without IO", () => {
    const { api, vm } = fixture();
    const state = vm.store.getSnapshot();
    expect(state).toMatchObject({
      scope: undefined,
      definition: undefined,
      squads: [],
      busy: false,
      error: undefined,
    });
    expect(state.drafts.size).toBe(0);
    expect(state.conversations.size).toBe(0);
    expect(vm.store.getSnapshot()).toBe(state);
    for (const method of Object.values(api))
      expect(method).not.toHaveBeenCalled();
  });

  it("refreshes squads without a scope and publishes loading and completion", async () => {
    const { api, vm } = fixture();
    const pending = deferred<readonly SquadSummary[]>();
    api.listSquads.mockReturnValueOnce(pending.promise);
    const listener = vi.fn();
    vm.store.subscribe(listener);
    const operation = vm.refreshSquads().catch((error: unknown) => error);
    expect(vm.store.getSnapshot().busy).toBe(true);
    expect(api.listSquads).toHaveBeenCalledTimes(1);
    pending.resolve(squads);
    expect(await operation).toBeUndefined();
    expect(vm.store.getSnapshot()).toMatchObject({
      squads,
      scope: undefined,
      busy: false,
      error: undefined,
    });
    expect(listener).toHaveBeenCalled();
    expect(api.loadFiles).not.toHaveBeenCalled();
  });

  it("preserves the previous squad list when refresh fails and releases busy", async () => {
    const { api, vm } = fixture();
    await vm.refreshSquads();
    const error: RuntimeError = {
      code: "offline",
      message: "Squad listing unavailable",
      retryable: true,
    };
    api.listSquads.mockRejectedValueOnce(error);
    await expect(vm.refreshSquads()).rejects.toEqual(error);
    expect(vm.store.getSnapshot()).toMatchObject({
      squads,
      error,
      busy: false,
    });
  });

  it("keeps the latest squad refresh when an older request finishes last", async () => {
    const { api, vm } = fixture();
    const old = deferred<readonly SquadSummary[]>();
    const recent = deferred<readonly SquadSummary[]>();
    const latest = [{ id: "beta", projectId: "frogie", title: "Beta" }];
    api.listSquads
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(recent.promise);
    const first = vm.refreshSquads().catch((error: unknown) => error);
    const second = vm.refreshSquads().catch((error: unknown) => error);
    recent.resolve(latest);
    expect(await second).toBeUndefined();
    expect(vm.store.getSnapshot().squads).toEqual(latest);
    old.resolve(squads);
    expect(await first).toBeUndefined();
    expect(vm.store.getSnapshot()).toMatchObject({
      squads: latest,
      busy: false,
      error: undefined,
    });
  });

  it("does not discard a squad refresh when the selected scope changes", async () => {
    const { api, vm } = fixture();
    const pending = deferred<readonly SquadSummary[]>();
    api.listSquads.mockReturnValueOnce(pending.promise);
    const refreshing = vm.refreshSquads().catch((error: unknown) => error);
    await vm.setScope(scopeB);
    expect(vm.store.getSnapshot().busy).toBe(true);
    pending.resolve(squads);
    expect(await refreshing).toBeUndefined();
    expect(vm.store.getSnapshot()).toMatchObject({
      scope: scopeB,
      definition: definition(scopeB),
      squads,
      busy: false,
    });
  });

  it("ignores a squad response after disposal and leaves late subscribers inert", async () => {
    const { api, vm } = fixture();
    const pending = deferred<readonly SquadSummary[]>();
    api.listSquads.mockReturnValueOnce(pending.promise);
    const refreshing = vm.refreshSquads().catch((error: unknown) => error);
    vm.dispose();
    const state = vm.store.getSnapshot();
    const listener = vi.fn();
    const release = vm.store.subscribe(listener);
    pending.resolve(squads);
    expect(await refreshing).toBeUndefined();
    await vm.setScope(scopeA);
    vm.observe(conversation);
    vm.editFile("SQUAD.md", "Late edit");
    release();
    release();
    expect(vm.store.getSnapshot()).toBe(state);
    expect(listener).not.toHaveBeenCalled();
    expect(api.loadFiles).not.toHaveBeenCalled();
    expect(api.observe).not.toHaveBeenCalled();
  });

  it.each([new Error("Listing failed"), "Listing failed"])(
    "normalizes a squad refresh rejection: %s",
    async (error) => {
      const { api, vm } = fixture();
      await vm.refreshSquads();
      api.listSquads.mockRejectedValueOnce(error);
      await expect(vm.refreshSquads()).rejects.toBe(error);
      expect(vm.store.getSnapshot()).toMatchObject({
        squads,
        busy: false,
        error: {
          code: "runtime_unavailable",
          message: "Listing failed",
          retryable: true,
        },
      });
      expect(vm.store.getSnapshot().error?.scope).toBeUndefined();
    },
  );

  it("ignores an older refresh failure after the latest list succeeds", async () => {
    const { api, vm } = fixture();
    const pending = deferred<readonly SquadSummary[]>();
    api.listSquads.mockReturnValueOnce(pending.promise);
    const old = vm.refreshSquads();
    const rejected = expect(old).rejects.toThrow("Old listing failed");
    await vm.refreshSquads();
    const state = vm.store.getSnapshot();
    pending.reject(new Error("Old listing failed"));
    await rejected;
    expect(vm.store.getSnapshot()).toBe(state);
  });

  it("keeps scope loading busy when an independent squad refresh finishes", async () => {
    const { api, vm } = fixture();
    const pending = deferred<DefinitionBundle>();
    api.loadFiles.mockReturnValueOnce(pending.promise);
    const loading = vm.setScope(scopeA);
    await vm.refreshSquads();
    expect(vm.store.getSnapshot()).toMatchObject({ squads, busy: true });
    pending.resolve(definition());
    await loading;
    expect(vm.store.getSnapshot().busy).toBe(false);
  });

  it("does not start squad IO after disposal", async () => {
    const { api, vm } = fixture();
    vm.dispose();
    const state = vm.store.getSnapshot();
    await vm.refreshSquads();
    expect(api.listSquads).not.toHaveBeenCalled();
    expect(vm.store.getSnapshot()).toBe(state);
  });

  it("publishes scope loading transitions and unsubscribes store listeners", async () => {
    const { api, vm } = fixture();
    const pending = deferred<DefinitionBundle>();
    api.loadFiles.mockReturnValueOnce(pending.promise);
    const listener = vi.fn();
    const release = vm.store.subscribe(listener);
    const operation = vm.setScope(scopeA);
    expect(vm.store.getSnapshot().busy).toBe(true);
    pending.resolve(definition());
    await operation;
    expect(vm.store.getSnapshot()).toMatchObject({
      scope: scopeA,
      definition: definition(),
      busy: false,
      error: undefined,
    });
    expect(listener).toHaveBeenCalled();
    release();
    listener.mockClear();
    vm.editFile("SQUAD.md", "Edited");
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores older scope loads completing after a newer selection", async () => {
    const { api, vm } = fixture();
    const old = deferred<DefinitionBundle>();
    api.loadFiles.mockImplementation((scope) =>
      scope.squadId === scopeA.squadId
        ? old.promise
        : Promise.resolve(definition(scopeB)),
    );
    const first = vm.setScope(scopeA);
    await vm.setScope(scopeB);
    old.resolve(definition(scopeA));
    await first;
    expect(vm.store.getSnapshot()).toMatchObject({
      scope: scopeB,
      definition: definition(scopeB),
      busy: false,
    });
    expect(api.listConversations).toHaveBeenCalledWith(scopeB);
  });

  it("restores observations for every existing conversation on scope load", async () => {
    const { api, vm } = fixture();
    const other = 9 as SubmitInput["conversationId"];
    api.listConversations.mockResolvedValueOnce([conversation, other]);
    await vm.setScope(scopeA);
    expect(api.observe.mock.calls.map(([scope, id]) => [scope, id])).toEqual([
      [scopeA, conversation],
      [scopeA, other],
    ]);
    api.observe.mock.calls[0]?.[2](frame());
    api.observe.mock.calls[1]?.[2]({
      ...frame(),
      conversationId: other,
      value: { conversation: { id: other }, entries: [], docs: {} },
    });
    expect([...vm.store.getSnapshot().conversations.keys()]).toEqual([
      conversation,
      other,
    ]);
    expect(vm.store.getSnapshot().busy).toBe(false);
  });

  it("does not let an older scope load failure erase a loaded selection", async () => {
    const { api, vm } = fixture();
    const pending = deferred<DefinitionBundle>();
    api.loadFiles.mockReturnValueOnce(pending.promise);
    const loading = vm.setScope(scopeA);
    const rejected = expect(loading).rejects.toThrow("Old load failed");
    await vm.setScope(scopeB);
    const state = vm.store.getSnapshot();
    pending.reject(new Error("Old load failed"));
    await rejected;
    expect(vm.store.getSnapshot()).toBe(state);
  });

  it("creates a conversation with the selected identity and observes it automatically", async () => {
    const { api, vm } = fixture();
    api.createConversation.mockResolvedValueOnce(createdConversation());
    await vm.setScope(scopeA);
    const input = { roleId: "command", workflowId: "review" };
    await expect(vm.createConversation(input)).resolves.toBe(conversation);
    expect(api.createConversation).toHaveBeenCalledWith({
      scope: scopeA,
      caller,
      input,
    });
    expect(api.observe).toHaveBeenCalledWith(
      scopeA,
      conversation,
      expect.any(Function),
    );
    api.observe.mock.calls[0]?.[2](frame());
    expect(vm.store.getSnapshot().conversations.get(conversation)).toEqual(
      frame().value,
    );
    expect(vm.store.getSnapshot()).toMatchObject({
      busy: false,
      error: undefined,
    });
  });

  it("does not observe an old-scope conversation created after switching scope", async () => {
    const { api, vm } = fixture();
    const pending = deferred<CreateConversationOutput>();
    api.createConversation.mockReturnValueOnce(pending.promise);
    await vm.setScope(scopeA);
    const creating = vm.createConversation({ roleId: "command" });
    await vm.setScope(scopeB);
    const state = vm.store.getSnapshot();
    pending.resolve(createdConversation());
    await expect(creating).resolves.toBe(conversation);
    expect(api.observe).not.toHaveBeenCalled();
    expect(vm.store.getSnapshot()).toBe(state);
  });

  it("releases old observation on scope change and rejects late or cross-scope frames", async () => {
    const { api, vm } = fixture();
    const release = vi.fn();
    api.observe.mockReturnValue(release);
    await vm.setScope(scopeA);
    vm.observe(conversation);
    const listener = api.observe.mock.calls[0]?.[2];
    expect(listener).toBeTypeOf("function");
    listener?.(frame());
    expect(vm.store.getSnapshot().conversations.get(conversation)).toEqual(
      frame().value,
    );
    await vm.setScope(scopeB);
    expect(release).toHaveBeenCalledTimes(1);
    listener?.(frame());
    expect(vm.store.getSnapshot().conversations.size).toBe(0);
    vm.observe(conversation);
    api.observe.mock.calls[1]?.[2](frame(scopeA));
    expect(vm.store.getSnapshot().conversations.size).toBe(0);
  });

  it("ignores a frame for a different conversation in the same scope", async () => {
    const { api, vm } = fixture();
    await vm.setScope(scopeA);
    vm.observe(conversation);
    const other = 9 as SubmitInput["conversationId"];
    api.observe.mock.calls[0]?.[2]({
      ...frame(),
      conversationId: other,
      value: { conversation: { id: other }, entries: [], docs: {} },
    });
    expect(vm.store.getSnapshot().conversations.size).toBe(0);
    api.observe.mock.calls[0]?.[2](frame());
    expect(vm.store.getSnapshot().conversations.get(conversation)).toEqual(
      frame().value,
    );
  });

  it.each(["environmentId", "squadId", "harnessId"] as const)(
    "rejects an observation whose %s does not match the selected scope",
    async (field) => {
      const { api, vm } = fixture();
      await vm.setScope(scopeA);
      vm.observe(conversation);
      const state = vm.store.getSnapshot();
      api.observe.mock.calls[0]?.[2](
        frame({ ...scopeA, [field]: "unrelated" }),
      );
      expect(vm.store.getSnapshot()).toBe(state);
    },
  );

  it("rejects a frame whose nested conversation identity contradicts its envelope", async () => {
    const { api, vm } = fixture();
    await vm.setScope(scopeA);
    vm.observe(conversation);
    const state = vm.store.getSnapshot();
    api.observe.mock.calls[0]?.[2]({
      ...frame(),
      value: {
        conversation: { id: 9 as SubmitInput["conversationId"] },
        entries: [],
        docs: {},
      },
    });
    expect(vm.store.getSnapshot()).toBe(state);
  });

  it("deduplicates observation and releases its subscription only once", async () => {
    const { api, vm } = fixture();
    const release = vi.fn();
    api.observe.mockReturnValue(release);
    await vm.setScope(scopeA);
    vm.observe(conversation);
    vm.observe(conversation);
    expect(api.observe).toHaveBeenCalledTimes(1);
    vm.dispose();
    vm.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("disposes observation once and ignores post-dispose frames and pending loads", async () => {
    const { api, vm } = fixture();
    const release = vi.fn();
    api.observe.mockReturnValue(release);
    await vm.setScope(scopeA);
    vm.observe(conversation);
    const pending = deferred<DefinitionBundle>();
    api.loadFiles.mockReturnValueOnce(pending.promise);
    const loading = vm.setScope(scopeB);
    const listener = vi.fn();
    vm.store.subscribe(listener);
    vm.dispose();
    vm.dispose();
    const state = vm.store.getSnapshot();
    listener.mockClear();
    api.observe.mock.calls[0]?.[2](frame());
    pending.resolve(definition(scopeB));
    await loading;
    expect(release).toHaveBeenCalledTimes(1);
    expect(vm.store.getSnapshot()).toBe(state);
    expect(listener).not.toHaveBeenCalled();
  });

  it("retains a failed send requestId on retry and allocates a new ID after acceptance", async () => {
    const { api, vm } = fixture();
    const error: RuntimeError = {
      code: "offline",
      message: "Connection lost",
      retryable: true,
      scope: scopeA,
    };
    api.submit.mockRejectedValueOnce(error);
    await vm.setScope(scopeA);
    await expect(vm.submit(conversation, "Review")).rejects.toEqual(error);
    expect(vm.store.getSnapshot()).toMatchObject({ error, busy: false });
    await expect(vm.submit(conversation, "Review")).resolves.toBe(submission);
    await vm.submit(conversation, "Review");
    const calls = api.submit.mock.calls.map(([call]) => call);
    const requestId = calls[0]?.input.submission.requestId;
    expect(requestId).toEqual(expect.any(String));
    expect(requestId?.length).toBeGreaterThan(0);
    expect(calls[1]?.input.submission.requestId).toBe(requestId);
    expect(calls[2]?.input.submission.requestId).not.toBe(requestId);
    expect(calls[0]).toMatchObject({
      scope: scopeA,
      caller,
      input: {
        conversationId: conversation,
        submission: { type: "input", content: "Review" },
      },
    });
  });

  it("coalesces concurrent submissions of the same intent", async () => {
    const { api, vm } = fixture();
    const pending = deferred<SubmitOutput>();
    api.submit.mockReturnValue(pending.promise);
    await vm.setScope(scopeA);
    const first = vm.submit(conversation, "Review");
    const second = vm.submit(conversation, "Review");
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(vm.store.getSnapshot().busy).toBe(true);
    pending.resolve(submission);
    expect(await Promise.all([first, second])).toEqual([
      submission,
      submission,
    ]);
    expect(vm.store.getSnapshot().busy).toBe(false);
  });

  it.each(["environmentId", "squadId", "harnessId"] as const)(
    "retains a failed submission identity across a %s switch without sharing it",
    async (field) => {
      const { api, vm } = fixture();
      const other = { ...scopeA, [field]: "other-scope" };
      const error: RuntimeError = {
        code: "offline",
        message: "Acceptance could not be confirmed",
        retryable: true,
        scope: scopeA,
      };
      api.submit.mockRejectedValueOnce(error);
      await vm.setScope(scopeA);
      await expect(vm.submit(conversation, "Review")).rejects.toBe(error);
      await vm.setScope(other);
      await expect(vm.submit(conversation, "Review")).resolves.toBe(submission);
      await vm.setScope(scopeA);
      await expect(vm.submit(conversation, "Review")).resolves.toBe(submission);

      const [failed, otherScope, retried] = api.submit.mock.calls.map(
        ([call]) => call,
      );
      const requestId = failed?.input.submission.requestId;
      expect(requestId).toEqual(expect.any(String));
      expect(failed?.scope).toEqual(scopeA);
      expect(otherScope?.scope).toEqual(other);
      expect(otherScope?.input.submission.requestId).not.toBe(requestId);
      expect(retried?.scope).toEqual(scopeA);
      expect(retried?.input.submission.requestId).toBe(requestId);
      expect(vm.store.getSnapshot()).toMatchObject({
        scope: scopeA,
        busy: false,
        error: undefined,
      });
    },
  );

  it("keeps different concurrent submission identities and busy until both settle", async () => {
    const { api, vm } = fixture();
    const one = deferred<SubmitOutput>();
    const two = deferred<SubmitOutput>();
    const otherSubmission = 3 as SubmitOutput;
    api.submit
      .mockReturnValueOnce(one.promise)
      .mockReturnValueOnce(two.promise);
    await vm.setScope(scopeA);
    const first = vm.submit(conversation, "First intent");
    const second = vm.submit(conversation, "Second intent");
    const ids = api.submit.mock.calls.map(
      ([call]) => call.input.submission.requestId,
    );
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(2);
    one.resolve(submission);
    await expect(first).resolves.toBe(submission);
    expect(vm.store.getSnapshot().busy).toBe(true);
    two.resolve(otherSubmission);
    await expect(second).resolves.toBe(otherSubmission);
    expect(vm.store.getSnapshot().busy).toBe(false);
  });

  it("does not let a failed old-scope send overwrite the current error or busy state", async () => {
    const { api, vm } = fixture();
    const pending = deferred<SubmitOutput>();
    api.submit.mockReturnValueOnce(pending.promise);
    await vm.setScope(scopeA);
    const sending = vm.submit(conversation, "Old request");
    const rejection = expect(sending).rejects.toMatchObject({
      code: "offline",
    });
    await vm.setScope(scopeB);
    pending.reject({
      code: "offline",
      message: "Old connection lost",
      retryable: true,
    });
    await rejection;
    expect(vm.store.getSnapshot()).toMatchObject({
      scope: scopeB,
      error: undefined,
      busy: false,
    });
  });

  it("does not let an accepted old-scope send change the current snapshot", async () => {
    const { api, vm } = fixture();
    const pending = deferred<SubmitOutput>();
    api.submit.mockReturnValueOnce(pending.promise);
    await vm.setScope(scopeA);
    const sending = vm.submit(conversation, "Old request");
    await vm.setScope(scopeB);
    const state = vm.store.getSnapshot();
    pending.resolve(submission);
    await expect(sending).resolves.toBe(submission);
    expect(vm.store.getSnapshot()).toBe(state);
  });

  it("preserves the original baseContent across draft edits", async () => {
    const { vm } = fixture();
    await vm.setScope(scopeA);
    vm.editFile("SQUAD.md", "First edit");
    vm.editFile("SQUAD.md", "Second edit");
    expect(vm.store.getSnapshot().drafts.get("SQUAD.md")).toEqual({
      path: "SQUAD.md",
      content: "Second edit",
      baseContent: "Original source",
    });
  });

  it("ignores unknown files and drops drafts restored to the saved source", async () => {
    const { api, vm } = fixture();
    await vm.setScope(scopeA);
    const state = vm.store.getSnapshot();
    vm.editFile("missing.md", "Unknown file");
    expect(vm.store.getSnapshot()).toBe(state);
    await vm.saveFile("missing.md");
    expect(api.saveFile).not.toHaveBeenCalled();
    vm.editFile("SQUAD.md", "Edited");
    vm.editFile("SQUAD.md", "Original source");
    expect(vm.store.getSnapshot().drafts.size).toBe(0);
    await vm.saveFile("SQUAD.md");
    expect(api.saveFile).not.toHaveBeenCalled();
  });

  it("keeps a failed save draft and clears it only after a successful retry", async () => {
    const { api, vm } = fixture();
    const error: RuntimeError = {
      code: "conflict",
      message: "Source changed",
      retryable: false,
    };
    api.saveFile.mockRejectedValueOnce(error);
    await vm.setScope(scopeA);
    vm.editFile("SQUAD.md", "Edited source");
    await expect(vm.saveFile("SQUAD.md")).rejects.toEqual(error);
    expect(vm.store.getSnapshot().drafts.get("SQUAD.md")?.content).toBe(
      "Edited source",
    );
    expect(vm.store.getSnapshot()).toMatchObject({ error, busy: false });
    await vm.saveFile("SQUAD.md");
    const retryId = api.saveFile.mock.calls[0]?.[2];
    expect(retryId).toEqual(expect.any(String));
    expect(api.saveFile.mock.calls[1]?.[2]).toBe(retryId);
    expect(api.saveFile.mock.calls[0]?.slice(0, 2)).toEqual([
      scopeA,
      {
        path: "SQUAD.md",
        content: "Edited source",
        baseContent: "Original source",
      },
    ]);
    expect(vm.store.getSnapshot().drafts.has("SQUAD.md")).toBe(false);
    expect(vm.store.getSnapshot().definition?.files[0]?.content).toBe(
      "Edited source",
    );
  });

  it("assigns a new save identity when the failed draft is revised", async () => {
    const { api, vm } = fixture();
    api.saveFile.mockRejectedValueOnce(new Error("Save failed"));
    await vm.setScope(scopeA);
    vm.editFile("SQUAD.md", "First draft");
    await expect(vm.saveFile("SQUAD.md")).rejects.toThrow("Save failed");
    vm.editFile("SQUAD.md", "Revised draft");
    await vm.saveFile("SQUAD.md");
    expect(api.saveFile.mock.calls[1]?.[2]).not.toBe(
      api.saveFile.mock.calls[0]?.[2],
    );
    expect(vm.store.getSnapshot().drafts.size).toBe(0);
    expect(vm.store.getSnapshot().definition?.files[0]?.content).toBe(
      "Revised draft",
    );
  });

  it.each(["scope change", "dispose"] as const)(
    "ignores a save response after %s",
    async (transition) => {
      const { api, vm } = fixture();
      const pending = deferred<DefinitionBundle>();
      api.saveFile.mockReturnValueOnce(pending.promise);
      await vm.setScope(scopeA);
      vm.editFile("SQUAD.md", "Old draft");
      const saving = vm.saveFile("SQUAD.md");
      if (transition === "scope change") await vm.setScope(scopeB);
      else vm.dispose();
      const state = vm.store.getSnapshot();
      pending.resolve({ ...definition(), contentHash: "old-save-result" });
      await saving;
      expect(vm.store.getSnapshot()).toBe(state);
    },
  );

  it.each(["scope change", "dispose"] as const)(
    "does not publish a late save failure after %s",
    async (transition) => {
      const { api, vm } = fixture();
      const pending = deferred<DefinitionBundle>();
      api.saveFile.mockReturnValueOnce(pending.promise);
      await vm.setScope(scopeA);
      vm.editFile("SQUAD.md", "Old draft");
      const saving = vm.saveFile("SQUAD.md");
      const rejected = expect(saving).rejects.toThrow("Old save failed");
      if (transition === "scope change") await vm.setScope(scopeB);
      else vm.dispose();
      const state = vm.store.getSnapshot();
      pending.reject(new Error("Old save failed"));
      await rejected;
      expect(vm.store.getSnapshot()).toBe(state);
    },
  );

  it("preserves newer edits made while an earlier draft is being saved", async () => {
    const { api, vm } = fixture();
    const pending = deferred<DefinitionBundle>();
    api.saveFile.mockReturnValueOnce(pending.promise);
    await vm.setScope(scopeA);
    vm.editFile("SQUAD.md", "Saving draft");
    const saving = vm.saveFile("SQUAD.md");
    expect(vm.store.getSnapshot().busy).toBe(true);
    vm.editFile("SQUAD.md", "Newer draft");
    pending.resolve({
      ...definition(),
      files: definition().files.map((file) => ({
        ...file,
        content: "Saving draft",
      })),
    });
    await saving;
    expect(vm.store.getSnapshot().drafts.get("SQUAD.md")).toEqual({
      path: "SQUAD.md",
      content: "Newer draft",
      baseContent: "Saving draft",
    });
  });

  it("preserves a revert to the previous source made while saving a changed draft", async () => {
    const { api, vm } = fixture();
    const pending = deferred<DefinitionBundle>();
    api.saveFile.mockReturnValueOnce(pending.promise);
    await vm.setScope(scopeA);
    vm.editFile("SQUAD.md", "Saving draft");
    const saving = vm.saveFile("SQUAD.md");
    vm.editFile("SQUAD.md", "Original source");
    pending.resolve({
      ...definition(),
      files: definition().files.map((file) => ({
        ...file,
        content: "Saving draft",
      })),
    });
    await saving;
    expect(vm.store.getSnapshot().definition?.files[0]?.content).toBe(
      "Saving draft",
    );
    expect(vm.store.getSnapshot().drafts.get("SQUAD.md")).toEqual({
      path: "SQUAD.md",
      content: "Original source",
      baseContent: "Saving draft",
    });
    expect(vm.store.getSnapshot().busy).toBe(false);
  });

  it("refreshes the complete parsed definition after saving without losing unrelated drafts", async () => {
    const { api, vm } = fixture();
    const path = "roles/command/ROLE.md";
    const original: DefinitionBundle = {
      ...definition(),
      roles: [
        {
          id: "command",
          title: "Command",
          parentRoleId: null,
          content: "Original role",
          skills: [],
          extensions: [],
          tools: [],
          scripts: [],
        },
      ],
      files: [
        ...definition().files,
        { path, content: "Original role", encoding: "utf8", mode: 0o644 },
      ],
    };
    const refreshed: DefinitionBundle = {
      ...original,
      roles: original.roles.map((role) => ({ ...role, content: "Saved role" })),
      files: original.files.map((file) =>
        file.path === path ? { ...file, content: "Saved role" } : file,
      ),
      contentHash: "server-reparsed-content-hash",
    };
    api.loadFiles.mockResolvedValueOnce(original);
    api.saveFile.mockResolvedValueOnce(refreshed);
    await vm.setScope(scopeA);
    vm.editFile("SQUAD.md", "Unrelated unsaved draft");
    vm.editFile(path, "Saved role");

    await vm.saveFile(path);

    expect(vm.store.getSnapshot().definition).toEqual(refreshed);
    expect(vm.store.getSnapshot().drafts.has(path)).toBe(false);
    expect(vm.store.getSnapshot().drafts.get("SQUAD.md")).toEqual({
      path: "SQUAD.md",
      content: "Unrelated unsaved draft",
      baseContent: "Original source",
    });
    expect(vm.store.getSnapshot()).toMatchObject({
      busy: false,
      error: undefined,
    });
  });

  it("rejects a concurrent file save without losing either draft or interrupting the first save", async () => {
    const { api, vm } = fixture();
    const otherPath = "roles/command/ROLE.md";
    const original: DefinitionBundle = {
      ...definition(),
      files: [
        ...definition().files,
        {
          path: otherPath,
          content: "Original role",
          encoding: "utf8",
          mode: 0o644,
        },
      ],
    };
    const firstBundle: DefinitionBundle = {
      ...original,
      contentHash: "first-save-hash",
      files: original.files.map((file) =>
        file.path === "SQUAD.md" ? { ...file, content: "Saved squad" } : file,
      ),
    };
    const finalBundle: DefinitionBundle = {
      ...firstBundle,
      contentHash: "both-saved-hash",
      files: firstBundle.files.map((file) =>
        file.path === otherPath ? { ...file, content: "Saved role" } : file,
      ),
    };
    const pending = deferred<DefinitionBundle>();
    api.loadFiles.mockResolvedValueOnce(original);
    api.saveFile
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(finalBundle);
    await vm.setScope(scopeA);
    vm.editFile("SQUAD.md", "Saved squad");
    vm.editFile(otherPath, "Saved role");
    const drafts = [...vm.store.getSnapshot().drafts];
    const saving = vm.saveFile("SQUAD.md");

    await expect(vm.saveFile(otherPath)).rejects.toMatchObject({
      code: "definition_busy",
      retryable: true,
      scope: scopeA,
    });
    expect(api.saveFile).toHaveBeenCalledTimes(1);
    expect([...vm.store.getSnapshot().drafts]).toEqual(drafts);
    expect(vm.store.getSnapshot().definition).toEqual(original);
    expect(vm.store.getSnapshot().busy).toBe(true);

    pending.resolve(firstBundle);
    await saving;
    expect(vm.store.getSnapshot().definition).toEqual(firstBundle);
    expect(vm.store.getSnapshot().drafts.has("SQUAD.md")).toBe(false);
    expect(vm.store.getSnapshot().drafts.get(otherPath)).toEqual({
      path: otherPath,
      content: "Saved role",
      baseContent: "Original role",
    });
    expect(vm.store.getSnapshot().busy).toBe(false);
    await vm.saveFile(otherPath);
    expect(api.saveFile).toHaveBeenCalledTimes(2);
    expect(api.saveFile.mock.calls[1]?.slice(0, 2)).toEqual([
      scopeA,
      { path: otherPath, content: "Saved role", baseContent: "Original role" },
    ]);
    expect(vm.store.getSnapshot().definition).toEqual(finalBundle);
    expect(vm.store.getSnapshot().drafts.size).toBe(0);
    expect(vm.store.getSnapshot()).toMatchObject({
      busy: false,
      error: undefined,
    });
  });

  it("reports failed loading and releases busy state without inventing a definition", async () => {
    const { api, vm } = fixture();
    const error: RuntimeError = {
      code: "invalid_definition",
      message: "Invalid definition",
      retryable: false,
    };
    api.loadFiles.mockRejectedValueOnce(error);
    await expect(vm.setScope(scopeA)).rejects.toEqual(error);
    expect(vm.store.getSnapshot()).toMatchObject({
      definition: undefined,
      error,
      busy: false,
    });
  });

  it("routes stop and compact to the selected scope without disposing observation", async () => {
    const { api, vm } = fixture();
    const release = vi.fn();
    api.observe.mockReturnValue(release);
    await vm.setScope(scopeA);
    vm.observe(conversation);
    await vm.cancel(conversation, submission);
    await vm.compact(conversation);
    expect(api.cancel).toHaveBeenCalledWith(scopeA, conversation, submission);
    expect(api.compact).toHaveBeenCalledWith(scopeA, conversation);
    expect(release).not.toHaveBeenCalled();
  });

  it.each(["createConversation", "cancel", "compact"] as const)(
    "releases busy and publishes %s errors without removing observation",
    async (method) => {
      const { api, vm } = fixture();
      const pending = deferred<never>();
      const release = vi.fn();
      const error: RuntimeError = {
        code: "offline",
        message: `${method} unavailable`,
        retryable: true,
        scope: scopeA,
      };
      api.observe.mockReturnValue(release);
      api[method].mockReturnValueOnce(pending.promise);
      await vm.setScope(scopeA);
      vm.observe(conversation);
      const operation =
        method === "createConversation"
          ? vm.createConversation({ roleId: "command" })
          : method === "cancel"
            ? vm.cancel(conversation, submission)
            : vm.compact(conversation);
      const rejected = expect(operation).rejects.toEqual(error);
      expect(vm.store.getSnapshot().busy).toBe(true);
      pending.reject(error);
      await rejected;
      expect(vm.store.getSnapshot()).toMatchObject({ error, busy: false });
      expect(release).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["cancel", "success"],
    ["cancel", "failure"],
    ["compact", "success"],
    ["compact", "failure"],
  ] as const)(
    "does not let old-scope %s %s clear the current operation or error",
    async (method, outcome) => {
      const { api, vm } = fixture();
      const pending = deferred<void>();
      api[method].mockReturnValueOnce(pending.promise);
      await vm.setScope(scopeA);
      const operation = vm[method](conversation);
      const completion =
        outcome === "failure"
          ? expect(operation).rejects.toThrow("Old operation failed")
          : operation;
      await vm.setScope(scopeB);
      const currentError: RuntimeError = {
        code: "offline",
        message: "Current scope error",
        retryable: true,
        scope: scopeB,
      };
      api.submit.mockRejectedValueOnce(currentError);
      await expect(vm.submit(conversation, "Current intent")).rejects.toBe(
        currentError,
      );
      const current = deferred<SubmitOutput>();
      api.submit.mockReturnValueOnce(current.promise);
      const sending = vm.submit(conversation, "Current retry");
      const state = vm.store.getSnapshot();
      expect(state).toMatchObject({ busy: true, error: currentError });
      if (outcome === "failure")
        pending.reject(new Error("Old operation failed"));
      else pending.resolve();
      await completion;
      expect(vm.store.getSnapshot()).toBe(state);
      current.resolve(submission);
      await sending;
      expect(vm.store.getSnapshot()).toMatchObject({
        busy: false,
        error: undefined,
      });
    },
  );

  it("rejects scoped actions before selection without IO or snapshot changes", async () => {
    const { api, vm } = fixture();
    const state = vm.store.getSnapshot();
    await expect(vm.saveFile("SQUAD.md")).rejects.toThrow();
    await expect(
      vm.createConversation({ roleId: "command" }),
    ).rejects.toThrow();
    await expect(vm.submit(conversation, "Review")).rejects.toThrow();
    await expect(vm.cancel(conversation)).rejects.toThrow();
    await expect(vm.compact(conversation)).rejects.toThrow();
    vm.observe(conversation);
    vm.editFile("SQUAD.md", "Unscoped edit");
    expect(vm.store.getSnapshot()).toBe(state);
    for (const method of Object.values(api))
      expect(method).not.toHaveBeenCalled();
  });
});
