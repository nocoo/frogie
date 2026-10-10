import type { DefinitionThinkingLevel } from "../definitions/types.js";
import type {
  RuntimeDescription,
  RuntimeError,
  RuntimeScope,
  RuntimeService,
} from "./index.js";

export interface DaemonProject {
  readonly projectId: string;
  readonly title: string;
  readonly scope: RuntimeScope;
  readonly enabled: boolean;
  readonly state: "starting" | "running" | "stopped" | "error";
  readonly definitionHash: string;
  readonly rootConversationId?: number;
  readonly model?: {
    readonly provider: string;
    readonly modelId: string;
    readonly thinkingLevel: DefinitionThinkingLevel;
  };
  readonly error?: RuntimeError;
}

export interface DaemonContext {
  readonly instanceId: string;
  readonly mode: "local" | "e2e";
  readonly projects: readonly DaemonProject[];
}

export interface DaemonDirectory {
  readonly instanceId: string;
  readonly mode: "local" | "e2e";
  listProjects(): Promise<readonly DaemonProject[]>;
  runtime(scope: RuntimeScope): RuntimeService;
  setProjectEnabled(
    projectId: string,
    enabled: boolean,
  ): Promise<DaemonProject>;
  registerProject(squadId: string): Promise<DaemonProject>;
  bindDefinition(projectId: string): Promise<DaemonProject>;
}

export interface LocalRuntimeContext {
  readonly instanceId: string;
  readonly scope: RuntimeScope;
  readonly description: RuntimeDescription;
}
