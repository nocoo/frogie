import { describe, expect, it } from "vitest";
import { inspectModels } from "../testing/index.js";
import { configuredModels, type HostProviderConfig } from "./models.js";

const provider: HostProviderConfig = {
  id: "gateway",
  baseUrl: "https://models.example.test/v1",
  apiKey: "test-only-not-a-real-key",
  models: [{ id: "agent", contextWindow: 100000, maxTokens: 8192 }],
};

describe("configuredModels", () => {
  it("preserves declared capabilities, defaults reasoning and resolves supplied auth without network", async () => {
    const handle = configuredModels([
      {
        ...provider,
        models: [
          ...provider.models,
          {
            id: "plain",
            contextWindow: 32000,
            maxTokens: 1000,
            reasoning: false,
          },
        ],
      },
    ]);
    const inspect = inspectModels(handle);
    expect(inspect.getModels()).toHaveLength(2);
    expect(inspect.getModel("gateway", "agent")).toMatchObject({
      reasoning: true,
      contextWindow: 100000,
      maxTokens: 8192,
    });
    expect(inspect.getModel("gateway", "plain")).toMatchObject({
      reasoning: false,
    });
    expect(await inspect.hasAuth("gateway")).toBe(true);
  });

  it.each([
    "http://127.0.0.1:8080/v1",
    "http://localhost:8080",
    "http://[::1]:8080",
  ])("permits local HTTP endpoint %s", (baseUrl) => {
    expect(
      inspectModels(configuredModels([{ ...provider, baseUrl }])).getModels(),
    ).toHaveLength(1);
  });

  it.each([
    "not-a-url",
    "http://external.example.test",
    "ftp://localhost",
    "https://user:pass@example.test",
    "https://example.test?key=secret",
    "https://example.test#fragment",
  ])("rejects unsafe endpoint %s", (baseUrl) => {
    expect(() => configuredModels([{ ...provider, baseUrl }])).toThrow();
  });

  it.each([{ id: " " }, { apiKey: " " }])(
    "rejects incomplete provider identity %j",
    (change) => {
      expect(() => configuredModels([{ ...provider, ...change }])).toThrow(
        /provider configuration/,
      );
    },
  );

  it.each([
    { id: " " },
    { contextWindow: NaN },
    { contextWindow: 100.5 },
    { maxTokens: Infinity },
    { maxTokens: 1.5 },
    { maxTokens: 0 },
    { maxTokens: -1 },
    { contextWindow: 20, maxTokens: 21 },
  ])("rejects invalid token limits or model identity %j", (change) => {
    expect(() =>
      configuredModels([
        {
          ...provider,
          models: [
            { id: "agent", contextWindow: 100000, maxTokens: 8192, ...change },
          ],
        },
      ]),
    ).toThrow(/model configuration/);
  });
});
