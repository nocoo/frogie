import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { loadDefinition } from "@frogie/core/definitions";
import { openRuntime } from "@frogie/core/runtime";
import { type Static, Type } from "typebox";
import Value from "typebox/value";
import { createDefinitionWorkspace } from "./definitions.js";
import { startLocalServer } from "./localServer.js";

const modelSchema = Type.Object(
  {
    baseUrl: Type.String({ minLength: 1 }),
    apiKey: Type.String({ pattern: "\\S" }),
    modelId: Type.String({ pattern: "\\S" }),
    contextWindow: Type.Integer({ minimum: 1 }),
    maxTokens: Type.Integer({ minimum: 1 }),
    thinkingLevel: Type.Union([
      Type.Literal("off"),
      Type.Literal("minimal"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Literal("xhigh"),
    ]),
  },
  { additionalProperties: false },
);

export type LocalModelConfig = Static<typeof modelSchema>;

function validateModel(value: unknown): LocalModelConfig {
  try {
    if (!Value.Check(modelSchema, value)) throw new Error();
    const url = new URL(value.baseUrl);
    if (
      value.maxTokens > value.contextWindow ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
    )
      throw new Error();
    return value;
  } catch {
    throw new Error("本地模型配置无效，请检查地址、模型、密钥与上下文限制。");
  }
}

export async function loadLocalModel(path: string): Promise<LocalModelConfig> {
  try {
    return validateModel(JSON.parse(await readFile(path, "utf8")));
  } catch {
    throw new Error(
      "无法加载本地模型配置，请检查 FROGIE_MODEL_CONFIG 指定的 JSON 文件。",
    );
  }
}

export async function startLocal(options: {
  directory: string;
  model: LocalModelConfig;
  port?: number;
}): Promise<{ url: string; origin: string; close(): Promise<void> }> {
  const config = validateModel(options.model);
  await mkdir(options.directory, { recursive: true });
  const files = await readdir(options.directory);
  const metadata = join(options.directory, "runtime.json");
  const squads = join(options.directory, "squads");
  let runtimeId: string;
  if (files.length === 0) {
    runtimeId = randomUUID();
    await writeFile(metadata, JSON.stringify({ runtimeId }), {
      flag: "wx",
      mode: 0o600,
    });
    await cp(
      fileURLToPath(
        new URL("../../../../tests/fixtures/minimal-squad", import.meta.url),
      ),
      join(squads, "minimal-squad"),
      { recursive: true, force: false, errorOnExist: true },
    );
  } else {
    const stored: unknown = JSON.parse(await readFile(metadata, "utf8"));
    if (
      !Value.Check(
        Type.Object(
          {
            runtimeId: Type.String({
              pattern:
                "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            }),
          },
          { additionalProperties: false },
        ),
        stored,
      )
    )
      throw new Error("本地运行目录的身份信息无效。");
    runtimeId = stored.runtimeId;
  }
  const definition = loadDefinition(join(squads, "minimal-squad"));
  const scope = {
    projectId: definition.projectId,
    environmentId: "local",
    squadId: definition.squadId,
    harnessId: runtimeId,
  };
  const models = createModels();
  models.setProvider(
    createProvider({
      id: "local-model",
      baseUrl: config.baseUrl,
      models: [
        {
          id: config.modelId,
          name: config.modelId,
          provider: "local-model",
          api: "openai-completions",
          baseUrl: config.baseUrl,
          reasoning: true,
          input: ["text"],
          contextWindow: config.contextWindow,
          maxTokens: config.maxTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      api: openAICompletionsApi(),
      auth: {
        apiKey: {
          name: "local-model",
          resolve: async () => ({ auth: { apiKey: config.apiKey } }),
        },
      },
    }),
  );
  const runtime = await openRuntime(
    {
      runtimeId,
      definition,
      binding: {
        projectId: definition.projectId,
        scope,
        definition: { contentHash: definition.contentHash },
        environment: {
          model: { provider: "local-model", modelId: config.modelId },
          thinkingLevel: config.thinkingLevel,
        },
      },
      models,
      registry: createRegistry(),
      authorization: async () => true,
      storage: await openNodeSqliteStorage(
        join(options.directory, "session.sqlite"),
      ),
    },
    BACKGROUND_CONTEXT,
  );
  try {
    const server = await startLocalServer({
      instanceId: runtimeId,
      scope,
      service: runtime.service,
      context: BACKGROUND_CONTEXT,
      definitions: createDefinitionWorkspace(squads),
      publicDirectory: fileURLToPath(
        new URL("../../../dashboard/dist", import.meta.url),
      ),
      publicOrigin: "https://frogie.dev.hexly.ai",
      port: options.port ?? 7033,
    });
    let closing: Promise<void> | undefined;
    return {
      url: server.url,
      origin: server.origin,
      close: () => {
        closing ??= server
          .close()
          .finally(() => runtime.close(BACKGROUND_CONTEXT));
        return closing;
      },
    };
  } catch (error) {
    await runtime.close(BACKGROUND_CONTEXT);
    throw error;
  }
}
