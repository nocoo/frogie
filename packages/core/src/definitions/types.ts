export interface DefinitionModel {
  provider: string;
  modelId: string;
}

export interface DefinitionDefaults {
  model?: DefinitionModel;
  thinkingLevel?: DefinitionThinkingLevel;
}

export interface RoleDefinition extends DefinitionDefaults {
  id: string;
  title: string;
  parentRoleId: string | null;
  content: string;
  skills: string[];
  extensions: string[];
  tools: string[];
  scripts: string[];
}

export interface ScriptDefinition {
  id: string;
  entry: string;
  runtime: "node";
  replay: "safe";
}

export interface SkillDefinition {
  id: string;
  description: string;
  content: string;
  scripts: ScriptDefinition[];
}

export interface WorkflowNode {
  id: string;
  title: string;
  role: string;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  source: string;
  target: string;
  label?: string;
}

export interface WorkflowDefinition {
  id: string;
  title: string;
  entry: string;
  entryRole: string;
  participants: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  content: string;
  tools?: string[];
  scripts?: string[];
}

export interface DefinitionFile {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  mode: number;
}

export interface DefinitionBundle {
  schemaVersion: 1;
  squadId: string;
  projectId: string;
  title: string;
  rootRoleId: string;
  content: string;
  defaults?: DefinitionDefaults;
  roles: RoleDefinition[];
  skills: SkillDefinition[];
  workflows: WorkflowDefinition[];
  files: DefinitionFile[];
  contentHash: string;
}
export type DefinitionThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface DefinitionDiagnostic {
  code: string;
  message: string;
  path: string;
  line?: number;
  field?: string;
}
