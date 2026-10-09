import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatView, type ChatViewProps } from "./ChatView.js";

const baseProps: ChatViewProps = {
  title: "Command conversation",
  entries: [
    { id: "user-1", variant: "user", content: "Review <mission> & report" },
    {
      id: "assistant-1",
      variant: "assistant",
      author: "Command",
      content: "Plan is ready.",
    },
  ],
  draft: "Draft message",
  loading: false,
  sending: false,
  running: false,
  compacting: false,
  canSend: true,
  canStop: true,
  canCompact: true,
  error: null,
  onDraftChange: () => undefined,
  onSend: () => undefined,
  onStop: () => undefined,
  onCompact: () => undefined,
};

function render(overrides: Partial<ChatViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(ChatView, { ...baseProps, ...overrides }),
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

describe("ChatView", () => {
  it("renders the conversation title and entries with escaped user content", () => {
    const html = render();
    expect(html).toContain("Command conversation");
    expect(html).toContain("Review &lt;mission&gt; &amp; report");
    expect(html).not.toContain("Review <mission>");
    expect(html).toContain("Plan is ready.");
  });

  it("does not render executable HTML from untrusted Markdown", () => {
    const html = render({
      entries: [
        {
          id: "untrusted",
          variant: "assistant",
          content: "<img src=x onerror=alert(1)> **not rendered as markup**",
        },
      ],
    });
    expect(html).not.toMatch(/<img\b[^>]*src=x/i);
    expect(html).not.toMatch(/<script\b[^>]*>alert\(1\)/i);
  });

  it("renders a controlled draft and an accessible composer", () => {
    const html = render();
    expect(html).toMatch(/<textarea\b/);
    expect(html).toMatch(/aria-label=/i);
    expect(html).toContain("Draft message");
  });

  it("renders the accessible send action while idle and stop action while streaming", () => {
    const idle = render();
    const send = button(idle, /send|发送/i);
    expect(send).toBeDefined();
    expect(isDisabled(send)).toBe(false);
    expect(button(idle, /stop|cancel|停止/i)).toBeUndefined();
    expect(button(idle, /compact|压缩/i)).toBeDefined();

    const streaming = render({ running: true });
    expect(button(streaming, /send|发送/i)).toBeUndefined();
    const stop = button(streaming, /stop|cancel|停止/i);
    expect(stop).toBeDefined();
    expect(isDisabled(stop)).toBe(false);
  });

  it("disables only the relevant action while sending or compacting", () => {
    const sending = render({ sending: true });
    expect(isDisabled(button(sending, /send|发送/i))).toBe(true);

    const compacting = render({ running: true, compacting: true });
    expect(isDisabled(button(compacting, /compact|压缩/i))).toBe(true);
  });

  it("keeps the stop action enabled when a run is active during compaction", () => {
    const html = render({ running: true, compacting: true });
    expect(isDisabled(button(html, /stop|cancel|停止/i))).toBe(false);
  });

  it.each([
    ["loading", { loading: true }, /Loading|加载中|載入中/i],
    ["sending", { sending: true }, /Sending|发送中|送信中/i],
    ["running", { running: true }, /Running|运行中|執行中/i],
    ["compacting", { compacting: true }, /Compacting|压缩中|壓縮中/i],
  ] as const)("announces the %s state", (_state, props, label) => {
    const html = render(props);
    expect(html).toMatch(/role="status"|aria-live=/i);
    expect(html).toMatch(label);
  });

  it("renders errors accessibly", () => {
    const html = render({ error: "Submission failed" });
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain("Submission failed");
  });
});
