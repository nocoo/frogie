import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppView, type AppViewProps } from "./AppView.js";

const baseProps: AppViewProps = {
  version: "0.1.0",
  logoSrc: "/logo.svg",
  page: "overview" as const,
  mode: "e2e" as const,
  squads: [{ id: "zeppelin", title: "Zeppelin" }],
  selectedSquadId: "zeppelin",
  busy: false,
  error: null,
  onPageChange: () => undefined,
  onModeChange: () => undefined,
  onSquadChange: () => undefined,
  onCreateSquad: () => undefined,
};

function render(
  overrides: Partial<AppViewProps> = {},
  children?: string,
): string {
  return renderToStaticMarkup(
    createElement(AppView, { ...baseProps, ...overrides }, children),
  );
}

describe("AppView", () => {
  it("renders the Frogie brand, version, Squad selector and E2E mode", () => {
    const html = render();
    expect(html).toContain("Frogie");
    expect(html).toContain("0.1.0");
    expect(html).toContain("Zeppelin");
    expect(html).toMatch(/E2E/i);
    expect(html).toMatch(/<nav\b/);
  });

  it.each([
    ["overview", /Overview|概览/i],
    ["definitions", /Definitions|定义/i],
    ["workflows", /Workflows|工作流/i],
    ["chat", /Chat|对话/i],
    ["evals", /Evals|评估/i],
  ] as const)(
    "provides an accessible navigation item for %s",
    (page, label) => {
      const html = render({ page });
      expect(html).toMatch(/<nav\b[^>]*aria-label=/i);
      expect(html).toMatch(/<a\b|<button\b/);
      expect(html).toMatch(label);
    },
  );

  it("renders an error as an accessible alert", () => {
    const html = render({ error: "Definition could not be loaded" });
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain("Definition could not be loaded");
  });

  it("renders page content", () => {
    expect(render({}, "Current page content")).toContain(
      "Current page content",
    );
  });
});
