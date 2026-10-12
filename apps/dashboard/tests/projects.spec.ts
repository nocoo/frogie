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
import type { DaemonProject, RuntimeScope } from "@frogie/core/protocol";
import { expect, type Page, test } from "@playwright/test";
import { startDaemon } from "../../daemon/src/daemon.js";
import { createDefinitionWorkspace } from "../../daemon/src/server/definitions.js";
import { startLocalServer } from "../../daemon/src/server/localServer.js";

type Daemon = Awaited<ReturnType<typeof startDaemon>>;
type Server = Awaited<ReturnType<typeof startLocalServer>>;
const fixture = fileURLToPath(
  new URL("../../../tests/fixtures/minimal-squad", import.meta.url),
);
const definitions = [
  { projectId: "alpha-project", squadId: "alpha-squad", title: "Alpha Squad" },
  { projectId: "beta-project", squadId: "beta-squad", title: "Beta Squad" },
] as const;

async function choose(page: Page, name: string, label: string) {
  const selector = page.getByRole("combobox", { name, exact: true });
  await expect(selector).toBeEnabled();
  await selector.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(selector).toHaveText(label);
}

async function chat(page: Page, title: string, content: string) {
  await choose(page, "Squad", title);
  await page.getByRole("button", { name: "对话", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill(content);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const history = page.getByRole("log", { name: "消息记录", exact: true });
  await expect(history).toContainText(content);
  await expect(
    history.getByText(/Local Pi test reply/).filter({ hasText: content }),
  ).toBeVisible();
  await expect(composer).toBeEnabled();
}

async function project(daemon: Daemon, projectId: string) {
  const found = (await daemon.listProjects()).find(
    (project) => project.projectId === projectId,
  );
  if (!found) throw new Error(`Missing project ${projectId}`);
  return found;
}

async function history(
  daemon: Daemon,
  project: DaemonProject,
  conversationId = project.rootConversationId,
) {
  if (conversationId === undefined)
    throw new Error("Missing persisted root conversation");
  const service = daemon.runtime(project.scope);
  const watch = await service.observeConversation(
    {
      scope: project.scope,
      caller: { id: "browser-test-owner" },
      input: { conversationId: conversationId as never },
    },
    BACKGROUND_CONTEXT,
  );
  try {
    return watch.value.entries;
  } finally {
    await watch.stop();
  }
}

async function ownedRoot(root: string, runId: string) {
  const ownerPath = join(root, "owner.json");
  const info = await lstat(ownerPath);
  expect(info.isFile() && !info.isSymbolicLink()).toBe(true);
  expect(JSON.parse(await readFile(ownerPath, "utf8"))).toEqual({
    runId,
    root,
  });
  expect(await realpath(root)).toBe(root);
  expect(await realpath(join(root, "workspace", "squads"))).toBe(
    join(root, "workspace", "squads"),
  );
}

test("real daemon keeps two project histories, Role conversations and lifecycle boundaries isolated", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const runId = randomUUID();
  await mkdir(resolve("data/e2e"), { recursive: true });
  const parent = await realpath(resolve("data/e2e"));
  const root = join(parent, runId);
  const definitionsDirectory = join(root, "workspace", "squads");
  await mkdir(root);
  await writeFile(join(root, "owner.json"), JSON.stringify({ runId, root }), {
    flag: "wx",
    mode: 0o600,
  });
  for (const definition of definitions) {
    const target = join(definitionsDirectory, definition.squadId);
    await cp(fixture, target, { recursive: true });
    const path = join(target, "SQUAD.md");
    await writeFile(
      path,
      (await readFile(path, "utf8"))
        .replace("id: minimal-squad", `id: ${definition.squadId}`)
        .replace("projectId: frogie", `projectId: ${definition.projectId}`)
        .replace("title: Minimal Squad", `title: ${definition.title}`),
    );
  }
  const originalFixture = await readFile(join(fixture, "SQUAD.md"), "utf8");
  let daemon: Daemon | undefined;
  let server: Server | undefined;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  const launch = async () => {
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
    expect(new URL(server.origin).port).not.toBe("27033");
    return { daemon, server };
  };
  try {
    const initial = await launch();
    expect(initial.server.url).toBe(`${initial.server.origin}/`);
    let alpha = await project(initial.daemon, "alpha-project");
    let beta = await project(initial.daemon, "beta-project");
    const scopes: RuntimeScope[] = [alpha.scope, beta.scope];
    const rootIds = [alpha.rootConversationId, beta.rootConversationId];
    expect(alpha.rootConversationId).toBe(beta.rootConversationId);
    let page = await context.newPage();
    const localRequests: Array<{
      url: string;
      headers: Record<string, string>;
    }> = [];
    page.on("request", (request) => {
      if (new URL(request.url()).origin !== initial.server.origin) return;
      void request
        .allHeaders()
        .then((headers) => localRequests.push({ url: request.url(), headers }));
    });
    expect(await context.cookies(initial.server.origin)).toEqual([]);
    await page.goto(initial.server.url);
    const squad = page.getByRole("combobox", { name: "Squad", exact: true });
    await expect(squad).toBeEnabled();
    expect(new URL(page.url()).hash).toBe("");
    const table = page.getByRole("table", {
      name: "本机项目列表",
      exact: true,
    });
    await expect(table).toContainText("Alpha Squad");
    await expect(table).toContainText("Beta Squad");
    await test.step("Squad dropdown exposes every option and restores keyboard focus", async () => {
      expect(await squad.evaluate((element) => element.tagName)).toBe("BUTTON");
      await expect(squad.locator("svg.lucide-chevron-down")).toBeVisible();
      const selected = await squad.textContent();
      await squad.focus();
      await squad.press("Enter");
      const listbox = page.getByRole("listbox");
      await expect(listbox.getByRole("textbox")).toHaveCount(0);
      await expect(listbox.getByRole("option")).toHaveText(
        definitions.map(({ title }) => title),
      );
      for (const { title } of definitions)
        await expect(
          listbox.getByRole("option", { name: title, exact: true }),
        ).toBeVisible();
      await page.keyboard.press("b");
      await expect(
        listbox.getByRole("option", { name: "Beta Squad", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(listbox).toHaveCount(0);
      await expect(squad).toBeFocused();
      await expect(squad).toHaveText(selected ?? "");
      await squad.press("Enter");
      await page.keyboard.press("b");
      await expect(
        listbox.getByRole("option", { name: "Beta Squad", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(squad).toHaveText("Beta Squad");
      await expect(squad).toBeEnabled();
    });
    await test.step("Project action labels fit and remain reachable at desktop and tablet widths", async () => {
      await expect(table.getByRole("columnheader")).toHaveText([
        "项目 / Squad",
        "运行状态",
        "模型 / 定义版本",
        "操作",
      ]);
      const viewport = page.getByRole("region", {
        name: "项目列表",
        exact: true,
      });
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const { title } of definitions) {
          for (const name of [
            `停用项目 ${title}`,
            `进入项目 ${title}`,
            `为项目 ${title} 绑定最新定义`,
          ]) {
            const button = table.getByRole("button", { name, exact: true });
            await button.click({ trial: true });
            const geometry = await button.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const text = range.getBoundingClientRect();
              const bounds = element.getBoundingClientRect();
              return {
                lines: range.getClientRects().length,
                textHeight: text.height,
                lineHeight: Number.parseFloat(
                  getComputedStyle(element).lineHeight,
                ),
                height: bounds.height,
                contained:
                  text.left >= bounds.left && text.right <= bounds.right,
              };
            });
            expect(geometry.lines, name).toBe(1);
            expect(geometry.textHeight, name).toBeLessThanOrEqual(
              geometry.lineHeight + 1,
            );
            expect(geometry.height, name).toBeGreaterThanOrEqual(34);
            expect(geometry.contained, name).toBe(true);
          }
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBe(width);
        if (width === 1024)
          expect(
            await viewport.evaluate((element) => element.scrollLeft),
          ).toBeGreaterThan(0);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await chat(page, "Alpha Squad", "Alpha root history is private");
    await chat(page, "Beta Squad", "Beta root history is private");
    const log = page.getByRole("log", { name: "消息记录", exact: true });
    await expect(log).not.toContainText("Alpha root history is private");
    await choose(page, "Squad", "Alpha Squad");
    await expect(log).toContainText("Alpha root history is private");
    await expect(log).not.toContainText("Beta root history is private");

    await choose(page, "选择角色", "Reviewer");
    await page
      .getByRole("button", { name: "新建角色会话", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "选择会话", exact: true }),
    ).not.toHaveText(`会话 ${alpha.rootConversationId}`);
    await chat(
      page,
      "Alpha Squad",
      "Reviewer conversation has its own history",
    );
    const records = await initial.daemon
      .runtime(alpha.scope)
      .listConversations(
        { scope: alpha.scope, caller: { id: "browser-test-owner" }, input: {} },
        BACKGROUND_CONTEXT,
      );
    const reviewer = records.find(
      (record) => record.binding.roleId === "reviewer",
    );
    expect(reviewer?.conversation.id).not.toBe(alpha.rootConversationId);
    expect(JSON.stringify(await history(initial.daemon, alpha))).not.toContain(
      "Reviewer conversation has its own history",
    );
    expect(JSON.stringify(await history(initial.daemon, beta))).not.toContain(
      "Reviewer conversation has its own history",
    );
    if (!reviewer) throw new Error("Missing created Reviewer conversation");
    expect(
      JSON.stringify(
        await history(initial.daemon, alpha, reviewer.conversation.id),
      ),
    ).toContain("Reviewer conversation has its own history");

    await page.getByRole("button", { name: "概览", exact: true }).click();
    await page
      .getByRole("button", { name: "停用项目 Alpha Squad", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "启用项目 Alpha Squad", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "定义", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Markdown 源码", exact: true }),
    ).toContainText(/Alpha Squad/);
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeDisabled();
    await chat(page, "Beta Squad", "Beta continues after Alpha stopped");
    await expect(log).not.toContainText("Alpha root history is private");
    await page.getByRole("button", { name: "概览", exact: true }).click();
    await page
      .getByRole("button", { name: "启用项目 Alpha Squad", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "停用项目 Alpha Squad", exact: true }),
    ).toBeEnabled();

    await page.reload();
    expect(new URL(page.url()).hash).toBe("");
    expect(await context.cookies(initial.server.origin)).toEqual([]);
    await chat(page, "Alpha Squad", "Alpha resumed after session refresh");
    await expect(log).toContainText("Alpha root history is private");
    const savedAlpha = await history(initial.daemon, alpha);
    const savedBeta = await history(initial.daemon, beta);
    await page.close();
    page = await context.newPage();
    await page.goto(initial.server.origin);
    await choose(page, "Squad", "Beta Squad");
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await expect(
      page.getByRole("log", { name: "消息记录", exact: true }),
    ).toContainText("Beta continues after Alpha stopped");
    await expect(
      page.getByRole("log", { name: "消息记录", exact: true }),
    ).not.toContainText("Alpha root history is private");
    await page.close();
    await initial.server.close();
    server = undefined;
    await initial.daemon.close();
    daemon = undefined;

    const restarted = await launch();
    alpha = await project(restarted.daemon, "alpha-project");
    beta = await project(restarted.daemon, "beta-project");
    expect(restarted.daemon.instanceId).toBe(initial.daemon.instanceId);
    expect([alpha.scope, beta.scope]).toEqual(scopes);
    expect([alpha.rootConversationId, beta.rootConversationId]).toEqual(
      rootIds,
    );
    expect(await history(restarted.daemon, alpha)).toEqual(savedAlpha);
    expect(await history(restarted.daemon, beta)).toEqual(savedBeta);
    expect(
      JSON.stringify(
        await history(restarted.daemon, alpha, reviewer.conversation.id),
      ),
    ).toContain("Reviewer conversation has its own history");
    page = await context.newPage();
    await page.goto(restarted.server.url);
    await choose(page, "Squad", "Beta Squad");
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await expect(
      page.getByRole("log", { name: "消息记录", exact: true }),
    ).toContainText("Beta continues after Alpha stopped");
    await choose(page, "Squad", "Alpha Squad");
    await expect(
      page.getByRole("log", { name: "消息记录", exact: true }),
    ).toContainText("Alpha root history is private");
    await page.screenshot({
      path: testInfo.outputPath("projects-restarted.png"),
    });
    await expect.poll(() => localRequests.length).toBeGreaterThan(0);
    expect(
      localRequests
        .map(({ url }) => new URL(url).pathname)
        .filter((path) => path.startsWith("/__local/auth/")),
    ).toEqual([]);
    expect(
      localRequests.every(
        ({ headers }) =>
          !headers.cookie &&
          !headers.authorization &&
          !headers["x-frogie-csrf"],
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(await readFile(join(fixture, "SQUAD.md"), "utf8")).toBe(
      originalFixture,
    );
    await testInfo.attach("project-identities", {
      body: JSON.stringify(
        {
          runId,
          instanceId: restarted.daemon.instanceId,
          scopes,
          rootIds,
          reviewerConversationId: reviewer.conversation.id,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await context.close();
    try {
      await server?.close();
    } finally {
      await daemon?.close();
    }
    await ownedRoot(root, runId);
    await rm(root, { recursive: true });
  }
});
