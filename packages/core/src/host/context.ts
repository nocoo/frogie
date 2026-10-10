import type { AssistantMessage, Models } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { DEFAULT_COMPACTION_POLICY } from "@earendil-works/pi-durable";

export const CONTEXT_BLOCKED = "frogie_context_compaction_required";
export function contextModels(
  models: Models,
  summaryPrompt?: () => Promise<string>,
): Models {
  const completeSimple: Models["completeSimple"] = async (
    model,
    context,
    options,
  ) => {
    if (!summaryPrompt)
      return models.completeSimple(model, context, {
        ...options,
        reasoning: "low",
      });
    const source = context.messages.find(
      (message) => message.role === "user",
    )?.content;
    const text =
      typeof source === "string"
        ? source
        : source?.find((part) => part.type === "text")?.text;
    const end = text?.lastIndexOf("\n</conversation>") ?? -1;
    if (end < 0) throw new Error("Invalid compaction source; history retained");
    const focus = text?.indexOf("\n\nAdditional focus:", end) ?? -1;
    return models.completeSimple(
      model,
      {
        messages: [
          {
            role: "system",
            content: await summaryPrompt(),
            timestamp: Date.now(),
          },
          {
            role: "user",
            content: `${text?.slice(0, end + "\n</conversation>".length)}${focus < 0 ? "" : text?.slice(focus)}`,
            timestamp: Date.now(),
          },
        ],
      },
      { ...options, reasoning: "low" },
    );
  };
  const streamSimple: Models["streamSimple"] = (model, context, options) => {
    const tokens = estimateContextTokens(normalizeContext(context)).tokens;
    const reserve = Math.max(
      DEFAULT_COMPACTION_POLICY.reserveTokens,
      model.maxTokens + 4096,
    );
    if (model.contextWindow > 0 && tokens > model.contextWindow - reserve) {
      const error: AssistantMessage = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        stopReason: "error",
        errorMessage: CONTEXT_BLOCKED,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "error", reason: "error", error });
      stream.end();
      return stream;
    }
    return models.streamSimple(model, context, options);
  };
  return new Proxy(models, {
    get(target, key) {
      if (key === "completeSimple") return completeSimple;
      if (key === "streamSimple") return streamSimple;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
