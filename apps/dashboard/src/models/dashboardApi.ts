import type { RuntimeError, RuntimeScope } from "@frogie/core/protocol";
import type { DashboardApi } from "../viewmodels/DashboardViewModel.js";
import type { LocalRuntimeClient } from "./localClient.js";

export function createLocalDashboardApi(
  client: LocalRuntimeClient,
  onError: (error: RuntimeError) => void,
): DashboardApi {
  const checkScope = (scope: RuntimeScope): void => {
    const bound = client.context.scope;
    if (
      scope.environmentId !== bound.environmentId ||
      scope.squadId !== bound.squadId ||
      scope.harnessId !== bound.harnessId
    )
      throw Object.assign(new Error("Runtime scope mismatch"), {
        code: "binding_mismatch",
        retryable: false,
        scope: bound,
      });
  };
  return {
    listSquads: () => client.listSquads(),
    async loadFiles(scope) {
      checkScope(scope);
      return client.loadDefinition(scope.squadId);
    },
    async saveFile(scope, draft, requestId) {
      checkScope(scope);
      return client.saveDefinition(scope.squadId, draft, requestId);
    },
    async listConversations(scope) {
      checkScope(scope);
      return (await client.listConversations({})).map(
        ({ conversation }) => conversation.id,
      );
    },
    async createConversation(call) {
      checkScope(call.scope);
      return client.createConversation(call.input);
    },
    async submit(call) {
      checkScope(call.scope);
      return client.submit(call.input);
    },
    async getSubmission(scope, submissionId) {
      checkScope(scope);
      return client.getSubmission({ submissionId });
    },
    observe(scope, conversationId, listener) {
      checkScope(scope);
      return client.observe({ conversationId }, listener, onError);
    },
    async cancel(scope, conversationId, submissionId) {
      checkScope(scope);
      await client.cancel({
        conversationId,
        ...(submissionId === undefined ? {} : { submissionId }),
      });
    },
    async compact(scope, conversationId) {
      checkScope(scope);
      await client.compact({ conversationId });
    },
  };
}
