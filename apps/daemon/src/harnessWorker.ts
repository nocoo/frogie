import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import {
  createModels,
  createProvider,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  type ConversationWatch,
  createRegistry,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { DefinitionError, loadDefinition } from "@frogie/core/definitions";
import type {
  ProjectBinding,
  RuntimeCall,
  RuntimeError,
  RuntimeService,
} from "@frogie/core/protocol";
import {
  checkBinding,
  openRuntime,
  type RuntimeConfiguration,
  type RuntimeHandle,
} from "@frogie/core/runtime";
import { type ArtifactStore, createArtifactStore } from "./artifacts.js";
import type {
  HarnessConfiguration,
  WorkerMessage,
  WorkerRequest,
} from "./harnessProcess.js";
import { createLocalTools } from "./localTools.js";
import { checkScriptSandbox, createScriptRunner } from "./scriptRunner.js";

const context = BACKGROUND_CONTEXT;
export function workerFailure(error: unknown): RuntimeError {
  const value = error instanceof Error ? error : new Error(String(error));
  const code =
    error instanceof DefinitionError
      ? "invalid_definition"
      : "code" in value &&
          typeof value.code === "string" &&
          [
            "binding_mismatch",
            "capability_missing",
            "not_found",
            "forbidden",
            "invalid_request",
            "output_limit",
          ].includes(value.code)
        ? value.code
        : "runtime_unavailable";
  return {
    message:
      code === "invalid_definition"
        ? "Squad definition is invalid"
        : code === "capability_missing"
          ? "A required model, tool, or extension is unavailable"
          : code === "binding_mismatch"
            ? "Runtime binding does not match"
            : code === "not_found"
              ? "Requested runtime object was not found"
              : code === "forbidden"
                ? "Runtime operation is not authorized"
                : code === "invalid_request"
                  ? "Runtime request is invalid"
                  : code === "output_limit"
                    ? "Runtime response exceeds the output limit"
                    : "Harness operation failed",
    code,
    retryable: false,
  };
}

export async function openHarnessRuntime(
  config: HarnessConfiguration,
): Promise<RuntimeHandle> {
  const stored: ProjectBinding = JSON.parse(
    await readFile(join(config.directory, "binding.json"), "utf8"),
  );
  if (JSON.stringify(stored) !== JSON.stringify(config.binding))
    throw Object.assign(
      new Error("Stored binding does not match worker configuration"),
      { code: "binding_mismatch" },
    );
  const definitionDirectory = join(config.directory, "definition");
  const definition = loadDefinition(definitionDirectory);
  const models = createModels();
  if (config.mode === "e2e") {
    const faux = fauxProvider({
      provider: "fixture",
      models: [{ id: "test", reasoning: true }],
      tokensPerSecond: 100_000,
    });
    const reply: FauxResponseFactory = (transcript) => {
      faux.appendResponses([reply]);
      const input = transcript.messages
        .filter((message) => message.role === "user")
        .slice(-1)
        .map((message) => message.content);
      return fauxAssistantMessage(
        `Local Pi test reply: ${JSON.stringify(input)}`,
      );
    };
    faux.setResponses([reply]);
    models.setProvider(faux.provider);
  } else if (config.model) {
    const model = config.model;
    models.setProvider(
      createProvider({
        id: "local-model",
        baseUrl: model.baseUrl,
        models: [
          {
            id: model.modelId,
            name: model.modelId,
            provider: "local-model",
            api: "openai-completions",
            baseUrl: model.baseUrl,
            reasoning: true,
            input: ["text"],
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
        api: openAICompletionsApi(),
        auth: {
          apiKey: {
            name: "local-model",
            resolve: async () => ({ auth: { apiKey: model.apiKey } }),
          },
        },
      }),
    );
  }
  const registry = createRegistry();
  const runtime: RuntimeConfiguration = {
    runtimeId: config.binding.scope.harnessId,
    definition,
    binding: config.binding,
    models,
    registry,
  };
  let artifacts: ArtifactStore;
  let scripts: ReturnType<typeof createScriptRunner>;
  registry.install(
    createLocalTools({
      runtime,
      get artifacts() {
        return artifacts;
      },
      get scripts() {
        return scripts;
      },
    }),
  );
  const issue = checkBinding(definition, config.binding, runtime).find(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (issue)
    throw Object.assign(new Error(issue.message), { code: issue.code });
  const approvedScripts = (config.approvedScripts ?? []).filter((approval) =>
    definition.skills.some((skill) =>
      skill.scripts.some(
        (script) =>
          script.runtime === "node" &&
          script.replay === "safe" &&
          approval === `${definition.contentHash}:${skill.id}/${script.id}` &&
          definition.roles.some(
            (role) =>
              role.extensions.includes("frogie") &&
              role.tools.includes("run_script") &&
              role.skills.includes(skill.id) &&
              role.scripts.includes(`${skill.id}/${script.id}`),
          ),
      ),
    ),
  );
  if (approvedScripts.length) {
    try {
      await checkScriptSandbox(context);
    } catch {
      throw Object.assign(new Error("Local script sandbox is unavailable"), {
        code: "capability_missing",
      });
    }
  }
  artifacts = await createArtifactStore({
    directory: join(config.directory, "artifacts"),
    scope: config.binding.scope,
  });
  scripts = createScriptRunner({
    directory: join(config.directory, "receipts"),
    definitionDirectory,
    definition,
    scope: config.binding.scope,
    artifacts,
    approvedScripts,
  });
  return openRuntime(
    {
      ...runtime,
      storage: await openNodeSqliteStorage(
        join(config.directory, "session.sqlite"),
      ),
      authorization: async () => true,
    },
    context,
  );
}

export function createWorkerTransport(options: {
  send(message: WorkerMessage): void;
  exit(): void;
  open?: typeof openHarnessRuntime;
}): { receive(message: WorkerRequest): Promise<void>; close(): Promise<void> } {
  const watches = new Map<number, ConversationWatch>();
  const requests = new Map<number, AbortController>();
  const acknowledgements = new Map<number, () => void>();
  let runtime: RuntimeHandle | undefined;
  let initializing: Promise<RuntimeHandle> | undefined;
  let closing: Promise<void> | undefined;
  let sealed = false;
  const acknowledge = (id: number): void => {
    const resolve = acknowledgements.get(id);
    acknowledgements.delete(id);
    resolve?.();
  };
  const close = (): Promise<void> => {
    sealed = true;
    closing ??= (async () => {
      for (const id of acknowledgements.keys()) acknowledge(id);
      if (initializing) {
        try {
          runtime = await initializing;
        } catch {}
      }
      try {
        await runtime?.close(context);
      } catch (error) {
        options.send({ type: "startup_error", error: workerFailure(error) });
      }
      options.send({ type: "closed" });
      options.exit();
    })();
    return closing;
  };
  const receive = async (message: WorkerRequest): Promise<void> => {
    if (message.type === "initialize") {
      if (sealed || initializing) {
        options.send({
          type: "startup_error",
          error: workerFailure(new Error("Worker cannot initialize")),
        });
        return;
      }
      try {
        initializing = (options.open ?? openHarnessRuntime)(message.config);
        runtime = await initializing;
        if (!sealed)
          options.send({ type: "ready", rootConversationId: runtime.root.id });
      } catch (error) {
        options.send({ type: "startup_error", error: workerFailure(error) });
      }
      return;
    }
    if (message.type === "close") {
      await close();
      return;
    }
    if (message.type === "cancel_request") {
      requests.get(message.id)?.abort();
      return;
    }
    if (message.type === "stop_watch") {
      const watch = watches.get(message.id);
      if (!watch) requests.get(message.id)?.abort();
      watches.delete(message.id);
      acknowledge(message.id);
      await watch?.stop();
      return;
    }
    if (message.type === "ack_watch") {
      acknowledge(message.id);
      return;
    }
    if (message.type !== "call") return;
    const controller = new AbortController();
    requests.set(message.id, controller);
    try {
      if (!runtime || sealed) throw new Error("Harness is not available");
      const callContext = withAbortSignal(controller.signal, context);
      if (message.operation === "observeConversation") {
        const watch = await runtime.service.observeConversation(
          message.call as Parameters<RuntimeService["observeConversation"]>[0],
          callContext,
        );
        if (sealed || controller.signal.aborted) {
          await watch.stop();
          throw new Error("Watch acquisition was cancelled");
        }
        watches.set(message.id, watch);
        options.send({ type: "result", id: message.id, value: watch.value });
        watch.start(async (value, ops) => {
          if (sealed || !watches.has(message.id)) return;
          await new Promise<void>((resolve) => {
            acknowledgements.set(message.id, resolve);
            options.send({ type: "watch", id: message.id, value, ops });
          });
        });
        void watch.closed.then((end) => {
          options.send({
            type: "watch_closed",
            id: message.id,
            end:
              end.reason === "listener_error"
                ? {
                    reason: end.reason,
                    error: Object.assign(
                      new Error("Watch listener failed"),
                      workerFailure(end.error),
                    ),
                  }
                : end,
          });
          acknowledge(message.id);
          watches.delete(message.id);
          requests.delete(message.id);
        });
      } else {
        const operation = runtime.service[message.operation] as (
          call: RuntimeCall<unknown>,
          context: typeof callContext,
        ) => Promise<unknown>;
        options.send({
          type: "result",
          id: message.id,
          value: await operation(message.call, callContext),
        });
      }
    } catch (error) {
      const watch = watches.get(message.id);
      if (watch) {
        watches.delete(message.id);
        acknowledge(message.id);
        await watch.stop();
      }
      options.send({
        type: "error",
        id: message.id,
        error: workerFailure(error),
      });
    } finally {
      if (!watches.has(message.id)) requests.delete(message.id);
    }
  };
  return { receive, close };
}

export function launchHarnessWorker(): void {
  const transport = createWorkerTransport({
    send: (message) => {
      if (process.connected) process.send?.(message);
    },
    exit: () => process.exit(0),
  });
  process.on("message", (message: WorkerRequest) => {
    void transport.receive(message).catch((error: unknown) => {
      if (process.connected)
        process.send?.({ type: "startup_error", error: workerFailure(error) });
    });
  });
  process.on("disconnect", () => {
    void transport.close();
  });
  process.on("SIGTERM", () => {
    void transport.close();
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  launchHarnessWorker();
}
