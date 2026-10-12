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
import { localDirectory } from "../../../tests/fixtures/local-directory.js";
import { createDefinitionWorkspace } from "../../daemon/src/server/definitions.js";
import { startLocalServer } from "../../daemon/src/server/localServer.js";

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
      projectId: definition.projectId,
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
        directory: localDirectory("layout-test", scope, runtime.service),
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

async function surfaceLuminance(locator: Locator) {
  return locator.evaluate((element) => {
    const channels = getComputedStyle(element)
      .backgroundColor.match(/[\d.]+/g)
      ?.map(Number);
    if (!channels || channels.length < 3 || (channels[3] ?? 1) !== 1)
      throw new Error("Expected an opaque surface");
    return channels.slice(0, 3).reduce((sum, channel, index) => {
      const value = channel / 255;
      const linear =
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
    }, 0);
  });
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

async function readableControl(locator: Locator) {
  await expect
    .poll(async () =>
      locator
        .evaluate((element) => {
          const rgb = (value: string) =>
            value.match(/[\d.]+/g)?.map(Number) ?? [];
          let surface: Element | null = element;
          let background: number[] = [];
          while (surface) {
            const color = rgb(getComputedStyle(surface).backgroundColor);
            if (color.length === 3 || color[3] === 1) {
              background = color;
              break;
            }
            surface = surface.parentElement;
          }
          const style = getComputedStyle(element);
          const foreground = rgb(style.color);
          const luminance = (color: number[]) =>
            color.slice(0, 3).reduce((sum, channel, index) => {
              const value = channel / 255;
              const linear =
                value <= 0.04045
                  ? value / 12.92
                  : ((value + 0.055) / 1.055) ** 2.4;
              return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
            }, 0);
          const a = luminance(background);
          const b = luminance(foreground);
          const icon = element.querySelector("svg");
          return {
            foreground: style.color,
            background,
            stroke: icon ? getComputedStyle(icon).stroke : style.color,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        })
        .then((result) =>
          result.background.length >= 3 && result.stroke === result.foreground
            ? result.ratio
            : 0,
        ),
    )
    .toBeGreaterThanOrEqual(4.5);
}

test("header icons remain readable when the system starts dark and after theme changes", async ({
  page,
  local,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(local.url);
  await expect(
    page.getByRole("combobox", { name: "Squad", exact: true }),
  ).toBeEnabled();
  const header = page.locator("[data-basalt-header]");
  const actions = [
    header.getByRole("link", { name: "Frogie GitHub 仓库", exact: true }),
    header.getByRole("link", { name: "Frogie on Hexly", exact: true }),
    header.getByRole("button", { name: "切换浅色与深色主题", exact: true }),
  ];
  for (const [index, theme] of ["dark", "light", "dark"].entries()) {
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    for (const action of actions) {
      await readableControl(action);
      await action.hover();
      await readableControl(action);
      await page.mouse.move(0, 0);
      await action.focus();
      await readableControl(action);
    }
    await header.screenshot({
      path: testInfo.outputPath(`header-${theme}.png`),
    });
    const environment = header.getByRole("radiogroup", {
      name: "运行环境",
      exact: true,
    });
    for (const name of ["Local", "E2E"]) {
      const option = environment.getByRole("radio", { name, exact: true });
      await expect(option).toBeDisabled();
      await expect(option).toHaveAttribute(
        "aria-checked",
        String(name === "E2E"),
      );
      const foreground = await option.evaluate(
        (element) => getComputedStyle(element).color,
      );
      expect(foreground).not.toBe("rgb(0, 0, 0)");
    }
    if (index < 2) await actions[2]?.click();
  }
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  for (const action of actions) await readableControl(action);
});

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
  const environment = page.getByRole("radiogroup", {
    name: "运行环境",
    exact: true,
  });
  const environmentBox = await box(environment);
  expect(environmentBox.x).toBeGreaterThan(1000);
  const headerBox = await box(page.locator("[data-basalt-header]"));
  expect(environmentBox.height).toBeLessThanOrEqual(36);
  expect(environmentBox.y - headerBox.y).toBeGreaterThanOrEqual(8);
  expect(
    headerBox.y + headerBox.height - environmentBox.y - environmentBox.height,
  ).toBeGreaterThanOrEqual(8);
  await expect(environment.getByRole("radio")).toHaveCount(2);
  await expect(
    environment.getByRole("radio", { name: "Prod", exact: true }),
  ).toHaveCount(0);
  const avatar = rail.getByRole("img", { name: "本地用户头像", exact: true });
  expect((await box(avatar)).y).toBeGreaterThan(900);
  for (const name of ["Local", "E2E"]) {
    await expect(
      environment.getByRole("radio", { name, exact: true }),
    ).toBeDisabled();
  }
  await expect(
    environment.getByRole("radio", { name: "E2E", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.screenshot({
    path: testInfo.outputPath("environment-desktop.png"),
  });
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
  const role = await box(
    page.getByRole("combobox", { name: "选择角色", exact: true }),
  );
  expect(Math.abs(conversation.y - role.y)).toBeLessThan(3);
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
  const environment = page.getByRole("radiogroup", {
    name: "运行环境",
    exact: true,
  });
  await expect(environment).toBeInViewport();
  await expect(
    page.getByRole("link", { name: "Frogie on Hexly", exact: true }),
  ).toBeInViewport();
  for (const name of ["Local", "E2E"]) {
    await expect(
      environment.getByRole("radio", { name, exact: true }),
    ).toBeInViewport();
  }
  await page.screenshot({
    path: testInfo.outputPath("environment-mobile.png"),
  });
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

for (const width of [1440, 1024]) {
  test(`execution details preserve chat DOM, scroll and draft at ${width}px`, async ({
    page,
    local,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(local.url);
    await expect(
      page.getByRole("combobox", { name: "Squad", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "对话", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    const log = page.getByRole("log", { name: "消息记录", exact: true });
    const toggle = page.getByRole("button", { name: "执行详情", exact: true });
    const details = page.locator("#execution-details");
    const initiallyOpen = width >= 1200;
    await expect(toggle).toHaveAttribute(
      "aria-expanded",
      String(initiallyOpen),
    );
    await expect(details).toBeVisible({ visible: initiallyOpen });
    await expect(page.locator('label[for="chat-conversation"]')).toHaveText(
      "选择会话",
    );
    await expect(page.locator('label[for="chat-role"]')).toHaveText("选择角色");
    await composer.fill("Scroll test.");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(
      log.getByText("Layout verified.", { exact: true }),
    ).toHaveCount(50);
    await expect(
      page.getByRole("button", { name: "停止当前工作", exact: true }),
    ).toHaveCount(0);
    await expect(composer).toBeEnabled();
    const draft = "Unsent draft stays here.";
    await composer.fill(draft);
    const originalLog = await log.evaluateHandle((element) => element);
    const scrollTop = await log.evaluate((element) => {
      element.scrollTop = 120;
      return element.scrollTop;
    });
    expect(scrollTop).toBeGreaterThan(0);
    try {
      for (const open of [!initiallyOpen, initiallyOpen]) {
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", String(open));
        await expect(details).toBeAttached();
        await expect(details).toBeVisible({ visible: open });
        expect(
          await log.evaluate(
            (element, original) => element === original,
            originalLog,
          ),
        ).toBe(true);
        await expect
          .poll(() => log.evaluate((element) => element.scrollTop))
          .toBeCloseTo(scrollTop, 0);
        await expect(composer).toHaveValue(draft);
        await expect(composer).toBeInViewport();
      }
    } finally {
      await originalLog.dispose();
    }
  });
}

test("definition panes and outlined workflow nodes retain surface hierarchy in both themes", async ({
  page,
  local,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(local.url);
  await expect(
    page.getByRole("combobox", { name: "Squad", exact: true }),
  ).toBeEnabled();
  const island = page.locator("[data-basalt-island]");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await page.getByRole("button", { name: "定义", exact: true }).click();
    const files = page.locator(".frogie-definition-files");
    const editor = page.locator(".frogie-definition-editor");
    await expect(files).toBeVisible();
    await expect(editor).toBeVisible();
    const filesBox = await box(files);
    expect((await box(editor)).x - filesBox.x - filesBox.width).toBeGreaterThan(
      0,
    );
    for (const card of [files, editor]) {
      await expect
        .poll(
          async () =>
            (await surfaceLuminance(card)) - (await surfaceLuminance(island)),
        )
        .toBeGreaterThan(0);
    }
    await page.getByRole("button", { name: "工作流", exact: true }).click();
    const inspector = page.locator(".frogie-workflow-inspector");
    const canvas = page.locator(".react-flow");
    const node = page.locator('.react-flow__node[data-id="inspect"]');
    const surface = node.locator(".frogie-workflow-node");
    await expect(node).toBeVisible();
    await expect(inspector).toHaveCount(0);
    await expect(surface).not.toHaveCSS("box-shadow", "none");
    await expect
      .poll(
        async () =>
          (await surfaceLuminance(canvas)) - (await surfaceLuminance(island)),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          (await surfaceLuminance(surface)) - (await surfaceLuminance(canvas)),
      )
      .toBeGreaterThan(0);
    await node.click();
    await expect(inspector).toBeVisible();
    await inspector.getByRole("button", { name: "收起", exact: true }).click();
    await expect(inspector).toHaveCount(0);
  }
});
