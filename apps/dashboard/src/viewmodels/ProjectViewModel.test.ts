import type { DaemonProject, RuntimeScope } from "@frogie/core/protocol";
import { describe, expect, it, vi } from "vitest";
import type { LocalRuntimeClient } from "../models/localClient.js";
import { createProjectViewModel } from "./ProjectViewModel.js";

const scope: RuntimeScope = {
  projectId: "alpha",
  environmentId: "local-env",
  squadId: "alpha-squad",
  harnessId: "alpha-harness",
};
const alpha: DaemonProject = {
  projectId: "alpha",
  title: "Alpha",
  scope,
  enabled: true,
  state: "running",
  definitionHash: "alpha-definition",
  rootConversationId: 17,
};
const beta: DaemonProject = {
  ...alpha,
  projectId: "beta",
  title: "Beta",
  scope: {
    ...scope,
    projectId: "beta",
    squadId: "beta-squad",
    harnessId: "beta-harness",
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const client = {
    context: {
      instanceId: "daemon-test",
      mode: "local",
      projects: [alpha, beta],
    },
    listProjects: vi.fn(async () => [alpha, beta]),
    setProjectEnabled: vi.fn(
      async (_id: string, enabled: boolean): Promise<DaemonProject> => ({
        ...alpha,
        enabled,
        state: enabled ? "running" : "stopped",
      }),
    ),
    bindDefinition: vi.fn(
      async (_id: string): Promise<DaemonProject> => ({
        ...alpha,
        scope: { ...scope, harnessId: "new-harness" },
        definitionHash: "new-definition",
      }),
    ),
    registerProject: vi.fn(
      async (_squadId: string): Promise<DaemonProject> => beta,
    ),
    dispose: vi.fn(),
  };
  const vm = createProjectViewModel(client as unknown as LocalRuntimeClient);
  return { vm, client };
}

describe("ProjectViewModel", () => {
  it("starts with the daemon directory without performing I/O or notifying subscribers", () => {
    const { vm, client } = fixture();
    const listener = vi.fn();
    const release = vm.subscribe(listener);
    expect(vm.getSnapshot()).toEqual({
      projects: [alpha, beta],
      busy: false,
      error: null,
    });
    expect(client.listProjects).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    release();
    release();
    vm.dispose();
    expect(client.dispose).not.toHaveBeenCalled();
  });

  it("refreshes the complete directory, clears prior errors and releases only its own subscriptions", async () => {
    const { vm, client } = fixture();
    const listener = vi.fn();
    const release = vm.subscribe(listener);
    const stopped = { ...alpha, enabled: false, state: "stopped" as const };
    client.listProjects.mockRejectedValueOnce(new Error("Directory offline"));
    await vm.refresh();
    expect(vm.getSnapshot()).toMatchObject({
      projects: [alpha, beta],
      busy: false,
      error: "Directory offline",
    });
    client.listProjects.mockResolvedValueOnce([stopped]);
    await vm.refresh();
    expect(vm.getSnapshot()).toEqual({
      projects: [stopped],
      busy: false,
      error: null,
    });
    expect(listener).toHaveBeenCalledTimes(2);
    release();
    await vm.refresh();
    expect(listener).toHaveBeenCalledTimes(2);
    vm.dispose();
  });

  it.each([false, true])(
    "ignores an older refresh completion including failure (%s)",
    async (fails) => {
      const { vm, client } = fixture();
      const old = deferred<DaemonProject[]>();
      client.listProjects
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce([beta]);
      const first = vm.refresh();
      await vm.refresh();
      if (fails) old.reject(new Error("Stale directory failure"));
      else old.resolve([alpha]);
      await first;
      expect(vm.getSnapshot()).toEqual({
        projects: [beta],
        busy: false,
        error: null,
      });
      vm.dispose();
    },
  );

  it.each(["enabled", "bind", "register"] as const)(
    "executes %s once, publishes its result and reconciles with the directory",
    async (operation) => {
      const { vm, client } = fixture();
      const pending = deferred<DaemonProject>();
      const result = {
        ...alpha,
        scope: { ...scope, harnessId: "changed-harness" },
        definitionHash: "changed-definition",
      };
      const refresh = deferred<DaemonProject[]>();
      client.listProjects.mockReturnValueOnce(refresh.promise);
      const method =
        operation === "enabled"
          ? client.setProjectEnabled
          : operation === "bind"
            ? client.bindDefinition
            : client.registerProject;
      method.mockReturnValueOnce(pending.promise);
      const running =
        operation === "enabled"
          ? vm.setEnabled("alpha", false)
          : operation === "bind"
            ? vm.bind("alpha")
            : vm.register("alpha-squad");
      expect(vm.getSnapshot()).toMatchObject({ busy: true, error: null });
      await vm.bind("beta");
      expect(method).toHaveBeenCalledOnce();
      if (operation === "enabled")
        expect(method).toHaveBeenCalledWith("alpha", false);
      else
        expect(method).toHaveBeenCalledWith(
          operation === "bind" ? "alpha" : "alpha-squad",
        );
      pending.resolve(result);
      await Promise.resolve();
      expect(vm.getSnapshot().projects).toEqual(
        expect.arrayContaining([beta, result]),
      );
      expect(
        vm
          .getSnapshot()
          .projects.filter((project) => project.projectId === "alpha"),
      ).toHaveLength(1);
      expect(vm.getSnapshot().busy).toBe(true);
      refresh.resolve([result, beta]);
      await running;
      expect(vm.getSnapshot()).toEqual({
        projects: [result, beta],
        busy: false,
        error: null,
      });
      expect(client.listProjects).toHaveBeenCalledOnce();
      vm.dispose();
    },
  );

  it("invalidates a poll started before a management action", async () => {
    const { vm, client } = fixture();
    const poll = deferred<DaemonProject[]>();
    const rebound = {
      ...alpha,
      scope: { ...scope, harnessId: "rebound" },
      definitionHash: "rebound",
    };
    client.listProjects
      .mockReturnValueOnce(poll.promise)
      .mockResolvedValueOnce([rebound, beta]);
    client.bindDefinition.mockResolvedValueOnce(rebound);
    const stale = vm.refresh();
    await vm.bind("alpha");
    poll.resolve([alpha]);
    await stale;
    expect(vm.getSnapshot()).toEqual({
      projects: [rebound, beta],
      busy: false,
      error: null,
    });
    vm.dispose();
  });

  it.each([new Error("Not authorized"), "opaque failure"])(
    "preserves the directory and resets busy after a rejected management operation (%#)",
    async (failure) => {
      const { vm, client } = fixture();
      client.bindDefinition.mockRejectedValueOnce(failure);
      await expect(vm.bind("alpha")).rejects.toBe(failure);
      expect(vm.getSnapshot()).toEqual({
        projects: [alpha, beta],
        busy: false,
        error: failure instanceof Error ? failure.message : "项目操作失败",
      });
      expect(client.listProjects).not.toHaveBeenCalled();
      await vm.bind("alpha");
      expect(vm.getSnapshot().busy).toBe(false);
      vm.dispose();
    },
  );

  it("keeps a confirmed management result visible if the subsequent directory refresh fails", async () => {
    const { vm, client } = fixture();
    client.listProjects.mockRejectedValueOnce("opaque refresh failure");
    await vm.setEnabled("alpha", false);
    expect(vm.getSnapshot()).toMatchObject({
      busy: false,
      error: "项目目录加载失败",
    });
    expect(
      vm
        .getSnapshot()
        .projects.find((project) => project.projectId === "alpha"),
    ).toMatchObject({ enabled: false, state: "stopped" });
    vm.dispose();
  });

  it("ignores refresh completion after disposal and does not issue new requests", async () => {
    const { vm, client } = fixture();
    const pending = deferred<DaemonProject[]>();
    client.listProjects.mockReturnValueOnce(pending.promise);
    const listener = vi.fn();
    vm.subscribe(listener);
    const refresh = vm.refresh();
    const snapshot = vm.getSnapshot();
    vm.dispose();
    vm.dispose();
    pending.resolve([beta]);
    await refresh;
    expect(vm.getSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
    await vm.refresh();
    await vm.setEnabled("alpha", false);
    await vm.bind("alpha");
    await vm.register("new-squad");
    expect(client.listProjects).toHaveBeenCalledOnce();
    expect(client.setProjectEnabled).not.toHaveBeenCalled();
    expect(client.bindDefinition).not.toHaveBeenCalled();
    expect(client.registerProject).not.toHaveBeenCalled();
    expect(client.dispose).not.toHaveBeenCalled();
  });

  it("does not retain subscribers or publish late failures after disposal", async () => {
    const { vm, client } = fixture();
    const pending = deferred<DaemonProject[]>();
    client.listProjects.mockReturnValueOnce(pending.promise);
    const refresh = vm.refresh();
    vm.dispose();
    const listener = vi.fn();
    const release = vm.subscribe(listener);
    pending.reject(new Error("Late directory failure"));
    await refresh;
    await vm.refresh();
    expect(listener).not.toHaveBeenCalled();
    expect(vm.getSnapshot().error).toBeNull();
    expect(client.listProjects).toHaveBeenCalledOnce();
    release();
    release();
  });

  it("preserves a caller's late management rejection without refreshing or notifying a disposed ViewModel", async () => {
    const { vm, client } = fixture();
    const pending = deferred<DaemonProject>();
    client.bindDefinition.mockReturnValueOnce(pending.promise);
    const listener = vi.fn();
    vm.subscribe(listener);
    const running = vm.bind("alpha");
    const failure = expect(running).rejects.toThrow("Late bind failure");
    vm.dispose();
    const snapshot = vm.getSnapshot();
    pending.reject(new Error("Late bind failure"));
    await failure;
    expect(vm.getSnapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledOnce();
    expect(client.listProjects).not.toHaveBeenCalled();
  });

  it("does not reconcile a management result or publish late updates after disposal", async () => {
    const { vm, client } = fixture();
    const pending = deferred<DaemonProject>();
    client.bindDefinition.mockReturnValueOnce(pending.promise);
    const listener = vi.fn();
    vm.subscribe(listener);
    const running = vm.bind("alpha");
    expect(listener).toHaveBeenCalledOnce();
    vm.dispose();
    const snapshot = vm.getSnapshot();
    pending.resolve({ ...alpha, definitionHash: "late" });
    await running;
    expect(vm.getSnapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledOnce();
    expect(client.listProjects).not.toHaveBeenCalled();
  });
});
