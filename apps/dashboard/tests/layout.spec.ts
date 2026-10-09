import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
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
import { test as base, expect, type Locator } from "@playwright/test";
import { createDefinitionWorkspace } from "../src/server/definitions.js";
import { startLocalServer } from "../src/server/localServer.js";

const test = base.extend<{ local: { url: string; directory: string } }>({
  local: async ({ browserName }, use) => {
    expect(browserName).toBe("chromium");
    const parent = resolve("data/e2e");
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(join(parent, "layout-"));
    const squads = join(directory, "squads");
    await cp(
      fileURLToPath(
        new URL("../../../tests/fixtures/minimal-squad", import.meta.url),
      ),
      join(squads, "minimal-squad"),
      { recursive: true },
    );
    const definition = loadDefinition(join(squads, "minimal-squad"));
    const scope = {
      environmentId: "e2e",
      squadId: definition.squadId,
      harnessId: "layout-test",
    };
    const faux = fauxProvider({
      provider: "fixture",
      models: [{ id: "test", reasoning: true }],
      tokensPerSecond: 1_000_000,
    });
    const reply: FauxResponseFactory = () => {
      faux.appendResponses([reply]);
      return fauxAssistantMessage("Layout verified.\n\n".repeat(50));
    };
    faux.setResponses([reply]);
    const models = createModels();
    models.setProvider(faux.provider);
    const runtime = await openRuntime(
      {
        runtimeId: "layout-test",
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
        storage: await openNodeSqliteStorage(join(directory, "session.sqlite")),
      },
      BACKGROUND_CONTEXT,
    );
    let server: Awaited<ReturnType<typeof startLocalServer>> | undefined;
    try {
      server = await startLocalServer({
        instanceId: "layout-test",
        scope,
        service: runtime.service,
        context: BACKGROUND_CONTEXT,
        definitions: createDefinitionWorkspace(squads),
        publicDirectory: resolve("apps/dashboard/dist"),
        port: 27033,
      });
      await use({ url: server.url, directory });
    } finally {
      await server?.close();
      await runtime.close(BACKGROUND_CONTEXT);
      await rm(directory, { recursive: true, force: true });
    }
  },
});

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error("Expected a visible element");
  return bounds;
}

async function readableGreen(locator: Locator) {
  const colors = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  const rgb = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
  const background = rgb(colors.background);
  expect(background[1]).toBeGreaterThan(background[0] ?? 255);
  expect(background[1]).toBeGreaterThan(background[2] ?? 255);
  expect(Math.min(...background.slice(0, 3))).toBeGreaterThan(120);
  const luminance = (value: string) =>
    rgb(value)
      .slice(0, 3)
      .reduce((sum, channel, index) => {
        const normalized = channel / 255;
        const linear =
          normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
      }, 0);
  const a = luminance(colors.background);
  const b = luminance(colors.foreground);
  expect(
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
  ).toBeGreaterThanOrEqual(4.5);
}

test("desktop shell geometry, bounded chat, editor and theme retain real interactions", async ({
  page,
  local,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(local.url);
  const squad = page.getByRole("combobox", { name: "Squad", exact: true });
  await expect(squad).toBeEnabled();
  const rail = page.locator("aside").first();
  const island = page.locator("[data-basalt-island]");
  const environment = page.getByRole("button", {
    name: "运行环境",
    exact: true,
  });
  const environmentBox = await box(environment);
  expect(environmentBox.x).toBeGreaterThan(1000);
  expect(environmentBox.y).toBeLessThan(52);
  const avatar = rail.getByRole("img", { name: "本地用户头像", exact: true });
  expect((await box(avatar)).y).toBeGreaterThan(900);
  await environment.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  for (const name of ["Local", "E2E", "Prod"]) {
    await expect(
      menu.getByRole("menuitemradio", { name, exact: true }),
    ).toBeDisabled();
  }
  await expect(
    menu.getByRole("menuitemradio", { name: "Local", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.screenshot({
    path: testInfo.outputPath("environment-desktop.png"),
  });
  await page.keyboard.press("Escape");
  await expect(environment).toBeFocused();
  await expect(
    page.getByRole("link", { name: "Frogie on Hexly", exact: true }),
  ).toHaveAttribute("href", "https://hexly.ai/projects/frogie");
  expect((await box(rail)).width).toBe(260);
  const selector = await box(squad);
  expect(selector.x).toBeGreaterThanOrEqual(8);
  expect(selector.x + selector.width).toBeLessThanOrEqual(252);
  const inset = await box(island);
  expect(inset.x).toBeGreaterThan(260);
  expect(inset.x + inset.width).toBeLessThan(1440);
  expect(inset.y + inset.height).toBeLessThan(1000);
  await expect(
    rail.getByRole("button", { name: "收起导航", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("overview-desktop.png") });
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await readableGreen(page.getByRole("button", { name: "对话", exact: true }));
  const conversation = await box(
    page.getByRole("combobox", { name: "选择会话", exact: true }),
  );
  const compact = await box(
    page.getByRole("button", { name: "压缩上下文", exact: true }),
  );
  expect(Math.abs(conversation.y - compact.y)).toBeLessThan(3);
  await expect(
    page.getByRole("button", { name: "新建 Squad", exact: true }),
  ).toHaveCount(0);
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  const position = await box(composer);
  expect(position.y).toBeGreaterThan(750);
  expect(position.y + position.height).toBeLessThan(1000);
  await composer.fill("Verify the scroll owner.");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.getByText("Layout verified.", { exact: true }).first(),
  ).toBeAttached();
  await expect(composer).toBeInViewport();
  const scroll = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
    viewport: innerHeight,
  }));
  expect(scroll.height).toBeLessThanOrEqual(scroll.viewport);
  expect(scroll.width).toBe(1440);
  await page.screenshot({ path: testInfo.outputPath("chat-desktop.png") });
  await page.getByRole("button", { name: "定义", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Markdown 源码",
    exact: true,
  });
  await expect(editor).toBeVisible();
  expect((await box(editor)).height).toBeGreaterThan(450);
  const original = await editor.inputValue();
  await editor.fill(`${original}\nLayout edit persisted.\n`);
  const save = page.getByRole("button", { name: "保存定义", exact: true });
  await expect(save).toBeInViewport();
  await save.click();
  await expect(page.getByText("未保存", { exact: true })).toHaveCount(0);
  expect(
    await readFile(
      join(local.directory, "squads/minimal-squad/SQUAD.md"),
      "utf8",
    ),
  ).toContain("Layout edit persisted.");
  await page.screenshot({
    path: testInfo.outputPath("definitions-desktop.png"),
  });
  await rail.getByRole("button", { name: "收起导航", exact: true }).click();
  await expect.poll(async () => (await box(rail)).width).toBe(68);
  await expect(avatar).toBeVisible();
  await rail.getByRole("button", { name: "展开导航", exact: true }).click();
  await expect.poll(async () => (await box(rail)).width).toBe(260);
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await page
    .getByRole("button", { name: "切换浅色与深色主题", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page
    .getByRole("button", { name: "切换浅色与深色主题", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await readableGreen(page.getByRole("button", { name: "对话", exact: true }));
  await page.getByRole("button", { name: "定义", exact: true }).click();
  await expect(editor).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("definitions-dark.png") });
  await page.reload();
  await expect(squad).toBeEnabled();
  expect(errors).toEqual([]);
});

test("mobile navigation restores focus and editor and composer stay usable", async ({
  page,
  local,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(local.url);
  const environment = page.getByRole("button", {
    name: "运行环境",
    exact: true,
  });
  await expect(environment).toBeInViewport();
  await expect(
    page.getByRole("link", { name: "Frogie on Hexly", exact: true }),
  ).toBeInViewport();
  await environment.click();
  await expect(page.getByRole("menu")).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("environment-mobile.png"),
  });
  await page.keyboard.press("Escape");
  await expect(environment).toBeFocused();
  const menu = page.getByRole("button", { name: "展开导航", exact: true });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(
    page.getByRole("combobox", { name: "Squad", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Squad", exact: true }),
  ).not.toBeVisible();
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(composer).toBeInViewport();
  await composer.fill("Mobile conversation");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.getByText("Layout verified.", { exact: true }).first(),
  ).toBeAttached();
  await expect(composer).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({ path: testInfo.outputPath("chat-mobile.png") });
  await menu.click();
  await page.getByRole("button", { name: "定义", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Markdown 源码",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "返回文件列表", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole("button", { name: /SQUAD.md/ }).click();
  await expect(editor).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: testInfo.outputPath("definitions-mobile.png"),
  });
});
