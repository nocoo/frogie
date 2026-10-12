import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { loadDefinition } from "@frogie/core/definitions";
import { expect, type Locator, test } from "@playwright/test";
import { startDaemon } from "../../daemon/src/daemon.js";
import { createDefinitionWorkspace } from "../../daemon/src/server/definitions.js";
import { startLocalServer } from "../../daemon/src/server/localServer.js";

const fixture = fileURLToPath(
  new URL("../../../tests/fixtures/minimal-squad", import.meta.url),
);

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected visible canvas element");
  return box;
}

test("Workflow graph and source edits persist through refresh without changing the existing Harness binding", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const runId = randomUUID();
  await mkdir(resolve("data/e2e"), { recursive: true });
  const parent = await realpath(resolve("data/e2e"));
  const root = join(parent, runId);
  const definitionsDirectory = join(root, "workspace", "squads");
  const squadDirectory = join(definitionsDirectory, "minimal-squad");
  const workflowPath = join(squadDirectory, "workflows", "review.md");
  const rolePath = "roles/command/reviewer/ROLE.md";
  await mkdir(root);
  await writeFile(join(root, "owner.json"), JSON.stringify({ runId, root }), {
    flag: "wx",
    mode: 0o600,
  });
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let server: Awaited<ReturnType<typeof startLocalServer>> | undefined;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const errors: string[] = [];
  context.on("page", (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" ||
        message.text().includes("trying to drag a node that is not initialized")
      )
        errors.push(message.text());
    });
  });
  const fixtureWorkflow = await readFile(
    join(fixture, "workflows", "review.md"),
    "utf8",
  );
  const fixtureRole = await readFile(join(fixture, rolePath), "utf8");
  try {
    await cp(fixture, squadDirectory, { recursive: true });
    daemon = await startDaemon({
      directory: root,
      definitionsDirectory,
      mode: "e2e",
    });
    server = await startLocalServer({
      directory: daemon,
      context: BACKGROUND_CONTEXT,
      definitions: createDefinitionWorkspace(definitionsDirectory),
      publicDirectory: resolve("apps/dashboard/dist"),
      port: 0,
    });
    expect(Number(new URL(server.origin).port)).toBeGreaterThan(0);
    expect(new URL(server.origin).port).not.toBe("27033");
    const originalProject = (await daemon.listProjects())[0];
    if (!originalProject) throw new Error("Missing registered fixture project");
    expect(originalProject.state).toBe("running");
    const scope = originalProject.scope;
    const harnessDirectory = join(
      root,
      "projects",
      scope.projectId,
      "environments",
      scope.environmentId,
      "harnesses",
      scope.harnessId,
    );
    const originalBinding = await readFile(
      join(harnessDirectory, "binding.json"),
      "utf8",
    );
    const frozenWorkflow = await readFile(
      join(harnessDirectory, "definition", "workflows", "review.md"),
      "utf8",
    );
    const originalDescription = await daemon
      .runtime(scope)
      .describe(
        { scope, caller: { id: "workflow-browser-owner" }, input: {} },
        BACKGROUND_CONTEXT,
      );
    const originalConversations = await daemon
      .runtime(scope)
      .listConversations(
        { scope, caller: { id: "workflow-browser-owner" }, input: {} },
        BACKGROUND_CONTEXT,
      );
    const page = await context.newPage();
    await page.goto(server.url);
    await expect(
      page.getByRole("combobox", { name: "Squad", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "工作流", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Workflow", exact: true }),
    ).toContainText("Review");
    const inspect = page.locator('.react-flow__node[data-id="inspect"]');
    const report = page.locator('.react-flow__node[data-id="report"]');
    await expect(inspect).toBeVisible();
    await expect(report).toBeVisible();
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
    await test.step("Dragging an unselected node preserves the viewport and keeps the inspector closed", async () => {
      const viewport = page.locator(".react-flow__viewport");
      const inspector = page.locator(".frogie-workflow-inspector");
      await expect(inspect).not.toHaveClass(/\bselected\b/);
      await expect(inspector).toHaveCount(0);
      const viewportTransform = await viewport.evaluate(
        (element) => getComputedStyle(element).transform,
      );
      const nodeTransform = await inspect.evaluate(
        (element) => getComputedStyle(element).transform,
      );
      const original = await bounds(inspect);
      const start = { x: original.x + original.width / 2, y: original.y + 20 };
      const armed = { x: start.x + 5, y: start.y };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      try {
        // React Flow anchors the drag at the first move past its threshold.
        await page.mouse.move(armed.x, armed.y);
        await page.mouse.move(armed.x + 60, armed.y + 40, { steps: 12 });
        await expect
          .poll(async () => (await bounds(inspect)).x - original.x)
          .toBeCloseTo(60, 0);
        await expect
          .poll(async () => (await bounds(inspect)).y - original.y)
          .toBeCloseTo(40, 0);
        await expect(viewport).toHaveCSS("transform", viewportTransform);
        await expect(inspector).toHaveCount(0);
        await expect(inspect).not.toHaveClass(/\bselected\b/);
        await page.mouse.move(armed.x, armed.y, { steps: 12 });
      } finally {
        await page.mouse.up();
      }
      await expect(inspect).toHaveCSS("transform", nodeTransform);
      await expect(viewport).toHaveCSS("transform", viewportTransform);
      await expect(inspector).toHaveCount(0);
      await expect(inspect).not.toHaveClass(/\bselected\b/);
    });
    await inspect.click();
    const x = page.getByRole("spinbutton", { name: "X 坐标", exact: true });
    const y = page.getByRole("spinbutton", { name: "Y 坐标", exact: true });
    await expect(x).toHaveValue("80");
    await expect(y).toHaveValue("120");
    const nodeBox = await bounds(inspect);
    await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(nodeBox.x + nodeBox.width / 2 + 90, nodeBox.y + 75, {
      steps: 12,
    });
    await page.mouse.up();
    await expect.poll(async () => Number(await x.inputValue())).not.toBe(80);
    await expect.poll(async () => Number(await y.inputValue())).not.toBe(120);
    const movedPosition = {
      x: Number(await x.inputValue()),
      y: Number(await y.inputValue()),
    };
    const source = await bounds(report.locator(".react-flow__handle.source"));
    const target = await bounds(inspect.locator(".react-flow__handle.target"));
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
    const save = page.getByRole("button", { name: "保存工作流", exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(save).toBeDisabled();
    await expect(page.getByText("未保存", { exact: true })).toHaveCount(0);
    const savedGraph = loadDefinition(squadDirectory).workflows[0];
    expect(
      savedGraph?.nodes.find((node) => node.id === "inspect")?.position,
    ).toEqual(movedPosition);
    expect(savedGraph?.edges).toContainEqual({
      source: "report",
      target: "inspect",
    });
    const savedMarkdown = await readFile(workflowPath, "utf8");
    expect(savedMarkdown).not.toBe(fixtureWorkflow);
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Squad", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "工作流", exact: true }).click();
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
    await inspect.click();
    await expect(x).toHaveValue(String(movedPosition.x));
    await expect(y).toHaveValue(String(movedPosition.y));
    await page
      .getByRole("button", { name: "打开 Role 定义文件", exact: true })
      .click();
    const editor = page.getByRole("textbox", {
      name: "Markdown 源码",
      exact: true,
    });
    await expect(page.locator(".frogie-definition-path")).toHaveText(rolePath);
    await expect(editor).toHaveValue(fixtureRole);
    await page
      .getByRole("button", { name: "workflows/review.md", exact: true })
      .click();
    await expect(editor).toHaveValue(savedMarkdown);
    const updatedMarkdown = savedMarkdown.replace(
      "Return evidence",
      "Reviewed evidence persists",
    );
    expect(updatedMarkdown).not.toBe(savedMarkdown);
    await editor.fill(updatedMarkdown);
    await page.getByRole("button", { name: "保存定义", exact: true }).click();
    await expect(page.getByText("未保存", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "工作流", exact: true }).click();
    await expect(
      page
        .locator(".react-flow__edge-text")
        .filter({ hasText: "Reviewed evidence persists" }),
    ).toBeVisible();
    expect(loadDefinition(squadDirectory).workflows[0]?.edges).toContainEqual({
      source: "inspect",
      target: "report",
      label: "Reviewed evidence persists",
    });
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Squad", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "工作流", exact: true }).click();
    await expect(
      page
        .locator(".react-flow__edge-text")
        .filter({ hasText: "Reviewed evidence persists" }),
    ).toBeVisible();
    await inspect.click();
    await expect(x).toHaveValue(String(movedPosition.x));
    await expect(y).toHaveValue(String(movedPosition.y));
    const latestDefinition = loadDefinition(squadDirectory);
    expect(latestDefinition.contentHash).not.toBe(
      originalProject.definitionHash,
    );
    const currentProject = (await daemon.listProjects()).find(
      (project) => project.projectId === scope.projectId,
    );
    expect(currentProject?.scope).toEqual(scope);
    expect(currentProject?.definitionHash).toBe(originalProject.definitionHash);
    expect(currentProject?.rootConversationId).toBe(
      originalProject.rootConversationId,
    );
    expect(await readFile(join(harnessDirectory, "binding.json"), "utf8")).toBe(
      originalBinding,
    );
    expect(
      await readFile(
        join(harnessDirectory, "definition", "workflows", "review.md"),
        "utf8",
      ),
    ).toBe(frozenWorkflow);
    expect(
      (
        await daemon
          .runtime(scope)
          .describe(
            { scope, caller: { id: "workflow-browser-owner" }, input: {} },
            BACKGROUND_CONTEXT,
          )
      ).bindingHash,
    ).toBe(originalDescription.bindingHash);
    expect(
      await daemon
        .runtime(scope)
        .listConversations(
          { scope, caller: { id: "workflow-browser-owner" }, input: {} },
          BACKGROUND_CONTEXT,
        ),
    ).toEqual(originalConversations);
    expect(
      await readFile(join(fixture, "workflows", "review.md"), "utf8"),
    ).toBe(fixtureWorkflow);
    expect(await readFile(join(fixture, rolePath), "utf8")).toBe(fixtureRole);
    await page.screenshot({
      path: testInfo.outputPath("workflow-persisted.png"),
    });
    await page
      .getByRole("button", { name: "切换浅色与深色主题", exact: true })
      .click();
    await expect(page.locator("html")).toHaveClass(/light/);
    await page
      .getByRole("button", { name: "切换浅色与深色主题", exact: true })
      .click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({
      path: testInfo.outputPath("workflow-dark.png"),
    });
    await expect
      .poll(() =>
        page.locator(".react-flow").evaluate((element) => {
          const root = getComputedStyle(document.documentElement);
          const canvas = getComputedStyle(element);
          return [
            "--basalt-secondary",
            "--basalt-foreground",
            "--basalt-primary",
          ].every(
            (token) =>
              canvas.getPropertyValue(token).trim() ===
              root.getPropertyValue(token).trim(),
          );
        }),
      )
      .toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".frogie-workflow-canvas")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    const canvas = await bounds(page.locator(".frogie-workflow-canvas"));
    expect(canvas.x).toBeGreaterThanOrEqual(0);
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(390);
    await y.scrollIntoViewIfNeeded();
    await expect(y).toHaveValue(String(movedPosition.y));
    await page.screenshot({
      path: testInfo.outputPath("workflow-mobile-dark.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    await testInfo.attach("workflow-persistence", {
      body: JSON.stringify(
        {
          runId,
          scope,
          movedPosition,
          sourceHash: latestDefinition.contentHash,
          boundHash: originalProject.definitionHash,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    try {
      await context.close();
    } finally {
      try {
        await server?.close();
      } finally {
        await daemon?.close();
      }
    }
    const ownerPath = join(root, "owner.json");
    const info = await lstat(ownerPath);
    expect(info.isFile() && !info.isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(ownerPath, "utf8"))).toEqual({
      runId,
      root,
    });
    expect(await realpath(root)).toBe(root);
    if (daemon)
      expect(await realpath(definitionsDirectory)).toBe(definitionsDirectory);
    await rm(root, { recursive: true });
  }
});
