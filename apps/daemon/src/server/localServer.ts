import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Context } from "@earendil-works/chord";
import { withAbortSignal } from "@earendil-works/chord/context";
import { DefinitionError } from "@frogie/core/definitions";
import type {
  CancelInput,
  CompactInput,
  CreateConversationInput,
  DaemonDirectory,
  DescribeInput,
  ExtendBudgetInput,
  GetSubmissionInput,
  GetTaskInput,
  InspectInput,
  ListConversationsInput,
  ListEntriesInput,
  ListTasksInput,
  ObserveConversationInput,
  RuntimeScope,
  RuntimeService,
  SubmitInput,
} from "@frogie/core/protocol";
import sirv, { type RequestHandler } from "sirv";
import { Type } from "typebox";
import Value from "typebox/value";
import appPackage from "../../../../package.json" with { type: "json" };
import type { DefinitionWorkspace } from "./definitions.js";
import {
  createLocalAccess,
  type LocalAccess,
  type LocalRequestIdentity,
} from "./localAccess.js";

const MAX_BODY_BYTES = 1_048_576;
const MAX_FRAME_BYTES = 1_048_576;
const CLOSE_TIMEOUT_MS = 5_000;
const safeId = Type.Integer({
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
});
const scopeSchema = Type.Object(
  {
    projectId: Type.String({ minLength: 1 }),
    environmentId: Type.String({ minLength: 1 }),
    squadId: Type.String({ minLength: 1 }),
    harnessId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const emptyInput = Type.Object({}, { additionalProperties: false });
const definitionSquadId = Type.String({ pattern: "^[a-z][a-z0-9-]*$" });
const definitionListSchema = emptyInput;
const definitionLoadSchema = Type.Object(
  { squadId: definitionSquadId },
  { additionalProperties: false },
);
const definitionSaveSchema = Type.Object(
  {
    squadId: definitionSquadId,
    draft: Type.Object(
      {
        path: Type.String({ minLength: 1 }),
        content: Type.String(),
        baseContent: Type.String(),
      },
      { additionalProperties: false },
    ),
    requestId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const projectId = Type.String({ pattern: "^[a-z][a-z0-9-]*$" });
const projectSchemas = {
  enabled: Type.Object(
    { projectId, enabled: Type.Boolean() },
    { additionalProperties: false },
  ),
  register: Type.Object(
    { squadId: projectId },
    { additionalProperties: false },
  ),
  bind: Type.Object({ projectId }, { additionalProperties: false }),
} as const;
const createSchema = Type.Object(
  {
    roleId: Type.String({ minLength: 1 }),
    workflowId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
const submitSchema = Type.Object(
  {
    conversationId: safeId,
    submission: Type.Object(
      {
        type: Type.Literal("input"),
        content: Type.String(),
        requestId: Type.Optional(Type.String({ minLength: 1 })),
        whenBusy: Type.Optional(
          Type.Union([
            Type.Literal("steer"),
            Type.Literal("followUp"),
            Type.Literal("reject"),
          ]),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const getSubmissionSchema = Type.Object(
  { submissionId: safeId },
  { additionalProperties: false },
);
const observeSchema = Type.Object(
  { conversationId: safeId },
  { additionalProperties: false },
);
const cancelSchema = Type.Object(
  {
    conversationId: safeId,
    submissionId: Type.Optional(safeId),
  },
  { additionalProperties: false },
);
const compactSchema = Type.Object(
  {
    conversationId: safeId,
    instructions: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
const definitionOperations = {
  list: definitionListSchema,
  load: definitionLoadSchema,
  save: definitionSaveSchema,
} as const;
type DefinitionOperation = keyof typeof definitionOperations;

const pageFields = {
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
};
const listEntriesSchema = Type.Object(
  { conversationId: safeId, ...pageFields },
  { additionalProperties: false },
);
const listTasksSchema = Type.Object(
  { conversationId: Type.Optional(safeId), ...pageFields },
  { additionalProperties: false },
);
const getTaskSchema = Type.Object(
  { taskId: safeId },
  { additionalProperties: false },
);
const extendBudgetSchema = Type.Object(
  {
    requestId: Type.String({ pattern: "\\S", maxLength: 128 }),
    modelRequests: Type.Optional(safeId),
    toolEntries: Type.Optional(safeId),
    deadlineAt: Type.Optional(safeId),
  },
  { additionalProperties: false, minProperties: 2 },
);
const operationSchemas = {
  describe: emptyInput,
  listConversations: emptyInput,
  createConversation: createSchema,
  submit: submitSchema,
  getSubmission: getSubmissionSchema,
  cancel: cancelSchema,
  compact: compactSchema,
  observeConversation: observeSchema,
  inspect: emptyInput,
  listEntries: listEntriesSchema,
  listTasks: listTasksSchema,
  getTask: getTaskSchema,
  extendBudget: extendBudgetSchema,
} as const;
type Operation = keyof typeof operationSchemas;
type OperationInput<K extends Operation> = Parameters<
  RuntimeService[K]
>[0]["input"];
type LocalCaller = { readonly id: string };
type AuthorizedCall<T> = {
  readonly scope: RuntimeScope;
  readonly input: T;
  readonly caller: LocalCaller;
};
type WatchStop = () => Promise<void>;

export interface LocalServerOptions {
  readonly directory: DaemonDirectory;
  readonly context: Context;
  readonly definitions?: DefinitionWorkspace;
  readonly publicDirectory?: string;
  readonly publicOrigin?: string;
  readonly port?: number;
}

export interface LocalServer {
  readonly origin: string;
  readonly url: string;
  close(): Promise<void>;
}

function fail(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function identity(request: IncomingMessage): LocalRequestIdentity {
  return {
    host: request.headers.host,
    origin: request.headers.origin,
  };
}

const failures = {
  invalid_request: { status: 400, message: "Invalid request" },
  unauthenticated: { status: 401, message: "Authentication required" },
  forbidden: { status: 403, message: "Forbidden" },
  not_found: { status: 404, message: "Not found" },
  binding_mismatch: { status: 409, message: "Runtime scope mismatch" },
  conflict: { status: 409, message: "Request conflicts with stored state" },
  capability_missing: {
    status: 400,
    message: "Required capability is unavailable",
  },
  invalid_definition: { status: 400, message: "Invalid definition" },
  conversation_busy: { status: 409, message: "Conversation is busy" },
  budget_exhausted: { status: 429, message: "Runtime budget exhausted" },
  storage_in_use: { status: 409, message: "Runtime storage is in use" },
  runtime_unavailable: { status: 500, message: "Runtime operation failed" },
  output_limit: { status: 413, message: "Runtime response exceeds its limit" },
} as const;
type FailureCode = keyof typeof failures;

function errorResponse(error: unknown): {
  status: number;
  body: { error: { code: string; message: string; retryable: false } };
} {
  const candidate =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "runtime_unavailable";
  const code: FailureCode = Object.hasOwn(failures, candidate)
    ? (candidate as FailureCode)
    : "runtime_unavailable";
  const failure = failures[code];
  return {
    status: failure.status,
    body: { error: { code, message: failure.message, retryable: false } },
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: object,
): void {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    !/^application\/json(?:\s*;|$)/iu.test(contentType)
  ) {
    request.resume();
    throw fail("invalid_request");
  }
  const rawLength = request.headers["content-length"];
  if (typeof rawLength === "string" && Number(rawLength) > MAX_BODY_BYTES) {
    request.resume();
    throw fail("invalid_request");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = chunk as Buffer;
    size += bytes.byteLength;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw fail("invalid_request");
    }
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw fail("invalid_request");
  }
}

function isStrictEnvelope(
  value: unknown,
): value is { scope: unknown; input: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, "scope") &&
    Object.hasOwn(value, "input")
  );
}

export async function startLocalServer(
  options: LocalServerOptions,
): Promise<LocalServer> {
  const watches = new Set<WatchStop>();
  let access!: LocalAccess;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let origin!: string;
  let staticFiles: RequestHandler | undefined;
  const server: Server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.headersSent) response.destroy();
      else {
        const failure = errorResponse(error);
        sendJson(response, failure.status, failure.body);
      }
    });
  });

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    access?.close();
    const serverClosed = new Promise<void>((resolve) => {
      if (!server.listening) resolve();
      else server.close(() => resolve());
    });
    let expire!: () => void;
    const expired = new Promise<void>((resolve) => {
      expire = resolve;
    });
    const timeout = setTimeout(() => {
      server.closeAllConnections();
      expire();
    }, CLOSE_TIMEOUT_MS);
    timeout.unref();
    closePromise = Promise.race([
      Promise.all([
        Promise.allSettled([...watches].map((stop) => stop())).then(() =>
          server.closeIdleConnections(),
        ),
        serverClosed,
      ]).then(() => undefined),
      expired,
    ]).finally(() => {
      clearTimeout(timeout);
      server.closeAllConnections();
    });
    return closePromise;
  };

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (closed) {
      sendJson(response, 503, {
        error: {
          code: "runtime_unavailable",
          message: "Runtime operation failed",
        },
      });
      return;
    }
    const method = request.method;
    const url = new URL(request.url ?? "/", origin);
    const pathname = url.pathname;
    const caller = access.authorize(identity(request), method === "POST");

    if (pathname !== "/__local" && !pathname.startsWith("/__local/")) {
      if (method !== "GET" && method !== "HEAD") {
        sendJson(response, 405, {
          error: {
            code: "invalid_request",
            message: "Invalid request",
            retryable: false,
          },
        });
        return;
      }
      if (method === "GET" && pathname === "/api/live") {
        sendJson(response, 200, { status: "ok", version: appPackage.version });
        return;
      }
      if (!staticFiles) {
        sendJson(response, 404, {
          error: { code: "not_found", message: "Not found", retryable: false },
        });
        return;
      }
      staticFiles(request, response);
      return;
    }

    if (method === "GET" && pathname === "/__local/context") {
      sendJson(response, 200, {
        caller,
        instanceId: options.directory.instanceId,
        mode: options.directory.mode,
        projects: await options.directory.listProjects(),
      });
      return;
    }

    if (method === "POST" && pathname.startsWith("/__local/projects/")) {
      const operation = pathname.slice(
        "/__local/projects/".length,
      ) as keyof typeof projectSchemas;
      if (!Object.hasOwn(projectSchemas, operation)) throw fail("not_found");
      const input = await readJson(request);
      if (!Value.Check(projectSchemas[operation], input))
        throw fail("invalid_request");
      const fields = input as {
        projectId: string;
        squadId: string;
        enabled: boolean;
      };
      const value =
        operation === "register"
          ? await options.directory.registerProject(fields.squadId)
          : operation === "bind"
            ? await options.directory.bindDefinition(fields.projectId)
            : await options.directory.setProjectEnabled(
                fields.projectId,
                fields.enabled,
              );
      sendJson(response, 200, { value });
      return;
    }
    if (method === "POST" && pathname.startsWith("/__local/definitions/")) {
      const operation = pathname.slice(
        "/__local/definitions/".length,
      ) as DefinitionOperation;
      if (!Object.hasOwn(definitionOperations, operation)) {
        sendJson(response, 404, {
          error: { code: "not_found", message: "Not found", retryable: false },
        });
        return;
      }
      if (!options.definitions) {
        sendJson(response, 404, {
          error: { code: "not_found", message: "Not found", retryable: false },
        });
        return;
      }
      const input = await readJson(request);
      if (!Value.Check(definitionOperations[operation], input)) {
        throw fail("invalid_request");
      }
      const fields = input as Record<string, unknown>;
      try {
        const value =
          operation === "list"
            ? await options.definitions.list()
            : operation === "load"
              ? await options.definitions.load(fields.squadId as string)
              : await options.definitions.save(
                  fields.squadId as string,
                  fields.draft as {
                    path: string;
                    content: string;
                    baseContent: string;
                  },
                  fields.requestId as string,
                );
        sendJson(response, 200, { value });
      } catch (error) {
        const code =
          error instanceof TypeError
            ? "invalid_request"
            : error instanceof DefinitionError
              ? "invalid_definition"
              : typeof error === "object" &&
                  error !== null &&
                  "code" in error &&
                  typeof error.code === "string" &&
                  (error.code === "ENOENT" || error.code === "conflict")
                ? error.code === "ENOENT"
                  ? "not_found"
                  : error.code
                : undefined;
        if (code === undefined) throw error;
        const failure = failures[code];
        sendJson(response, failure.status, {
          error: { code, message: failure.message, retryable: false },
        });
      }
      return;
    }

    const route = /^\/__local\/instances\/([^/]+)\/operations\/([^/]+)$/u.exec(
      pathname,
    );
    if (method !== "POST" || !route) {
      sendJson(response, method === "GET" || method === "POST" ? 404 : 405, {
        error: { code: "not_found", message: "Not found" },
      });
      return;
    }
    let routeInstance: string;
    try {
      routeInstance = decodeURIComponent(route[1] ?? "");
    } catch {
      throw fail("invalid_request");
    }
    if (routeInstance !== options.directory.instanceId) {
      sendJson(response, 409, {
        error: { code: "binding_mismatch", message: "Runtime scope mismatch" },
      });
      return;
    }
    const operation = route[2] as Operation;
    if (!Object.hasOwn(operationSchemas, operation)) {
      sendJson(response, 404, {
        error: { code: "not_found", message: "Not found" },
      });
      return;
    }
    const body = await readJson(request);
    if (!isStrictEnvelope(body) || !Value.Check(scopeSchema, body.scope)) {
      throw fail("invalid_request");
    }
    if (!Value.Check(operationSchemas[operation], body.input)) {
      throw fail("invalid_request");
    }
    if (
      operation === "extendBudget" &&
      Buffer.byteLength((body.input as ExtendBudgetInput).requestId, "utf8") >
        128
    )
      throw fail("invalid_request");
    const input = body.input as OperationInput<typeof operation>;
    const scope = body.scope as RuntimeScope;
    const service = options.directory.runtime(scope);
    if (operation === "observeConversation") {
      await streamObservation(
        response,
        scope,
        service,
        caller,
        input as ObserveConversationInput,
      );
      return;
    }
    const value = await dispatch(service, operation, {
      scope,
      caller,
      input,
    });
    sendJson(response, 200, {
      scope,
      value: value === undefined ? null : value,
    });
  };

  const dispatch = async <K extends Exclude<Operation, "observeConversation">>(
    service: RuntimeService,
    operation: K,
    call: AuthorizedCall<OperationInput<K>>,
  ): Promise<unknown> => {
    switch (operation) {
      case "describe":
        return service.describe(
          call as AuthorizedCall<DescribeInput>,
          options.context,
        );
      case "listConversations":
        return service.listConversations(
          call as AuthorizedCall<ListConversationsInput>,
          options.context,
        );
      case "createConversation":
        return service.createConversation(
          call as AuthorizedCall<CreateConversationInput>,
          options.context,
        );
      case "submit":
        return service.submit(
          call as AuthorizedCall<SubmitInput>,
          options.context,
        );
      case "getSubmission":
        return service.getSubmission(
          call as AuthorizedCall<GetSubmissionInput>,
          options.context,
        );
      case "cancel":
        return service.cancel(
          call as AuthorizedCall<CancelInput>,
          options.context,
        );
      case "compact":
        return service.compact(
          call as AuthorizedCall<CompactInput>,
          options.context,
        );
      case "inspect":
        return service.inspect(
          call as AuthorizedCall<InspectInput>,
          options.context,
        );
      case "listEntries":
        return service.listEntries(
          call as AuthorizedCall<ListEntriesInput>,
          options.context,
        );
      case "listTasks":
        return service.listTasks(
          call as AuthorizedCall<ListTasksInput>,
          options.context,
        );
      case "getTask":
        return service.getTask(
          call as AuthorizedCall<GetTaskInput>,
          options.context,
        );
      case "extendBudget":
        return service.extendBudget(
          call as AuthorizedCall<ExtendBudgetInput>,
          options.context,
        );
    }
  };

  const streamObservation = async (
    response: ServerResponse,
    scope: RuntimeScope,
    service: RuntimeService,
    caller: { readonly id: string },
    input: ObserveConversationInput,
  ): Promise<void> => {
    const controller = new AbortController();
    const requestContext = withAbortSignal(controller.signal, options.context);
    let watch:
      | Awaited<ReturnType<RuntimeService["observeConversation"]>>
      | undefined;
    let stopPromise: Promise<void> | undefined;
    let stopped = false;
    const stop = (): Promise<void> => {
      stopPromise ??= (async () => {
        stopped = true;
        controller.abort();
        try {
          if (watch) await watch.stop();
        } finally {
          watches.delete(stop);
        }
      })();
      return stopPromise;
    };
    watches.add(stop);
    const disconnect = () => {
      void stop().catch(() => response.destroy());
    };
    response.once("close", disconnect);
    try {
      watch = await service.observeConversation(
        { scope, caller, input },
        requestContext,
      );
      if (stopped || closed || response.destroyed || response.writableEnded) {
        try {
          await watch.stop();
        } finally {
          watches.delete(stop);
        }
        return;
      }
      const send = async (
        type: "snapshot" | "update",
        value: unknown,
      ): Promise<boolean> => {
        if (stopped || response.destroyed || response.writableEnded)
          return false;
        const frame = `event: ${type}\ndata: ${JSON.stringify({
          type,
          scope,
          conversationId: input.conversationId,
          value,
        })}\n\n`;
        if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
          if (type === "snapshot" && !response.headersSent) {
            sendJson(response, 413, {
              error: {
                code: "invalid_request",
                message: "Observation frame exceeds 1 MiB",
              },
            });
          } else {
            response.destroy();
          }
          await stop();
          return false;
        }
        if (!response.headersSent) {
          response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Content-Type-Options": "nosniff",
          });
        }
        if (response.write(frame)) return true;
        try {
          await once(response, "drain", { signal: controller.signal });
          return !stopped && !response.destroyed && !response.writableEnded;
        } catch {
          response.destroy();
          await stop();
          return false;
        }
      };
      if (!(await send("snapshot", watch.value))) return;
      watch.start(async (value) => {
        if (!(await send("update", value))) await stop();
      });
      void watch.closed
        .then(async () => {
          if (!response.destroyed && !response.writableEnded) response.end();
          await stop();
        })
        .catch(() => {
          response.destroy();
          void stop().catch(() => undefined);
        });
    } catch (error) {
      await stop().catch(() => undefined);
      throw error;
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address() as import("node:net").AddressInfo;
    origin = options.publicOrigin ?? `http://127.0.0.1:${address.port}`;
    access = createLocalAccess(origin);
    if (options.publicDirectory) {
      staticFiles = sirv(options.publicDirectory, {
        etag: true,
        onNoMatch(_request, response) {
          sendJson(response, 404, {
            error: {
              code: "not_found",
              message: "Not found",
              retryable: false,
            },
          });
        },
      });
    }
  } catch (error) {
    await close();
    throw error;
  }

  return {
    origin,
    url: `${origin}/`,
    close,
  };
}
