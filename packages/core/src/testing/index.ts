import assert from "node:assert/strict";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
  type RegisterFauxProviderOptions,
} from "@earendil-works/pi-ai/providers/faux";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  AssistantEntry,
  type ConversationId,
  UserEntry,
} from "@earendil-works/pi-durable";
import {
  getHostInternals,
  unwrapModels,
  wrapModels,
} from "../host/internal.js";
import type { HostModels } from "../host/types.js";

export type ModelResponse = FauxResponseStep;

export function assistantMessage(
  ...args: Parameters<typeof fauxAssistantMessage>
) {
  return fauxAssistantMessage(...args);
}

export function toolCall(...args: Parameters<typeof fauxToolCall>) {
  return fauxToolCall(...args);
}

export function thinking(value: string) {
  return fauxThinking(value);
}

export function contextTokens(
  context: Parameters<typeof estimateContextTokens>[0],
) {
  return estimateContextTokens(context).tokens;
}

export function createModelFixture(options: RegisterFauxProviderOptions = {}) {
  const provider = fauxProvider(options);
  const models = createModels();
  models.setProvider(provider.provider);
  return {
    models: wrapModels(models),
    fake: {
      state: provider.state,
      getModel: provider.getModel,
      setResponses: provider.setResponses,
      appendResponses: provider.appendResponses,
    },
  };
}

export function inspectModels(handle: HostModels) {
  const models = unwrapModels(handle);
  return {
    getModels: () => models.getModels(),
    getModel: (provider: string, id: string) => models.getModel(provider, id),
    hasAuth: async (provider: string) =>
      Boolean(await models.getAuth(provider)),
  };
}

export function testHost(host: object) {
  const { runtime, tools, context } = getHostInternals(host);
  async function conversation(id: number) {
    const value = await runtime.harness.conversation(
      id as ConversationId,
      context,
    );
    assert(value, "Missing conversation");
    return value;
  }
  return {
    async agent(id: number) {
      const agent = await (await conversation(id)).agent(context);
      return {
        instructions: agent.instructions,
        thinkingLevel: agent.thinkingLevel,
        tools: agent.tools.map(({ name }) => ({ name })),
      };
    },
    async appendHistory(
      id: number,
      messages: readonly (AssistantMessage | UserMessage)[],
    ) {
      return runtime.harness.commit(async (tx) => {
        const ids: number[] = [];
        for (const message of messages) {
          const entry =
            message.role === "user"
              ? await tx.appendEntry(UserEntry, id as ConversationId, {
                  model: [message],
                })
              : await tx.appendEntry(AssistantEntry, id as ConversationId, {
                  model: [message],
                });
          ids.push(entry.id);
        }
        return ids;
      }, context);
    },
    async context(id: number) {
      const value = await (await conversation(id)).context(context);
      return { head: value.head };
    },
    async entries(id: number) {
      const page = await (await conversation(id)).entries(
        {},
        100,
        undefined,
        context,
      );
      return { items: page.items.map(({ id, kind }) => ({ id, kind })) };
    },
    async tool(
      name: string,
      args: unknown,
      execution: {
        conversationId: number;
        taskId: number;
        signal?: AbortSignal;
      },
    ) {
      const tool = tools.find((tool) => tool.name === name);
      assert(tool, "Unknown host tool");
      return tool.execute(args, {
        conversationId: execution.conversationId,
        taskId: execution.taskId,
        signal: execution.signal ?? new AbortController().signal,
      });
    },
  };
}
