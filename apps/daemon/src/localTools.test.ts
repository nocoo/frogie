import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  createModels,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createRegistry,
  MemoryStorage,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import { loadDefinition } from "@frogie/core/definitions";
import type { ArtifactRef } from "@frogie/core/protocol";
import {
  configureRuntimeRole,
  openRuntime,
  type RuntimeConfiguration,
  type RuntimeHandle,
  type RuntimeOptions,
  readRuntimeRole,
} from "@frogie/core/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createArtifactStore } from "./artifacts.js";
import { createLocalTools } from "./localTools.js";

const directories: string[] = [];
const runtimes: RuntimeHandle[] = [];
const caller = { id: "local-tool-test-owner" };
const scope = {
  projectId: "frogie",
  environmentId: "e2e",
  squadId: "minimal-squad",
  harnessId: "local-tool-harness",
};
const tools = [
  "delegate",
  "read_artifact",
  "write_artifact",
  "run_script",
  "read_history",
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "frogie-local-tools-test-"));
  directories.push(directory);
  const artifacts = await createArtifactStore({
    directory: join(directory, "artifacts"),
    scope,
  });
  const definition = loadDefinition(
    fileURLToPath(
      new URL("../../../tests/fixtures/minimal-squad", import.meta.url),
    ),
  );
  definition.roles = definition.roles.map((role) => ({
    ...role,
    extensions: ["frogie"],
    tools: [...tools],
  }));
  definition.workflows = definition.workflows.map((workflow) => ({
    ...workflow,
    entry: "report",
    entryRole: "command",
    tools: ["delegate", "read_artifact", "write_artifact", "run_script"],
  }));
  const faux = fauxProvider({
    provider: "fixture",
    models: [{ id: "test", reasoning: true }],
    tokensPerSecond: 1_000_000,
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const configuration: RuntimeConfiguration = {
    runtimeId: "local-tool-runtime",
    definition,
    binding: {
      projectId: "frogie",
      scope,
      definition: { contentHash: definition.contentHash },
      environment: {
        model: { provider: "fixture", modelId: "test" },
        thinkingLevel: "low",
      },
    },
    models,
    registry,
  };
  const scripts = {
    run: vi.fn(
      async (input: {
        conversationId: number;
        taskId: number;
      }): Promise<{ output: JsonValue; artifact: ArtifactRef }> => ({
        output: { result: 5 },
        artifact: await artifacts.write({
          conversationId: input.conversationId,
          taskId: input.taskId,
          operationId: `script:${input.taskId}`,
          name: "calculation.json",
          mediaType: "application/json",
          content: '{"result":5}',
        }),
      }),
    ),
  };
  const extension = createLocalTools({
    runtime: configuration,
    artifacts,
    scripts,
  });
  const options: RuntimeOptions = {
    ...configuration,
    storage: new MemoryStorage(),
    authorization: async () => true,
  };
  return {
    artifacts,
    configuration,
    scripts,
    extension,
    options,
    faux,
    registry,
  };
}

async function open(test: Awaited<ReturnType<typeof setup>>) {
  test.registry.install(test.extension);
  const runtime = await openRuntime(test.options, context);
  runtimes.push(runtime);
  return runtime;
}

function responses(
  test: Awaited<ReturnType<typeof setup>>,
  factory: FauxResponseFactory,
) {
  const next: FauxResponseFactory = (...args) => {
    test.faux.appendResponses([next]);
    return factory(...args);
  };
  test.faux.setResponses([next]);
}

async function submit(
  runtime: RuntimeHandle,
  text: string,
  id = runtime.root.id,
) {
  const submissionId = await runtime.service.submit(
    {
      scope,
      caller,
      input: {
        conversationId: id,
        submission: { type: "input", content: text },
      },
    },
    context,
  );
  const result = await (
    await runtime.harness.submission(submissionId, context)
  )?.wait(context);
  expect(result?.status).toBe("done");
  const watch = await runtime.service.observeConversation(
    { scope, caller, input: { conversationId: id } },
    context,
  );
  try {
    return watch.value;
  } finally {
    await watch.stop();
  }
}

function resultMessages(value: Awaited<ReturnType<typeof submit>>) {
  return value.entries.flatMap((entry) =>
    (entry.model ?? []).filter((message) => message.role === "toolResult"),
  );
}

function parsed(result: ToolExecutionResult) {
  return JSON.parse(
    (result.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(""),
  ) as Record<string, unknown>;
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close(context);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("frogie local tools with real Pi", () => {
  it("registers explicit local capabilities and renders only the bound role's direct children and scripts", async () => {
    const test = await setup();
    expect(test.extension.name).toBe("frogie");
    expect(test.extension.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(tools),
    );
    const seen: string[] = [];
    responses(test, (transcript) => {
      seen.push(
        JSON.stringify(
          transcript.messages.filter((message) => message.role === "system"),
        ),
      );
      return fauxAssistantMessage("Tool metadata loaded");
    });
    const runtime = await open(test);
    await submit(runtime, "Inspect capability metadata");
    expect(seen.join("\n")).toContain("reviewer: Reviewer");
    expect(seen.join("\n")).toContain("read_history");
    expect(
      (await runtime.root.agent(context)).tools.map((tool) => tool.name),
    ).toEqual(tools);
  });

  it("delegates to a task-owned child with inherited Workflow and grants input and output artifacts in both directions", async () => {
    const test = await setup();
    const captures: string[] = [];
    let sourceId = "";
    responses(test, (transcript) => {
      const user = JSON.stringify(
        transcript.messages.filter((message) => message.role === "user"),
      );
      const results = transcript.messages.filter(
        (message) => message.role === "toolResult",
      );
      if (user.includes("review-source")) {
        if (!results.length)
          return fauxAssistantMessage(
            [
              fauxToolCall("read_artifact", { id: sourceId }),
              fauxToolCall("write_artifact", {
                name: "review.md",
                content: "Child reviewed source evidence",
              }),
            ],
            { stopReason: "toolUse" },
          );
        captures.push(JSON.stringify(results));
        return fauxAssistantMessage("Child actual answer with evidence");
      }
      if (!results.length)
        return fauxAssistantMessage(
          fauxToolCall("delegate", {
            roleId: "reviewer",
            task: "review-source",
            artifacts: [sourceId],
          }),
          { stopReason: "toolUse" },
        );
      captures.push(JSON.stringify(results));
      return fauxAssistantMessage("Parent combined the actual child answer");
    });
    const runtime = await open(test);
    const parent = await runtime.service.createConversation(
      { scope, caller, input: { roleId: "command", workflowId: "review" } },
      context,
    );
    sourceId = (
      await test.artifacts.write({
        conversationId: parent.conversationId,
        operationId: "source",
        name: "source.md",
        mediaType: "text/markdown",
        content: "Input evidence private to parent",
      })
    ).id;
    const value = await submit(
      runtime,
      "Start parent delegation",
      parent.conversationId,
    );
    const records = await runtime.service.listConversations(
      { scope, caller, input: {} },
      context,
    );
    const child = records.find(
      (record) => record.binding.roleId === "reviewer",
    );
    if (!child) throw new Error("Missing delegated child");
    expect(child.conversation.owner?.conversationId).toBe(
      parent.conversationId,
    );
    expect(child.conversation.owner?.taskId).toEqual(expect.any(Number));
    expect(
      await readRuntimeRole(
        runtime.harness,
        test.configuration,
        child.conversation.id,
        context,
      ),
    ).toMatchObject({ roleId: "reviewer", workflowId: "review" });
    const agent = await (
      await runtime.harness.conversation(child.conversation.id, context)
    )?.agent(context);
    expect(agent?.tools.map((tool) => tool.name)).not.toContain("read_history");
    expect(
      (await test.artifacts.read(sourceId, child.conversation.id)).content,
    ).toBe("Input evidence private to parent");
    const output = (await test.artifacts.list(parent.conversationId)).find(
      (artifact) => artifact.name === "review.md",
    );
    expect(output?.conversationId).toBe(child.conversation.id);
    expect(captures.join("\n")).toContain("Input evidence private to parent");
    expect(captures.join("\n")).toContain("Child actual answer with evidence");
    expect(JSON.stringify(resultMessages(value))).toContain("answerEntryId");
    const submissions = await test.options.storage.scanSubmissions(
      { conversationId: child.conversation.id },
      10,
      undefined,
      context,
    );
    expect(submissions.items).toHaveLength(1);
    expect(submissions.items[0]?.requestId).toBe(
      `frogie.delegate:${child.conversation.owner?.taskId}`,
    );
  });

  it("reuses a delegation's child and Submission for the same live Pi task and rejects changed input", async () => {
    const test = await setup();
    const delegate = test.extension.tools?.find(
      (tool) => tool.name === "delegate",
    );
    if (!delegate) throw new Error("Missing delegate tool");
    const execute = delegate.execute;
    const repeated: ToolExecutionResult[] = [];
    Reflect.set(
      delegate,
      "execute",
      async (...args: Parameters<typeof execute>) => {
        const first = await execute(...args);
        repeated.push(
          first,
          await execute(...args),
          await execute(
            { ...(args[0] as Record<string, JsonValue>), task: "Changed task" },
            args[1],
            args[2],
          ),
        );
        return first;
      },
    );
    responses(test, (transcript) => {
      const user = JSON.stringify(
        transcript.messages.filter((message) => message.role === "user"),
      );
      if (user.includes("child-unit"))
        return fauxAssistantMessage("Replayed child answer");
      return transcript.messages.some(
        (message) => message.role === "toolResult",
      )
        ? fauxAssistantMessage("Parent complete")
        : fauxAssistantMessage(
            fauxToolCall("delegate", {
              roleId: "reviewer",
              task: "child-unit",
            }),
            { stopReason: "toolUse" },
          );
    });
    const runtime = await open(test);
    await submit(runtime, "Parent replay check");
    const [first, second, changed] = repeated;
    if (!first || !second || !changed)
      throw new Error("Missing delegated replay results");
    expect(parsed(first)).toEqual(parsed(second));
    expect(changed.isError).toBe(true);
    expect(parsed(changed)).toMatchObject({ code: "conflict" });
    const children = await test.options.storage.scanConversations(
      { ownerConversationId: runtime.root.id },
      10,
      undefined,
      context,
    );
    expect(children.items).toHaveLength(1);
    const child = children.items[0];
    if (!child) throw new Error("Missing child");
    expect(
      (
        await test.options.storage.scanSubmissions(
          { conversationId: child.id },
          10,
          undefined,
          context,
        )
      ).items,
    ).toHaveLength(1);
  });

  it("rejects lateral delegation and ungranted artifacts without creating a child or leaking error details", async () => {
    const test = await setup();
    const privateRef = await test.artifacts.write({
      conversationId: 999,
      operationId: "private",
      name: "private.md",
      mediaType: "text/markdown",
      content: "private-secret",
    });
    responses(test, (transcript) =>
      transcript.messages.some((message) => message.role === "toolResult")
        ? fauxAssistantMessage("Rejected tool requests handled")
        : fauxAssistantMessage(
            [
              fauxToolCall("delegate", {
                roleId: "command",
                task: "Cannot delegate sideways",
              }),
              fauxToolCall("delegate", {
                roleId: "reviewer",
                task: "Cannot read private input",
                artifacts: [privateRef.id],
              }),
              fauxToolCall("read_artifact", { id: privateRef.id }),
            ],
            { stopReason: "toolUse" },
          ),
    );
    const runtime = await open(test);
    const value = await submit(runtime, "Invalid boundaries");
    const results = resultMessages(value);
    expect(results).toHaveLength(3);
    expect(results.every((message) => message.isError)).toBe(true);
    expect(JSON.stringify(results)).toContain("forbidden");
    expect(JSON.stringify(results)).not.toContain("private-secret");
    expect(
      (
        await test.options.storage.scanConversations(
          { ownerConversationId: runtime.root.id },
          10,
          undefined,
          context,
        )
      ).items,
    ).toEqual([]);
  });

  it("passes the committed Role and Workflow to the script runner and persists the returned artifact association", async () => {
    const test = await setup();
    responses(test, (transcript) =>
      transcript.messages.some((message) => message.role === "toolResult")
        ? fauxAssistantMessage("Script output accepted")
        : fauxAssistantMessage(
            fauxToolCall("run_script", {
              skillId: "planning",
              scriptId: "test-script",
              input: { units: 3 },
            }),
            { stopReason: "toolUse" },
          ),
    );
    const runtime = await open(test);
    const conversation = await runtime.service.createConversation(
      { scope, caller, input: { roleId: "command", workflowId: "review" } },
      context,
    );
    const value = await submit(
      runtime,
      "Run local calculation",
      conversation.conversationId,
    );
    expect(test.scripts.run).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: conversation.conversationId,
        taskId: expect.any(Number),
        roleId: "command",
        workflowId: "review",
        skillId: "planning",
        scriptId: "test-script",
        input: { units: 3 },
      }),
      expect.anything(),
    );
    const result = resultMessages(value)[0];
    expect(
      JSON.parse(
        result?.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("") ?? "{}",
      ),
    ).toMatchObject({ output: { result: 5 } });
    expect(await test.artifacts.list(conversation.conversationId)).toEqual([
      expect.objectContaining({
        name: "calculation.json",
        taskId: expect.any(Number),
      }),
    ]);
  });

  it("reads only bounded current-conversation history, rejects foreign conversations and leaves the source entries unchanged", async () => {
    const test = await setup();
    responses(test, (transcript) =>
      transcript.messages.some((message) => message.role === "toolResult")
        ? fauxAssistantMessage("History inspected")
        : fauxAssistantMessage(
            [
              fauxToolCall("read_history", { limit: 2 }),
              fauxToolCall("read_history", { conversationId: 999, limit: 2 }),
            ],
            { stopReason: "toolUse" },
          ),
    );
    const runtime = await open(test);
    for (let index = 0; index < 4; index++)
      await runtime.service.submit(
        {
          scope,
          caller,
          input: {
            conversationId: runtime.root.id,
            submission: {
              type: "write",
              entry: {
                kind: "fixture.user",
                model: [
                  {
                    role: "user",
                    content: `Retained entry ${index}`,
                    timestamp: 1,
                  },
                ],
              },
            },
          },
        },
        context,
      );
    const value = await submit(runtime, "Inspect own history");
    const results = resultMessages(value);
    const own = results.find((message) => !message.isError);
    expect(own).toBeDefined();
    const payload = JSON.parse(
      own?.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("") ?? "{}",
    );
    expect(payload.conversationId).toBe(runtime.root.id);
    expect(payload.entries.length).toBeLessThanOrEqual(2);
    expect(payload.cursor).toEqual(expect.any(String));
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(
      1_048_576,
    );
    expect(
      JSON.stringify(results.find((message) => message.isError)),
    ).toContain("forbidden");
    for (let index = 0; index < 4; index++)
      expect(JSON.stringify(value.entries)).toContain(
        `Retained entry ${index}`,
      );
  });

  it("sanitizes unavailable script errors while retaining a usable Pi conversation", async () => {
    const test = await setup();
    test.scripts.run.mockRejectedValueOnce(
      Object.assign(new Error("private-secret from /private/path"), {
        code: "capability_missing",
      }),
    );
    responses(test, (transcript) =>
      transcript.messages.some((message) => message.role === "toolResult")
        ? fauxAssistantMessage("Script failure handled safely")
        : fauxAssistantMessage(
            fauxToolCall("run_script", {
              skillId: "planning",
              scriptId: "test-script",
              input: {},
            }),
            { stopReason: "toolUse" },
          ),
    );
    const runtime = await open(test);
    const value = await submit(runtime, "Unavailable local script");
    const results = resultMessages(value);
    expect(results).toHaveLength(1);
    expect(results[0]?.isError).toBe(true);
    expect(JSON.stringify(results)).toContain("capability_missing");
    expect(JSON.stringify(results)).not.toMatch(/private-secret|private\/path/);
    expect(await test.artifacts.list(runtime.root.id)).toEqual([]);
    expect((await runtime.harness.inspect(context)).tasks).toEqual([]);
  });

  it("continues history pages using opaque cursors without overlapping entries and rejects invalid bounds", async () => {
    const test = await setup();
    const pages: { entries: { id: number }[]; cursor: string | null }[] = [];
    responses(test, (transcript) => {
      const results = transcript.messages.filter(
        (message) => message.role === "toolResult",
      );
      const last = results.findLast(
        (message) => message.toolName === "read_history" && !message.isError,
      );
      if (last) {
        const page = JSON.parse(
          last.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join(""),
        ) as { entries: { id: number }[]; cursor: string | null };
        if (
          !pages.some(
            (existing) => existing.entries[0]?.id === page.entries[0]?.id,
          )
        )
          pages.push(page);
      }
      if (!results.length)
        return fauxAssistantMessage(
          fauxToolCall("read_history", { limit: 2 }),
          { stopReason: "toolUse" },
        );
      if (pages.length === 1 && pages[0]?.cursor)
        return fauxAssistantMessage(
          [
            fauxToolCall("read_history", { limit: 2, cursor: pages[0].cursor }),
            fauxToolCall("read_history", { limit: 101 }),
            fauxToolCall("read_history", { cursor: "../escape" }),
          ],
          { stopReason: "toolUse" },
        );
      return fauxAssistantMessage("History pagination completed");
    });
    const runtime = await open(test);
    for (let index = 0; index < 6; index++)
      await runtime.service.submit(
        {
          scope,
          caller,
          input: {
            conversationId: runtime.root.id,
            submission: {
              type: "write",
              entry: {
                kind: "fixture.user",
                model: [
                  {
                    role: "user",
                    content: `History page source ${index}`,
                    timestamp: 1,
                  },
                ],
              },
            },
          },
        },
        context,
      );
    const value = await submit(runtime, "Paged local history");
    expect(pages).toHaveLength(2);
    const [first, second] = pages;
    if (!first || !second) throw new Error("Missing history pages");
    expect(first.entries).toHaveLength(2);
    expect(second.entries).toHaveLength(2);
    expect(
      second.entries.every(
        (entry) => !first.entries.some((previous) => previous.id === entry.id),
      ),
    ).toBe(true);
    expect(
      resultMessages(value).filter((message) => message.isError),
    ).toHaveLength(2);
  });

  it("rechecks selected tool permissions at execution and returns safe failures after capability revocation", async () => {
    const test = await setup();
    const write = test.extension.tools?.find(
      (tool) => tool.name === "write_artifact",
    );
    if (!write) throw new Error("Missing write tool");
    const execute = write.execute;
    Reflect.set(
      write,
      "execute",
      async (...args: Parameters<typeof execute>) => {
        const source = test.configuration.definition.roles.find(
          (role) => role.id === "command",
        );
        if (!source) throw new Error("Missing current role authorization");
        source.tools = [];
        return execute(...args);
      },
    );
    responses(test, (transcript) =>
      transcript.messages.some((message) => message.role === "toolResult")
        ? fauxAssistantMessage("Revoked capability handled")
        : fauxAssistantMessage(
            fauxToolCall("write_artifact", {
              name: "result.txt",
              mediaType: "text/plain",
              content: "Must not persist",
            }),
            { stopReason: "toolUse" },
          ),
    );
    const runtime = await open(test);
    const value = await submit(runtime, "Revoke write capability");
    expect(resultMessages(value)[0]?.isError).toBe(true);
    expect(JSON.stringify(resultMessages(value))).toContain("forbidden");
    expect(await test.artifacts.list(runtime.root.id)).toEqual([]);
  });

  it("rejects recovered delegation state with duplicate children or a substituted Role binding", async () => {
    for (const corruption of ["duplicate", "role"] as const) {
      const test = await setup();
      const delegate = test.extension.tools?.find(
        (tool) => tool.name === "delegate",
      );
      if (!delegate) throw new Error("Missing delegate tool");
      const execute = delegate.execute;
      Reflect.set(
        delegate,
        "execute",
        async (...args: Parameters<typeof execute>) => {
          await args[1].commit(async (tx) => {
            for (
              let index = 0;
              index < (corruption === "duplicate" ? 2 : 1);
              index++
            ) {
              const child = await tx.createConversation({
                ownership: { kind: "task", taskId: args[1].taskId },
              });
              await configureRuntimeRole(
                tx,
                test.configuration,
                child.id,
                corruption === "role" ? "command" : "reviewer",
              );
            }
          }, args[2]);
          return execute(...args);
        },
      );
      responses(test, (transcript) =>
        transcript.messages.some((message) => message.role === "toolResult")
          ? fauxAssistantMessage("Corrupt delegation refused")
          : fauxAssistantMessage(
              fauxToolCall("delegate", {
                roleId: "reviewer",
                task: "Recovered child work",
              }),
              { stopReason: "toolUse" },
            ),
      );
      const runtime = await open(test);
      const value = await submit(runtime, "Validate recovered delegation");
      expect(resultMessages(value)[0]?.isError).toBe(true);
      expect(JSON.stringify(resultMessages(value))).toContain(
        "binding_mismatch",
      );
      expect(
        (await test.options.storage.scanSubmissions({}, 20, undefined, context))
          .items,
      ).toHaveLength(1);
    }
  });

  it("rejects broken recovered ownership, missing children and a foreign answer instead of reporting successful delegation", async () => {
    for (const failure of ["owner", "conversation", "answer"] as const) {
      const test = await setup();
      const delegate = test.extension.tools?.find(
        (tool) => tool.name === "delegate",
      );
      if (!delegate) throw new Error("Missing delegate tool");
      const execute = delegate.execute;
      Reflect.set(
        delegate,
        "execute",
        async (...args: Parameters<typeof execute>) => {
          const api = args[1];
          if (failure === "owner")
            await api.commit(async (tx) => {
              const child = await tx.createConversation({
                ownership: { kind: "task", taskId: api.taskId },
              });
              await configureRuntimeRole(
                tx,
                test.configuration,
                child.id,
                "reviewer",
              );
            }, args[2]);
          return execute(
            args[0],
            {
              ...api,
              conversation:
                failure === "conversation"
                  ? async () => undefined
                  : api.conversation,
              commit: (action, requestedContext) =>
                api.commit(
                  (tx) =>
                    action(
                      new Proxy(tx, {
                        get(target, key) {
                          if (key === "scanConversations")
                            return async (
                              ...query: Parameters<typeof tx.scanConversations>
                            ) => {
                              const page = await tx.scanConversations(...query);
                              return failure === "owner"
                                ? {
                                    ...page,
                                    items: page.items.map((child) => ({
                                      ...child,
                                      owner: {
                                        ...child.owner,
                                        conversationId: 999 as never,
                                      },
                                    })),
                                  }
                                : page;
                            };
                          if (key === "entry")
                            return async (
                              ...query: Parameters<typeof tx.entry>
                            ) => {
                              const answer = await tx.entry(...query);
                              return failure === "answer" && answer
                                ? { ...answer, conversationId: 999 as never }
                                : answer;
                            };
                          const value = Reflect.get(target, key);
                          return typeof value === "function"
                            ? value.bind(target)
                            : value;
                        },
                      }),
                    ),
                  requestedContext,
                ),
            },
            args[2],
          );
        },
      );
      responses(test, (transcript) => {
        const user = JSON.stringify(
          transcript.messages.filter((message) => message.role === "user"),
        );
        if (user.includes("guarded-child"))
          return fauxAssistantMessage("Child guarded answer");
        return transcript.messages.some(
          (message) => message.role === "toolResult",
        )
          ? fauxAssistantMessage("Recovered boundary rejected")
          : fauxAssistantMessage(
              fauxToolCall("delegate", {
                roleId: "reviewer",
                task: "guarded-child",
              }),
              { stopReason: "toolUse" },
            );
      });
      const runtime = await open(test);
      const value = await submit(runtime, "Recovered boundary guard");
      expect(resultMessages(value)[0]?.isError).toBe(true);
      expect(JSON.stringify(resultMessages(value))).toContain(
        failure === "conversation" ? "not_found" : "binding_mismatch",
      );
      expect(await test.artifacts.list(runtime.root.id)).toEqual([]);
    }
  });

  it("reads explicitly selected own passive history and reports an exhausted cursor without creating entries", async () => {
    const test = await setup();
    const results: ToolExecutionResult[] = [];
    const history = test.extension.tools?.find(
      (tool) => tool.name === "read_history",
    );
    if (!history) throw new Error("Missing history tool");
    const execute = history.execute;
    Reflect.set(
      history,
      "execute",
      async (...args: Parameters<typeof execute>) => {
        const own = { conversationId: args[1].conversationId, limit: 100 };
        const first = await execute(own, args[1], args[2]);
        results.push(
          first,
          await execute({ ...own, cursor: "1" }, args[1], args[2]),
        );
        return first;
      },
    );
    responses(test, (transcript) =>
      transcript.messages.some((message) => message.role === "toolResult")
        ? fauxAssistantMessage("Passive history inspected")
        : fauxAssistantMessage(fauxToolCall("read_history", {}), {
            stopReason: "toolUse",
          }),
    );
    const runtime = await open(test);
    await runtime.service.submit(
      {
        scope,
        caller,
        input: {
          conversationId: runtime.root.id,
          submission: {
            type: "write",
            entry: {
              kind: "fixture.metadata",
              data: { retained: "passive source" },
            },
          },
        },
      },
      context,
    );
    await submit(runtime, "Passive history read");
    const [first, exhausted] = results;
    if (!first || !exhausted)
      throw new Error("Missing bounded history results");
    expect(parsed(first)).toMatchObject({
      conversationId: runtime.root.id,
      entries: expect.arrayContaining([
        expect.objectContaining({ kind: "fixture.metadata" }),
      ]),
    });
    expect(parsed(exhausted)).toMatchObject({ entries: [], cursor: null });
    test.configuration.definition.roles =
      test.configuration.definition.roles.map((role) => ({
        ...role,
        tools: [],
      }));
    const created = await runtime.service.createConversation(
      { scope, caller, input: { roleId: "reviewer" } },
      context,
    );
    test.faux.setResponses([fauxAssistantMessage("Role with no tools")]);
    expect(
      (await submit(runtime, "No tools selected", created.conversationId))
        .entries.length,
    ).toBeGreaterThan(0);
  });

  it("reports an unanswered child instead of presenting a fabricated success", async () => {
    const test = await setup();
    responses(test, (transcript) => {
      const user = JSON.stringify(
        transcript.messages.filter((message) => message.role === "user"),
      );
      if (user.includes("failed-child"))
        return fauxAssistantMessage("", {
          stopReason: "error",
          errorMessage: "Private child provider failure",
        });
      return transcript.messages.some(
        (message) => message.role === "toolResult",
      )
        ? fauxAssistantMessage("Child failure reported")
        : fauxAssistantMessage(
            fauxToolCall("delegate", {
              roleId: "reviewer",
              task: "failed-child",
            }),
            { stopReason: "toolUse" },
          );
    });
    const runtime = await open(test);
    const value = await submit(runtime, "Failed child completion");
    expect(resultMessages(value)[0]?.isError).toBe(true);
    expect(JSON.stringify(resultMessages(value))).toContain("child_unanswered");
    expect(JSON.stringify(resultMessages(value))).not.toContain(
      "Private child provider failure",
    );
  });

  it("bounds history pages by actual bytes and does not synthesize a page for an oversized entry", async () => {
    for (const size of [600_000, 1_048_576]) {
      const test = await setup();
      responses(test, (transcript) =>
        transcript.messages.some((message) => message.role === "toolResult")
          ? fauxAssistantMessage("Byte-limited history inspected")
          : fauxAssistantMessage(fauxToolCall("read_history", {}), {
              stopReason: "toolUse",
            }),
      );
      const historyTool = test.extension.tools?.find(
        (tool) => tool.name === "read_history",
      );
      if (!historyTool) throw new Error("Missing history tool");
      const execute = historyTool.execute;
      let captured: ToolExecutionResult | undefined;
      Reflect.set(
        historyTool,
        "execute",
        async (...args: Parameters<typeof execute>) => {
          captured = await execute(...args);
          const cursor = parsed(captured).cursor;
          if (size === 1_048_576 && typeof cursor === "string")
            captured = await execute(
              { ...(args[0] as Record<string, JsonValue>), cursor },
              args[1],
              args[2],
            );
          return captured;
        },
      );
      const runtime = await open(test);
      for (let index = 0; index < 2; index++)
        await runtime.service.submit(
          {
            scope,
            caller,
            input: {
              conversationId: runtime.root.id,
              submission: {
                type: "write",
                entry: {
                  kind: "fixture.large",
                  model: [
                    { role: "user", content: "x".repeat(size), timestamp: 1 },
                  ],
                },
              },
            },
          },
          context,
        );
      const value = await submit(runtime, "History byte bound");
      expect(resultMessages(value)).toHaveLength(1);
      if (!captured) throw new Error("Missing bounded tool result");
      expect(
        Buffer.byteLength(JSON.stringify(captured.content)),
      ).toBeLessThanOrEqual(1_048_576);
      if (size === 1_048_576) expect(captured.isError).toBe(true);
      else {
        const page = parsed(captured) as {
          entries: unknown[];
          cursor: string | null;
        };
        expect(page.entries.length).toBeLessThan(5);
        expect(page.cursor).toEqual(expect.any(String));
      }
    }
  });

  it("contains a non-runtime script failure and maps AbortError to a cancelled tool result", async () => {
    for (const error of [
      new Error("private-secret"),
      new DOMException("private-secret", "AbortError"),
    ]) {
      const test = await setup();
      test.scripts.run.mockRejectedValueOnce(error);
      responses(test, (transcript) =>
        transcript.messages.some((message) => message.role === "toolResult")
          ? fauxAssistantMessage("Tool failure contained")
          : fauxAssistantMessage(
              fauxToolCall("run_script", {
                skillId: "planning",
                scriptId: "test-script",
                input: null,
              }),
              { stopReason: "toolUse" },
            ),
      );
      const runtime = await open(test);
      const value = await submit(runtime, "Safe error classification");
      const results = resultMessages(value);
      expect(JSON.stringify(results)).toContain(
        error.name === "AbortError" ? "cancelled" : "runtime_unavailable",
      );
      expect(JSON.stringify(results)).not.toContain("private-secret");
    }
  });

  it("runs two child delegations concurrently and propagates parent cancellation down the native ownership tree", async () => {
    const test = await setup();
    const entered = deferred<void>();
    const release = deferred<void>();
    let count = 0;
    const childCalls: string[] = [];
    responses(test, async (transcript) => {
      const user = JSON.stringify(
        transcript.messages.filter((message) => message.role === "user"),
      );
      if (user.includes("parallel-child")) {
        childCalls.push(user);
        if (++count === 2) entered.resolve();
        await release.promise;
        return fauxAssistantMessage("Parallel child response");
      }
      return fauxAssistantMessage(
        [
          fauxToolCall("delegate", {
            roleId: "reviewer",
            task: "parallel-child-a",
          }),
          fauxToolCall("delegate", {
            roleId: "reviewer",
            task: "parallel-child-b",
          }),
        ],
        { stopReason: "toolUse" },
      );
    });
    const runtime = await open(test);
    const submission = await runtime.service.submit(
      {
        scope,
        caller,
        input: {
          conversationId: runtime.root.id,
          submission: { type: "input", content: "Parent concurrent work" },
        },
      },
      context,
    );
    await entered.promise;
    const children = await test.options.storage.scanConversations(
      { ownerConversationId: runtime.root.id },
      10,
      undefined,
      context,
    );
    expect(children.items).toHaveLength(2);
    expect(new Set(children.items.map((child) => child.id)).size).toBe(2);
    expect(childCalls).toHaveLength(2);
    const cancelling = runtime.service.cancel(
      { scope, caller, input: { conversationId: runtime.root.id } },
      context,
    );
    release.resolve();
    await cancelling;
    expect(
      (
        await (
          await runtime.harness.submission(submission, context)
        )?.wait(context)
      )?.status,
    ).toBe("unanswered");
    expect((await runtime.harness.inspect(context)).tasks).toEqual([]);
  });
});
