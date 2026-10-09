import { randomUUID } from "node:crypto";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createModels,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { loadDefinition } from "@frogie/core/definitions";
import { openRuntime } from "@frogie/core/runtime";
import { createDefinitionWorkspace } from "./definitions.js";
import { startLocalServer } from "./localServer.js";

export async function startPreview(options: {
  directory: string;
  port?: number;
}): Promise<{ url: string; origin: string; close(): Promise<void> }> {
  await mkdir(options.directory);
  const squads = join(options.directory, "squads");
  await cp(
    fileURLToPath(
      new URL("../../../../tests/fixtures/minimal-squad", import.meta.url),
    ),
    join(squads, "minimal-squad"),
    { recursive: true },
  );
  const definition = loadDefinition(join(squads, "minimal-squad"));
  const instanceId = randomUUID();
  const scope = {
    environmentId: "e2e",
    squadId: definition.squadId,
    harnessId: instanceId,
  };
  const faux = fauxProvider({
    provider: "fixture",
    models: [{ id: "test", reasoning: true }],
    tokensPerSecond: 100_000,
  });
  const reply: FauxResponseFactory = (context) => {
    faux.appendResponses([reply]);
    const input = context.messages
      .filter((message) => message.role === "user")
      .slice(-1)
      .map((message) => message.content);
    return fauxAssistantMessage(
      `本地测试模式：Pi Durable 已收到输入并完成本次提交。这是无模型费用的测试回复。\n\n${JSON.stringify(input)}`,
    );
  };
  faux.setResponses([reply]);
  const models = createModels();
  models.setProvider(faux.provider);
  const runtime = await openRuntime(
    {
      runtimeId: instanceId,
      definition,
      binding: {
        projectId: definition.projectId,
        scope,
        definition: { contentHash: definition.contentHash },
        environment: {
          model: { provider: "fixture", modelId: "test" },
          thinkingLevel: "low",
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
      instanceId,
      scope,
      service: runtime.service,
      context: BACKGROUND_CONTEXT,
      definitions: createDefinitionWorkspace(squads),
      publicDirectory: fileURLToPath(new URL("../../dist", import.meta.url)),
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
