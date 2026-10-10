import type { Context } from "@earendil-works/chord";
import {
  awaitWithContext,
  BACKGROUND_CONTEXT,
} from "@earendil-works/chord/context";
import type {
  Api,
  AssistantMessageEventStream,
  Model,
  Models,
} from "@earendil-works/pi-ai";
import { lazyStream } from "@earendil-works/pi-ai/api/lazy";
import type { ModelsApiStreamOptions } from "@earendil-works/pi-ai/models";
import type {
  Extension,
  RegistryReader,
  RegistrySnapshot,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import type { RuntimeBudget } from "./budget.js";

export function budgetModels(models: Models, budget: RuntimeBudget): Models {
  function request(
    model: Model<Api>,
    caller: AbortSignal | undefined,
    send: (signal: AbortSignal) => AssistantMessageEventStream,
  ): AssistantMessageEventStream {
    return lazyStream(model, async () => {
      const slot = await budget.acquire(caller);
      const context = { ...BACKGROUND_CONTEXT, abortSignal: slot.signal };
      try {
        await budget.admitModel(context);
        // Storage settlement completes despite cancellation; check again before the actual send.
        await budget.check(context);
        const source = send(slot.signal);
        const iterator = source[Symbol.asyncIterator]();
        // Cancellation is only a request: retain the slot until the provider actually settles.
        void source.result().then(slot.release, slot.release);
        return {
          async *[Symbol.asyncIterator]() {
            try {
              while (true) {
                const event = await awaitWithContext(iterator.next(), context);
                if (event.done) break;
                yield event.value;
              }
            } catch (error) {
              throw budget.safe(error, context);
            } finally {
              Promise.resolve()
                .then(() => iterator.return?.())
                .catch(() => {});
            }
          },
          result: () =>
            awaitWithContext(source.result(), context).catch((error) => {
              throw budget.safe(error, context);
            }),
        };
      } catch (error) {
        slot.release();
        if (slot.signal.aborted) throw slot.signal.reason;
        throw budget.safe(error);
      }
    });
  }
  function stream<TApi extends Api>(
    model: Model<TApi>,
    input: Parameters<Models["stream"]>[1],
    options?: ModelsApiStreamOptions<TApi>,
  ): AssistantMessageEventStream {
    return request(model, options?.signal, (signal) =>
      models.stream(model, input, {
        ...options,
        signal,
        maxRetries: 0,
      } as ModelsApiStreamOptions<TApi>),
    );
  }
  const streamSimple: Models["streamSimple"] = (model, input, options) =>
    request(model, options?.signal, (signal) =>
      models.streamSimple(model, input, { ...options, signal, maxRetries: 0 }),
    );
  const streamDeferred: Models["streamDeferred"] = (model, handle, options) =>
    request(model, options?.signal, (signal) =>
      models.streamDeferred(model, handle, {
        ...options,
        signal,
        maxRetries: 0,
      }),
    );
  const complete: Models["complete"] = (...args) => stream(...args).result();
  const wrapped = {
    stream,
    streamSimple,
    streamDeferred,
    complete,
    completeSimple: (...args: Parameters<Models["completeSimple"]>) =>
      streamSimple(...args).result(),
    fetchDeferred: (...args: Parameters<Models["fetchDeferred"]>) =>
      streamDeferred(...args).result(),
    generateImages: async () => {
      throw budget.failure("capability_missing");
    },
    classify: async () => {
      throw budget.failure("capability_missing");
    },
  };
  return new Proxy(models, {
    get(target, key) {
      if (Object.hasOwn(wrapped, key)) return Reflect.get(wrapped, key);
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function budgetRegistry(
  registry: RegistryReader,
  budget: RuntimeBudget,
): RegistryReader {
  const originals = new WeakMap<ToolRegistration, ToolRegistration>();
  function guard(tool: ToolRegistration): ToolRegistration {
    const result: ToolRegistration = {
      ...tool,
      async execute(args, api, context: Context) {
        await budget.admitTool(api.commit, context);
        const abortSignal = budget.signal(context.abortSignal);
        await budget.check({ ...context, abortSignal });
        return tool.execute(args, api, { ...context, abortSignal });
      },
    };
    originals.set(result, tool);
    return result;
  }
  const snapshots = new WeakMap<RegistrySnapshot, RegistrySnapshot>();
  return {
    subscribe: (listener) => registry.subscribe(listener),
    snapshot() {
      const source = registry.snapshot();
      const saved = snapshots.get(source);
      if (saved) return saved;
      const extensions: Extension[] = source.installed().map((extension) => ({
        ...extension,
        ...(extension.tools === undefined
          ? {}
          : { tools: extension.tools.map(guard) }),
        ...(extension.wraps === undefined
          ? {}
          : {
              wraps: extension.wraps.map((wrap) =>
                "tool" in wrap
                  ? {
                      tool: wrap.tool,
                      wrap: (tool: ToolRegistration) =>
                        guard(wrap.wrap(originals.get(tool) ?? tool)),
                    }
                  : wrap,
              ),
            }),
      }));
      const projected: RegistrySnapshot = {
        installed: () => extensions,
        extension: (name) =>
          extensions.find((extension) => extension.name === name),
        tools: () =>
          extensions.flatMap((extension) =>
            (extension.tools ?? []).map((tool) => ({ extension, tool })),
          ),
        sections: () =>
          extensions.flatMap((extension) =>
            (extension.sections ?? []).map((section) => ({
              extension,
              section,
            })),
          ),
        tasks: () => source.tasks(),
        task: (name) => source.task(name),
      };
      snapshots.set(source, projected);
      return projected;
    },
  };
}
