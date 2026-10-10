import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { expect, it, vi } from "vitest";
import { CONTEXT_BLOCKED, contextModels } from "./context.js";

const summaryPrompt =
  "Preserve verified facts, pending work, receipts, and owner-only approvals.";

it("replaces summary instructions while preserving source, model, budget and cancellation", async () => {
  const fake = fauxProvider({ models: [{ id: "coordinator" }] });
  const models = createModels();
  models.setProvider(fake.provider);
  const complete = vi.spyOn(models, "completeSimple");
  const stream = vi.spyOn(models, "streamSimple");
  const guarded = contextModels(models, async () => summaryPrompt);
  const model = fake.getModel();
  const context = {
    messages: [
      {
        role: "user" as const,
        content:
          "<conversation>\nHistory\n</conversation>\nSDK instructions\n\nAdditional focus: keep evidence",
        timestamp: 1,
      },
    ],
  };
  const options = {
    reasoning: "high" as const,
    maxTokens: 8192,
    signal: new AbortController().signal,
  };
  fake.setResponses([
    fauxAssistantMessage("Summary"),
    fauxAssistantMessage("Answer"),
  ]);
  expect(
    (await guarded.completeSimple(model, context, options)).stopReason,
  ).toBe("stop");
  expect(complete).toHaveBeenCalledWith(
    model,
    {
      messages: [
        expect.objectContaining({ role: "system", content: summaryPrompt }),
        expect.objectContaining({
          role: "user",
          content:
            "<conversation>\nHistory\n</conversation>\n\nAdditional focus: keep evidence",
        }),
      ],
    },
    { ...options, reasoning: "low" },
  );
  await expect(guarded.completeSimple(model, { messages: [] })).rejects.toThrow(
    "Invalid compaction source",
  );
  expect(
    (await guarded.streamSimple(model, context, options).result()).stopReason,
  ).toBe("stop");
  expect(stream).toHaveBeenLastCalledWith(model, context, options);
  expect(guarded.getModel(model.provider, model.id)).toEqual(model);
  expect(Reflect.get(guarded, "missing")).toBeUndefined();
});

it("blocks the recorded oversized context locally without a provider call", async () => {
  const fake = fauxProvider({
    models: [{ id: "coordinator", contextWindow: 128000, maxTokens: 8192 }],
  });
  const models = createModels();
  models.setProvider(fake.provider);
  const guarded = contextModels(models, async () => summaryPrompt);
  const previous = fauxAssistantMessage("Read the production", {
    timestamp: 100,
  });
  previous.usage = {
    ...previous.usage,
    input: 122681,
    output: 42,
    totalTokens: 122723,
  };
  const context = {
    messages: [
      previous,
      { role: "user" as const, content: "x".repeat(1185 * 4), timestamp: 101 },
    ],
  };
  expect(estimateContextTokens(context.messages).tokens).toBe(124078);
  const events = guarded.streamSimple(fake.getModel(), context);
  const received = [];
  for await (const event of events) received.push(event);
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ type: "error", reason: "error" });
  expect(await events.result()).toMatchObject({
    stopReason: "error",
    errorMessage: CONTEXT_BLOCKED,
    usage: { totalTokens: 0 },
  });
  expect(fake.state.callCount).toBe(0);
});

it("uses low reasoning for default and block-form summaries", async () => {
  const fake = fauxProvider();
  const models = createModels();
  models.setProvider(fake.provider);
  const complete = vi.spyOn(models, "completeSimple");
  fake.setResponses([
    fauxAssistantMessage("Default"),
    fauxAssistantMessage("Custom"),
  ]);
  const context = {
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: "<conversation>\nHistory\n</conversation>\nSDK instructions",
          },
        ],
        timestamp: 1,
      },
    ],
  };
  await contextModels(models).completeSimple(fake.getModel(), context);
  expect(complete).toHaveBeenLastCalledWith(fake.getModel(), context, {
    reasoning: "low",
  });
  await contextModels(models, async () => summaryPrompt).completeSimple(
    fake.getModel(),
    context,
  );
  expect(complete).toHaveBeenLastCalledWith(
    fake.getModel(),
    {
      messages: [
        expect.objectContaining({ role: "system", content: summaryPrompt }),
        expect.objectContaining({
          role: "user",
          content: "<conversation>\nHistory\n</conversation>",
        }),
      ],
    },
    { reasoning: "low" },
  );
});

it.each([123908, 983616, 983617])(
  "applies the configured 1M window to a %i-token context",
  async (tokens) => {
    const fake = fauxProvider({
      models: [
        { id: "coordinator", contextWindow: 1_000_000, maxTokens: 8192 },
      ],
    });
    const models = createModels();
    models.setProvider(fake.provider);
    fake.setResponses([fauxAssistantMessage("Allowed")]);
    const previous = fauxAssistantMessage("Previous turn");
    previous.usage = { ...previous.usage, input: tokens, totalTokens: tokens };
    const result = await contextModels(models, async () => summaryPrompt)
      .streamSimple(fake.getModel(), { messages: [previous] })
      .result();
    const allowed = tokens <= 1_000_000 - 16384;
    expect(result.stopReason).toBe(allowed ? "stop" : "error");
    expect(fake.state.callCount).toBe(allowed ? 1 : 0);
  },
);

it.each([0, 128000])(
  "permits safe requests with a %i-token window and counts system context",
  async (window) => {
    const fake = fauxProvider({
      models: [{ id: "coordinator", contextWindow: window, maxTokens: 8192 }],
    });
    const models = createModels();
    models.setProvider(fake.provider);
    const guarded = contextModels(models, async () => summaryPrompt);
    fake.setResponses([fauxAssistantMessage("Allowed")]);
    expect(
      (await guarded.streamSimple(fake.getModel(), { messages: [] }).result())
        .stopReason,
    ).toBe("stop");
    const oversized = { messages: [], systemPrompt: "x".repeat(128000 * 4) };
    if (window) {
      expect(
        (await guarded.streamSimple(fake.getModel(), oversized).result())
          .errorMessage,
      ).toBe(CONTEXT_BLOCKED);
      expect(fake.state.callCount).toBe(1);
    }
  },
);
