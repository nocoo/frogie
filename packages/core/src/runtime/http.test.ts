import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, it } from "vitest";
import { startLocalServer } from "../../../../apps/daemon/src/server/localServer.js";
import { localDirectory } from "../../../../tests/fixtures/local-directory.js";
import { loadDefinition } from "../definitions/index.js";
import type { RuntimeScope, SubmitOutput } from "../protocol/index.js";
import { openRuntime } from "./index.js";

it("submits through authenticated HTTP and reopens actual SQLite history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "frogie-http-pi-"));
  const definition = loadDefinition(
    fileURLToPath(
      new URL("../../../../tests/fixtures/minimal-squad", import.meta.url),
    ),
  );
  const scope: RuntimeScope = {
    projectId: definition.projectId,
    environmentId: "http-test",
    squadId: definition.squadId,
    harnessId: "http-harness",
  };
  const provider = fauxProvider({
    provider: "fixture",
    models: [{ id: "test", reasoning: true }],
    tokensPerSecond: 1_000_000,
  });
  provider.setResponses([fauxAssistantMessage("Persisted HTTP answer.")]);
  const models = createModels();
  models.setProvider(provider.provider);
  const options = {
    runtimeId: "http-runtime",
    definition,
    binding: {
      projectId: definition.projectId,
      scope,
      definition: { contentHash: definition.contentHash },
      environment: {
        model: { provider: "fixture", modelId: "test" },
        thinkingLevel: "low" as const,
      },
    },
    models,
    registry: createRegistry(),
    authorization: async () => true,
  };
  const runtime = await openRuntime(
    {
      ...options,
      storage: await openNodeSqliteStorage(join(directory, "session.sqlite")),
    },
    BACKGROUND_CONTEXT,
  );
  let server: Awaited<ReturnType<typeof startLocalServer>> | undefined;
  try {
    server = await startLocalServer({
      directory: localDirectory("http-instance", scope, runtime.service),
      context: BACKGROUND_CONTEXT,
    });
    const token = new URLSearchParams(new URL(server.url).hash.slice(1)).get(
      "token",
    );
    const exchange = await fetch(`${server.origin}/__local/auth/exchange`, {
      method: "POST",
      headers: { Origin: server.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(exchange.status).toBe(200);
    const { csrf } = (await exchange.json()) as { csrf: string };
    const cookie = exchange.headers.getSetCookie()[0]?.split(";")[0];
    if (!cookie) throw new Error("No session cookie");
    const submit = await fetch(
      `${server.origin}/__local/instances/http-instance/operations/submit`,
      {
        method: "POST",
        headers: {
          Origin: server.origin,
          "Content-Type": "application/json",
          Cookie: cookie,
          "X-Frogie-CSRF": csrf,
        },
        body: JSON.stringify({
          scope,
          input: {
            conversationId: runtime.root.id,
            submission: {
              type: "input",
              content: "Persist this exchange",
              requestId: "http-once",
            },
          },
        }),
      },
    );
    expect(submit.status).toBe(200);
    const accepted = (await submit.json()) as {
      scope: RuntimeScope;
      value: SubmitOutput;
    };
    expect(accepted.scope).toEqual(scope);
    const submission = await runtime.harness.submission(
      accepted.value,
      BACKGROUND_CONTEXT,
    );
    expect((await submission?.wait(BACKGROUND_CONTEXT))?.status).toBe("done");
    await server.close();
    expect(
      (await runtime.root.viewState(BACKGROUND_CONTEXT)).value.entries.length,
    ).toBeGreaterThan(1);
    await runtime.close(BACKGROUND_CONTEXT);
    const resumed = await openRuntime(
      {
        ...options,
        storage: await openNodeSqliteStorage(join(directory, "session.sqlite")),
      },
      BACKGROUND_CONTEXT,
    );
    try {
      expect(resumed.root.id).toBe(runtime.root.id);
      expect(
        JSON.stringify(
          (await resumed.root.viewState(BACKGROUND_CONTEXT)).value.entries,
        ),
      ).toContain("Persisted HTTP answer.");
      expect(provider.state.callCount).toBe(1);
    } finally {
      await resumed.close(BACKGROUND_CONTEXT);
    }
  } finally {
    await server?.close();
    await runtime.close(BACKGROUND_CONTEXT);
    await rm(directory, { recursive: true, force: true });
  }
});
