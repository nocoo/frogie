import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DefinitionView, type DefinitionViewProps } from "./DefinitionView.js";

const baseProps: DefinitionViewProps = {
  title: "Definitions",
  files: [
    { path: "SQUAD.md", title: "Squad" },
    { path: "roles/command/ROLE.md", title: "Command" },
  ],
  selectedPath: "SQUAD.md",
  markdown: "# Squad\n\nShared mission.",
  draft: "# Squad\n\nEdited mission.",
  dirty: true,
  loading: false,
  saving: false,
  creating: false,
  canSave: true,
  canCreate: true,
  error: null,
  onFileSelect: () => undefined,
  onDraftChange: () => undefined,
  onSave: () => undefined,
  onCreate: () => undefined,
};

function render(overrides: Partial<DefinitionViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(DefinitionView, { ...baseProps, ...overrides }),
  );
}

function button(html: string, name: RegExp): string | undefined {
  return [...html.matchAll(/<button\b[^>]*>/g)]
    .map(([tag]) => tag)
    .find((tag) => name.test(tag.match(/aria-label="([^"]*)"/i)?.[1] ?? ""));
}

function isDisabled(tag: string | undefined): boolean {
  return tag !== undefined && /\sdisabled(?:[ =]|>)/i.test(tag);
}

describe("DefinitionView", () => {
  it("renders the definition title and selectable file names", () => {
    const html = render();
    expect(html).toContain("Definitions");
    expect(html).toContain("Squad");
    expect(html).toContain("Command");
    expect(html).toMatch(/<nav\b|<select\b/);
    expect(html).toMatch(/aria-label=/i);
  });

  it("renders the controlled draft in an accessible editor", () => {
    const html = render();
    expect(html).toMatch(/<textarea\b/);
    expect(html).toMatch(/aria-label=/i);
    expect(html).toContain("Edited mission.");
    expect(html).not.toContain("Shared mission.");
  });

  it("renders Markdown source as escaped text rather than executable HTML", () => {
    const html = render({
      markdown: "<script>alert(1)</script>",
      draft: "<img src=x onerror=alert(1)>",
    });
    expect(html).not.toMatch(/<img\b[^>]*src=x/i);
    expect(html).not.toMatch(/<script\b[^>]*>alert\(1\)/i);
  });

  it("renders dirty state and an accessible save action", () => {
    const html = render();
    expect(html).toMatch(/Unsaved|unsaved|未保存|未儲存/i);
    expect(button(html, /save|保存|儲存/i)).toBeDefined();
  });

  it("renders errors accessibly", () => {
    const html = render({ error: "Could not save definition" });
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain("Could not save definition");
  });

  it.each([
    ["loading", { loading: true }, /Loading|加载中|載入中/i],
    ["saving", { saving: true }, /Saving|保存中|儲存中/i],
    ["creating", { creating: true }, /Creating|创建中|建立中|創建中/i],
  ] as const)("announces the %s state", (_state, props, label) => {
    const html = render(props);
    expect(html).toMatch(/role="status"|aria-live=/i);
    expect(html).toMatch(label);
  });

  it("disables save when the draft cannot be saved", () => {
    expect(
      isDisabled(button(render({ canSave: false }), /save|保存|儲存/i)),
    ).toBe(true);
  });
});
