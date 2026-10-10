import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type Static, Type } from "typebox";
import Value from "typebox/value";
import { startDaemon } from "../daemon.js";
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

export interface DaemonServerOptions {
  directory: string;
  definitionsDirectory?: string;
  port?: number;
  publicOrigin?: string;
}

export async function startDaemonServer(
  options: DaemonServerOptions & {
    mode: "local" | "e2e";
    model?: LocalModelConfig;
  },
): Promise<{ url: string; origin: string; close(): Promise<void> }> {
  const definitionsDirectory =
    options.definitionsDirectory ?? resolve("squads");
  const daemon = await startDaemon({
    directory: options.directory,
    definitionsDirectory,
    mode: options.mode,
    ...(options.model === undefined
      ? {}
      : { model: validateModel(options.model) }),
  });
  try {
    const server = await startLocalServer({
      directory: daemon,
      context: BACKGROUND_CONTEXT,
      definitions: createDefinitionWorkspace(definitionsDirectory),
      publicDirectory: fileURLToPath(
        new URL("../../../dashboard/dist", import.meta.url),
      ),
      publicOrigin: options.publicOrigin ?? "https://frogie.dev.hexly.ai",
      port: options.port ?? 7033,
    });
    let closing: Promise<void> | undefined;
    return {
      url: server.url,
      origin: server.origin,
      close() {
        closing ??= server.close().finally(() => daemon.close());
        return closing;
      },
    };
  } catch (error) {
    await daemon.close();
    throw error;
  }
}

export function startLocal(
  options: DaemonServerOptions & { model: LocalModelConfig },
) {
  return startDaemonServer({ ...options, mode: "local" });
}
