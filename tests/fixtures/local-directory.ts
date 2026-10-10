import type {
  DaemonDirectory,
  DaemonProject,
  RuntimeScope,
  RuntimeService,
} from "../../packages/core/src/protocol/index.js";

export function localDirectory(
  instanceId: string,
  scope: RuntimeScope,
  service: RuntimeService,
): DaemonDirectory {
  const project: DaemonProject = {
    projectId: scope.projectId,
    title: scope.squadId,
    scope,
    enabled: true,
    state: "running",
    definitionHash: "test-definition",
  };
  const unavailable = async (): Promise<never> => {
    throw Object.assign(new Error("Not registered"), { code: "not_found" });
  };
  return {
    instanceId,
    mode: "e2e",
    listProjects: async () => [project],
    runtime(target) {
      if (
        target.projectId !== scope.projectId ||
        target.environmentId !== scope.environmentId ||
        target.squadId !== scope.squadId ||
        target.harnessId !== scope.harnessId
      )
        throw Object.assign(new Error("Wrong scope"), {
          code: "binding_mismatch",
        });
      return service;
    },
    setProjectEnabled: unavailable,
    registerProject: unavailable,
    bindDefinition: unavailable,
  };
}
