import type { Static, TSchema } from "typebox";
import type {
  DefinitionBundle,
  DefinitionModel,
  DefinitionThinkingLevel,
} from "../definitions/types.js";
import type { RuntimeScope } from "../protocol/index.js";

declare const hostModels: unique symbol;
export interface HostModels {
  readonly [hostModels]: true;
}
export interface HostToolContext {
  readonly conversationId: number;
  readonly taskId: number;
  readonly signal: AbortSignal;
}
export interface HostToolResult {
  content: { type: "text"; text: string }[];
  control?: { terminate: true };
}
export interface HostTool<Schema extends TSchema = TSchema> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Schema;
  readonly replay: "safe";
  execute(
    args: Static<Schema>,
    context: HostToolContext,
  ): Promise<HostToolResult>;
}
export interface HostRoleSelection extends DefinitionModel {
  thinkingLevel: DefinitionThinkingLevel;
}
export interface HostOptions<State extends object> {
  databasePath?: string;
  definition: DefinitionBundle;
  runtimeId: string;
  scope: RuntimeScope;
  models: HostModels;
  roles: Record<string, HostRoleSelection>;
  tools: readonly HostTool[];
  state: { kind: string; initial: () => State };
  execution?: { directory: string; shellEnv: NodeJS.ProcessEnv };
  summaryPrompt?: () => Promise<string>;
  onReport?: () => void;
}
export interface HostRoleChange {
  roleId?: string;
  model?: DefinitionModel;
  thinkingLevel?: DefinitionThinkingLevel;
  instructions?: string;
}
export interface HostTransaction<State extends object> {
  state(): Promise<State>;
  create(change: HostRoleChange & { roleId: string }): Promise<number>;
  configure(id: number, change: HostRoleChange): Promise<void>;
}
export interface HostRunInput {
  content: string;
  requestId: string;
  instructions?: string;
  timeoutMs: number;
}
export interface HostRunResult {
  status: string;
  detail?: string;
  text: string;
}
export interface HostPendingSubmission {
  conversationId: number;
  requestId?: string;
  status: "queued" | "placed";
}
export interface Host<State extends object> {
  readonly rootId: number;
  resume(): Promise<void>;
  stageAbort(conversationIds: readonly number[]): Promise<void>;
  pendingSubmissions(): Promise<HostPendingSubmission[]>;
  snapshot(): Promise<State>;
  transact<T>(action: (tx: HostTransaction<State>) => Promise<T>): Promise<T>;
  configure(id: number, change: { instructions: string }): Promise<void>;
  run(id: number, input: HostRunInput): Promise<HostRunResult>;
  abort(id: number): Promise<void>;
  cleanup(id: number): Promise<void>;
  close(): Promise<void>;
}
