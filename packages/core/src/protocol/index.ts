import type { Context } from "@earendil-works/chord";
import type {
  Conversation,
  ConversationId,
  ConversationRecord,
  ConversationView,
  ConversationWatch,
  Harness,
  ModelRef,
  SubmissionDraft,
  SubmissionId,
  SubmissionRecord,
} from "@earendil-works/pi-durable";
import type {
  DefinitionBundle,
  DefinitionDefaults,
} from "../definitions/types.js";

export interface RuntimeScope {
  readonly projectId: string;
  readonly environmentId: string;
  readonly squadId: string;
  readonly harnessId: string;
}

export interface ProjectBinding {
  readonly projectId: string;
  readonly scope: RuntimeScope;
  readonly definition: { readonly contentHash: string };
  readonly environment?: DefinitionDefaults;
  readonly authorizationScope?: readonly string[];
}

export interface ConversationBinding {
  readonly conversationId: ConversationId;
  readonly roleId: string;
  readonly definitionHash: string;
  readonly configHash: string;
  readonly workflowId?: string;
  readonly title: string;
}

export interface BindingDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly line?: number;
  readonly field?: string;
  readonly severity: "error" | "warning";
}

export interface RuntimeCaller {
  readonly id: string;
}

export interface RuntimeCall<TInput> {
  readonly scope: RuntimeScope;
  readonly input: TInput;
  readonly caller: RuntimeCaller;
}

export type RuntimeAuthorizationCall =
  | (RuntimeCall<CreateConversationInput> & {
      readonly operation: "createConversation";
    })
  | (RuntimeCall<SubmitInput> & { readonly operation: "submit" })
  | (RuntimeCall<GetSubmissionInput> & { readonly operation: "getSubmission" })
  | (RuntimeCall<DescribeInput> & { readonly operation: "describe" })
  | (RuntimeCall<ListConversationsInput> & {
      readonly operation: "listConversations";
    })
  | (RuntimeCall<ObserveConversationInput> & {
      readonly operation: "observeConversation";
    })
  | (RuntimeCall<CancelInput> & { readonly operation: "cancel" })
  | (RuntimeCall<CompactInput> & { readonly operation: "compact" });

export interface RuntimeDescription {
  readonly protocolVersion: 1;
  readonly runtimeId: string;
  readonly scope: RuntimeScope;
  readonly bindingHash: string;
  readonly piVersion: string;
  readonly hostVersion: string;
  readonly models: readonly ModelRef[];
  readonly tools: readonly string[];
  readonly extensions: readonly string[];
  readonly operations: readonly string[];
}

export interface RuntimeError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly scope?: RuntimeScope;
  readonly objectId?: string;
  readonly field?: string;
}

export interface ObservationFrame {
  readonly type: "snapshot" | "update";
  readonly scope: RuntimeScope;
  readonly conversationId: ConversationId;
  readonly value: ConversationView;
}

export interface CreateConversationInput {
  readonly roleId: string;
  readonly workflowId?: string;
}

export interface CreateConversationOutput {
  readonly conversationId: ConversationId;
  readonly binding: ConversationBinding;
}

export interface SubmitInput {
  readonly conversationId: ConversationId;
  readonly submission: SubmissionDraft;
}

export type SubmitOutput = SubmissionId;
export type GetSubmissionInput = { readonly submissionId: SubmissionId };
export type GetSubmissionOutput = SubmissionRecord | undefined;

export interface RuntimeConversationRecord {
  readonly conversation: ConversationRecord;
  readonly binding: ConversationBinding;
}

export type DescribeInput = Record<string, never>;
export type ListConversationsInput = Record<string, never>;
export interface ObserveConversationInput {
  readonly conversationId: ConversationId;
}
export interface CancelInput {
  readonly conversationId: ConversationId;
  readonly submissionId?: SubmissionId;
}
export interface CompactInput {
  readonly conversationId: ConversationId;
  readonly instructions?: string;
}
export type CancelOutput =
  | Awaited<ReturnType<Conversation["abort"]>>
  | Awaited<ReturnType<Harness["abortSubmission"]>>;
export type CompactOutput = Awaited<ReturnType<Conversation["compact"]>>;

export interface RuntimeService {
  createConversation(
    call: RuntimeCall<CreateConversationInput>,
    context: Context,
  ): Promise<CreateConversationOutput>;
  submit(
    call: RuntimeCall<SubmitInput>,
    context: Context,
  ): Promise<SubmitOutput>;
  getSubmission(
    call: RuntimeCall<GetSubmissionInput>,
    context: Context,
  ): Promise<GetSubmissionOutput>;
  describe(
    call: RuntimeCall<DescribeInput>,
    context: Context,
  ): Promise<RuntimeDescription>;
  listConversations(
    call: RuntimeCall<ListConversationsInput>,
    context: Context,
  ): Promise<readonly RuntimeConversationRecord[]>;
  observeConversation(
    call: RuntimeCall<ObserveConversationInput>,
    context: Context,
  ): Promise<ConversationWatch>;
  cancel(
    call: RuntimeCall<CancelInput>,
    context: Context,
  ): Promise<CancelOutput>;
  compact(
    call: RuntimeCall<CompactInput>,
    context: Context,
  ): Promise<CompactOutput>;
}

export type RuntimeDefinition = DefinitionBundle;

export type * from "./daemon.js";
