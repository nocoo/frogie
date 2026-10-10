import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { wrapModels } from "./internal.js";
import type { HostModels } from "./types.js";

export interface HostProviderConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  models: readonly {
    id: string;
    contextWindow: number;
    maxTokens: number;
    reasoning?: boolean;
  }[];
}
export function configuredModels(
  providers: readonly HostProviderConfig[],
): HostModels {
  const models = createModels();
  for (const provider of providers) {
    const url = new URL(provider.baseUrl);
    if (
      !provider.id.trim() ||
      !provider.apiKey.trim() ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      )
    )
      throw new Error("Invalid host provider configuration");
    if (
      provider.models.some(
        (model) =>
          !model.id.trim() ||
          !Number.isSafeInteger(model.contextWindow) ||
          !Number.isSafeInteger(model.maxTokens) ||
          model.maxTokens <= 0 ||
          model.maxTokens > model.contextWindow,
      )
    )
      throw new Error("Invalid host model configuration");
    models.setProvider(
      createProvider({
        id: provider.id,
        baseUrl: provider.baseUrl,
        models: provider.models.map((model) => ({
          id: model.id,
          name: model.id,
          provider: provider.id,
          api: "openai-completions",
          baseUrl: provider.baseUrl,
          reasoning: model.reasoning ?? true,
          input: ["text"],
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })),
        api: openAICompletionsApi(),
        auth: {
          apiKey: {
            name: provider.id,
            resolve: async () => ({ auth: { apiKey: provider.apiKey } }),
          },
        },
      }),
    );
  }
  return wrapModels(models);
}
