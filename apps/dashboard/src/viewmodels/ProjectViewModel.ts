import type { DaemonProject } from "@frogie/core/protocol";
import type { LocalRuntimeClient } from "../models/localClient.js";

export interface ProjectSnapshot {
  readonly projects: readonly DaemonProject[];
  readonly busy: boolean;
  readonly error: string | null;
}

export function createProjectViewModel(client: LocalRuntimeClient) {
  let snapshot: ProjectSnapshot = {
    projects: client.context.projects,
    busy: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  let disposed = false;
  let epoch = 0;
  let pending = 0;
  const publish = (change: Partial<ProjectSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  };
  const refresh = async () => {
    if (disposed) return;
    const current = ++epoch;
    try {
      const projects = await client.listProjects();
      if (!disposed && current === epoch) publish({ projects, error: null });
    } catch (error) {
      if (!disposed && current === epoch)
        publish({
          error: error instanceof Error ? error.message : "项目目录加载失败",
        });
    }
  };
  const change = async (operation: () => Promise<DaemonProject>) => {
    if (disposed || pending) return;
    pending++;
    epoch++;
    publish({ busy: true, error: null });
    try {
      const project = await operation();
      if (disposed) return;
      publish({
        projects: [
          ...snapshot.projects.filter(
            (item) => item.projectId !== project.projectId,
          ),
          project,
        ],
      });
      await refresh();
    } catch (error) {
      publish({
        error: error instanceof Error ? error.message : "项目操作失败",
      });
      throw error;
    } finally {
      pending--;
      publish({ busy: false });
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    setEnabled: (id: string, enabled: boolean) =>
      change(() => client.setProjectEnabled(id, enabled)),
    bind: (id: string) => change(() => client.bindDefinition(id)),
    register: (squadId: string) =>
      change(() => client.registerProject(squadId)),
    dispose() {
      disposed = true;
      epoch++;
      listeners.clear();
    },
  };
}
