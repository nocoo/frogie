import type { RuntimeError } from "@frogie/core/protocol";
import type { DashboardApi } from "../viewmodels/DashboardViewModel.js";
import type { LocalRuntimeClient } from "./localClient.js";

export function createLocalDashboardApi(
  client: LocalRuntimeClient,
  onError: (error: RuntimeError) => void,
): DashboardApi {
  return {
    listSquads: () => client.listSquads(),
    async loadFiles(scope) {
      return client.loadDefinition(scope.squadId);
    },
    async saveFile(scope, draft, requestId) {
      return client.saveDefinition(scope.squadId, draft, requestId);
    },
    async listConversations(scope) {
      return (await client.listConversations({}, scope)).map(
        ({ conversation }) => conversation.id,
      );
    },
    async createConversation(call) {
      return client.createConversation(call.input, call.scope);
    },
    async submit(call) {
      return client.submit(call.input, call.scope);
    },
    async getSubmission(scope, submissionId) {
      return client.getSubmission({ submissionId }, scope);
    },
    observe(scope, conversationId, listener) {
      return client.observe({ conversationId }, listener, onError, scope);
    },
    async cancel(scope, conversationId, submissionId) {
      await client.cancel(
        {
          conversationId,
          ...(submissionId === undefined ? {} : { submissionId }),
        },
        scope,
      );
    },
    async compact(scope, conversationId) {
      await client.compact({ conversationId }, scope);
    },
  };
}
