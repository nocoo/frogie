import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { RuntimeEntry } from "@frogie/core/protocol";
import { expect, type Page, test } from "@playwright/test";
import { startDaemon } from "../../daemon/src/daemon.js";
import { createDefinitionWorkspace } from "../../daemon/src/server/definitions.js";
import { startLocalServer } from "../../daemon/src/server/localServer.js";

const artifactContent = "Evidence produced by the real child tool.\n";
const answer = "Parent read the real child artifact";
const childTask = "inspection-child-task";
const fixture = fileURLToPath(
  new URL("../../../tests/fixtures/minimal-squad", import.meta.url),
);

async function modelServer() {
  const requests: unknown[] = [];
  const errors: string[] = [];
  let held: ServerResponse | undefined;
  let released = false;
  const modelId = "inspection-fixture";
  const respond = (
    response: ServerResponse,
    text: string,
    tool?: { id: string; name: string; arguments: unknown },
  ) => {
    const chunk = {
      id: "chatcmpl-inspection",
      object: "chat.completion.chunk",
      created: 1,
      model: modelId,
    };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({
        ...chunk,
        choices: [
          {
            index: 0,
            delta: tool
              ? {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: tool.id,
                      type: "function",
                      function: {
                        name: tool.name,
                        arguments: JSON.stringify(tool.arguments),
                      },
                    },
                  ],
                }
              : { role: "assistant", content: text },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
    response.end(
      `data: ${JSON.stringify({
        ...chunk,
        choices: [
          { index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
      })}\n\ndata: [DONE]\n\n`,
    );
  };
  const writeArtifact = (response: ServerResponse) =>
    respond(response, "", {
      id: "call_child_write",
      name: "write_artifact",
      arguments: { name: "evidence.md", content: artifactContent },
    });
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages: { role: string; content: string; tool_call_id?: string }[];
      };
      requests.push(body);
      if (requests.length > 5)
        throw new Error("Unexpected extra model request");
      const results = body.messages.filter(
        (message) => message.role === "tool",
      );
      if (
        body.messages.some(
          (message) =>
            message.role === "user" &&
            JSON.stringify(message.content).includes(childTask),
        )
      ) {
        if (results.length) respond(response, "Child saved evidence");
        else if (released) writeArtifact(response);
        else held = response;
      } else if (!results.length) {
        respond(response, "", {
          id: "call_delegate",
          name: "delegate",
          arguments: { roleId: "reviewer", task: childTask },
        });
      } else if (
        !results.some((result) => result.tool_call_id === "call_read")
      ) {
        const delegated = results.find(
          (result) => result.tool_call_id === "call_delegate",
        );
        if (!delegated) throw new Error("Missing real delegation result");
        const value = JSON.parse(delegated.content) as {
          artifacts: { id: string }[];
        };
        const artifact = value.artifacts[0];
        if (!artifact) throw new Error("Missing real child artifact");
        respond(response, "", {
          id: "call_read",
          name: "read_artifact",
          arguments: { id: artifact.id },
        });
      } else respond(response, answer);
    })().catch((error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
      response.writeHead(500).end();
    });
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  return {
    requests,
    errors,
    model: {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      apiKey: "inspection-fixture-key",
      modelId,
      contextWindow: 32_000,
      maxTokens: 1024,
      thinkingLevel: "off" as const,
    },
    get childWaiting() {
      return held !== undefined;
    },
    release() {
      released = true;
      if (held && !held.destroyed) writeArtifact(held);
      held = undefined;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
    },
  };
}

async function selectConversation(page: Page, id: number) {
  const selector = page.getByRole("combobox", {
    name: "选择会话",
    exact: true,
  });
  await expect(selector).toBeEnabled();
  await selector.fill(`会话 ${id}`);
  await page.getByRole("option", { name: `会话 ${id}`, exact: true }).click();
  await expect(selector).toHaveValue(`会话 ${id}`);
}

test("execution inspection shows native delegation, tool results and persisted history in the real Dashboard", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const runId = randomUUID();
  await mkdir(resolve("data/e2e"), { recursive: true });
  const root = join(await realpath(resolve("data/e2e")), runId);
  const definitionsDirectory = join(root, "workspace/squads");
  await mkdir(root);
  const owner = { runId, root };
  await writeFile(join(root, "owner.json"), JSON.stringify(owner), {
    flag: "wx",
    mode: 0o600,
  });
  let model: Awaited<ReturnType<typeof modelServer>> | undefined;
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let server: Awaited<ReturnType<typeof startLocalServer>> | undefined;
  try {
    const squadDirectory = join(definitionsDirectory, "minimal-squad");
    await cp(fixture, squadDirectory, { recursive: true });
    for (const [path, tools] of [
      ["roles/command/ROLE.md", "delegate, read_artifact"],
      ["roles/command/reviewer/ROLE.md", "write_artifact"],
    ] as const) {
      const filename = join(squadDirectory, path);
      await writeFile(
        filename,
        (await readFile(filename, "utf8"))
          .replace("extensions: []", "extensions: [frogie]")
          .replace("tools: []", `tools: [${tools}]`),
      );
    }
    model = await modelServer();
    const configuration = {
      directory: join(root, "daemon"),
      definitionsDirectory,
      mode: "local" as const,
      model: model.model,
    };
    const launch = async () => {
      daemon = await startDaemon(configuration);
      server = await startLocalServer({
        directory: daemon,
        context: BACKGROUND_CONTEXT,
        definitions: createDefinitionWorkspace(definitionsDirectory),
        publicDirectory: resolve("apps/dashboard/dist"),
        port: 0,
      });
      return { daemon, server };
    };
    const initial = await launch();
    const project = (await initial.daemon.listProjects())[0];
    if (!project?.rootConversationId)
      throw new Error("Missing running project");
    expect(project.state).toBe("running");
    const conversationId =
      project.rootConversationId as RuntimeEntry["conversationId"];
    const call = {
      scope: project.scope,
      caller: { id: "inspection-test-owner" },
    };
    const service = initial.daemon.runtime(project.scope);
    await page.goto(initial.server.url);
    await expect(
      page.getByRole("combobox", { name: "Squad", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "对话", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    const panel = page.getByRole("region", { name: "任务详情", exact: true });
    await expect(composer).toBeEnabled();
    await composer.fill("Inspect the delegated evidence.");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => model?.childWaiting).toBe(true);
    const delegateButton = panel.getByRole("button", {
      name: /^delegate · \d+$/,
    });
    await expect(delegateButton).toBeEnabled();
    await panel
      .getByRole("button", { name: "Harness live TaskGraph", exact: true })
      .click();
    const graph = panel.getByRole("region", {
      name: "Pi TaskGraph（当前 Harness）",
      exact: true,
    });
    await expect(graph).toContainText('"owner"');
    await expect(graph).toContainText('"pi.tool"');
    await delegateButton.click();
    await expect(
      panel.getByRole("region", { name: "执行参数", exact: true }),
    ).toContainText(childTask);
    await expect(
      panel.getByRole("region", { name: "Tool details", exact: true }),
    ).toContainText('"conversationId"');
    model.release();
    await expect(
      page.getByRole("log", { name: "消息记录", exact: true }),
    ).toContainText(answer);
    await expect(composer).toBeEnabled();
    const tasks = await service.listTasks(
      { ...call, input: { conversationId } },
      BACKGROUND_CONTEXT,
    );
    const delegated = tasks.items.find(
      (task) => task.tool?.name === "delegate",
    );
    const read = tasks.items.find(
      (task) => task.tool?.name === "read_artifact",
    );
    if (!delegated?.tool?.output || !read?.tool?.entryId)
      throw new Error("Missing persisted tool results");
    expect(delegated.state).toMatchObject({
      status: "terminal",
      outcome: "completed",
    });
    expect(read.tool.argumentsSource).toBe("requested");
    expect(read.tool.output).toContain(artifactContent.trim());
    const result = JSON.parse(delegated.tool.output) as {
      conversationId: number;
      artifacts: { id: string }[];
    };
    expect(result.conversationId).not.toBe(conversationId);
    expect(result.artifacts).toHaveLength(1);
    const readButton = panel.getByRole("button", {
      name: `read_artifact · ${read.id}`,
      exact: true,
    });
    await expect(readButton).toBeEnabled();
    await readButton.click();
    await expect(
      panel.getByRole("region", {
        name: "请求参数（非最终执行参数）",
        exact: true,
      }),
    ).toContainText(result.artifacts[0]?.id ?? "missing");
    await expect(
      panel.getByRole("region", { name: "Tool output", exact: true }),
    ).toContainText(artifactContent.trim());
    await panel
      .getByRole("button", { name: "Usage tokens · 费用未知", exact: true })
      .click();
    const inspection = await service.inspect(
      { ...call, input: {} },
      BACKGROUND_CONTEXT,
    );
    const totalTokens = Object.values(inspection.usage.models).reduce(
      (sum, usage) => sum + usage.totalTokens,
      0,
    );
    expect(totalTokens).toBeGreaterThan(0);
    await expect(
      panel.getByText(String(totalTokens), { exact: true }),
    ).toBeVisible();
    const entries = await service.listEntries(
      { ...call, input: { conversationId } },
      BACKGROUND_CONTEXT,
    );
    await panel
      .getByRole("button", {
        name: new RegExp(`^Entry ${read.tool.entryId} · `),
      })
      .click();
    await expect(
      panel.getByRole("region", {
        name: "toolResult · read_artifact",
        exact: true,
      }),
    ).toContainText(artifactContent.trim());
    expect(model.requests).toHaveLength(5);
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Squad", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await selectConversation(page, conversationId);
    await expect(readButton).toBeEnabled();
    await readButton.click();
    await expect(
      panel.getByRole("region", { name: "Tool output", exact: true }),
    ).toContainText(artifactContent.trim());
    await page.goto("about:blank");
    await initial.server.close();
    server = undefined;
    await initial.daemon.close();
    daemon = undefined;
    const reopened = await launch();
    const restored = (await reopened.daemon.listProjects())[0];
    expect(restored?.scope).toEqual(project.scope);
    expect(restored?.rootConversationId).toBe(conversationId);
    const runtime = reopened.daemon.runtime(project.scope);
    expect(
      await runtime.listEntries(
        { ...call, input: { conversationId } },
        BACKGROUND_CONTEXT,
      ),
    ).toEqual(entries);
    expect(
      await runtime.getTask(
        { ...call, input: { taskId: read.id } },
        BACKGROUND_CONTEXT,
      ),
    ).toEqual(read);
    await page.goto(reopened.server.url);
    await expect(
      page.getByRole("combobox", { name: "Squad", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await selectConversation(page, conversationId);
    await expect(readButton).toBeEnabled();
    await readButton.click();
    await expect(
      panel.getByRole("region", { name: "Tool output", exact: true }),
    ).toContainText(artifactContent.trim());
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: testInfo.outputPath("execution-dark.png") });
    const viewport = panel.getByRole("region", {
      name: "Pi 执行观察内容",
      exact: true,
    });
    expect(
      await viewport.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("execution-mobile-dark.png"),
    });
    const geometry = await panel.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
    }));
    await testInfo.attach("execution-evidence", {
      body: JSON.stringify(
        { runId, scope: project.scope, tasks, entries, totalTokens, geometry },
        null,
        2,
      ),
      contentType: "application/json",
    });
    expect(geometry.documentWidth).toBe(390);
    expect(geometry.documentHeight).toBeLessThanOrEqual(
      geometry.viewportHeight,
    );
    expect(geometry.scrollHeight).toBeLessThanOrEqual(
      geometry.clientHeight + 1,
    );
    await expect(composer).toBeInViewport();
    const refresh = panel.getByRole("button", { name: "刷新", exact: true });
    await expect(refresh).toBeInViewport();
    const header = await refresh.boundingBox();
    const output = panel.getByRole("region", {
      name: "Tool output",
      exact: true,
    });
    await output.scrollIntoViewIfNeeded();
    await expect(output).toBeInViewport();
    await expect(refresh).toBeInViewport();
    expect(await refresh.boundingBox()).toEqual(header);
    expect(
      await viewport.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath("execution-mobile-result.png"),
    });
    expect(model.requests).toHaveLength(5);
    expect(model.errors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    try {
      await server?.close();
    } finally {
      try {
        await daemon?.close();
      } finally {
        await model?.close();
        expect(await realpath(root)).toBe(root);
        expect(
          JSON.parse(await readFile(join(root, "owner.json"), "utf8")),
        ).toEqual(owner);
        await rm(root, { recursive: true });
      }
    }
  }
});
