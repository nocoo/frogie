export interface RuntimeBudgetLimits {
  readonly modelRequests: number;
  readonly toolEntries: number;
  readonly modelConcurrency: number;
  readonly deadlineAt?: number;
}

export interface RuntimeBudgetSnapshot {
  readonly limits: RuntimeBudgetLimits;
  readonly consumed: {
    readonly modelRequests: number;
    readonly toolEntries: number;
  };
  readonly stopped?: {
    readonly reason: "model_requests" | "tool_entries" | "deadline";
    readonly at: number;
  };
}

export interface ExtendBudgetInput {
  readonly requestId: string;
  readonly modelRequests?: number;
  readonly toolEntries?: number;
  readonly deadlineAt?: number;
}
