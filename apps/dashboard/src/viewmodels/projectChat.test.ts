import type { ObservationFrame } from "@frogie/core/protocol";
import { describe, expect, it } from "vitest";
import { projectChat } from "./projectChat.js";

type View = ObservationFrame["value"];
function view(entries: unknown[] = [], docs: View["docs"] = {}): View {
  return {
    conversation: { id: 17 } as View["conversation"],
    entries: entries as View["entries"],
    docs,
  };
}

describe("native Pi chat projection", () => {
  it("keeps an idle empty conversation empty", () => {
    expect(projectChat(view())).toEqual({
      entries: [],
      running: false,
      compacting: false,
    });
  });

  it("projects text from native model messages, not entry metadata or tool payloads", () => {
    const projected = projectChat(
      view([
        {
          id: 1,
          kind: "pi.user",
          model: [{ role: "user", content: "Mission briefing" }],
        },
        {
          id: 2,
          kind: "pi.assistant",
          model: [
            {
              role: "assistant",
              content: [
                { type: "thinking", thinking: "private reasoning" },
                { type: "text", text: "Fleet " },
                {
                  type: "toolCall",
                  name: "delegate",
                  id: "tool",
                  arguments: { secret: "hidden" },
                },
                { type: "text", text: "ready." },
              ],
            },
          ],
        },
        {
          id: 3,
          kind: "pi.tool-result",
          model: [
            {
              role: "toolResult",
              content: [{ type: "text", text: "raw tool payload" }],
            },
          ],
        },
        { id: 4, kind: "custom.record", data: { text: "metadata" } },
      ]),
    );
    expect(projected.entries).toHaveLength(2);
    expect(projected.entries[0]).toMatchObject({
      variant: "user",
      content: "Mission briefing",
    });
    expect(projected.entries[1]).toMatchObject({
      variant: "assistant",
      content: "Fleet ready.",
    });
    expect(new Set(projected.entries.map(({ id }) => id)).size).toBe(2);
  });

  it("uses pi.live for partial responses, running and compaction", () => {
    const input = view([], {
      "pi.live": {
        run: { taskId: 1, inputs: [2] },
        generation: {
          attempt: 1,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Partial answer" }],
          },
        },
        compactions: [
          { taskId: 3, reason: "manual", blocking: false, attempt: 1 },
        ],
      },
    });
    const first = projectChat(input);
    expect(first).toMatchObject({
      running: true,
      compacting: true,
      entries: [
        { variant: "assistant", content: "Partial answer", streaming: true },
      ],
    });
    expect(projectChat(input)).toEqual(first);
    expect(projectChat(view([], { "pi.live": { compactions: [] } }))).toEqual({
      entries: [],
      running: false,
      compacting: false,
    });
  });

  it("ignores absent messages and text-free assistant or user messages", () => {
    expect(
      projectChat(
        view(
          [
            { id: 1, kind: "pi.user" },
            {
              id: 2,
              kind: "pi.assistant",
              model: [
                {
                  role: "assistant",
                  content: [{ type: "thinking", thinking: "reasoning" }],
                },
              ],
            },
            {
              id: 3,
              kind: "pi.user",
              model: [
                {
                  role: "user",
                  content: [
                    { type: "image", data: "raw", mimeType: "image/png" },
                  ],
                },
              ],
            },
            { id: 4, kind: "pi.system", model: [] },
          ],
          { "pi.live": { generation: { attempt: 1 } } },
        ),
      ).entries,
    ).toEqual([]);
  });

  it("ignores empty or malformed live text while retaining run activity", () => {
    for (const content of [null, [{ type: "thinking", thinking: "private" }]]) {
      expect(
        projectChat(
          view([], {
            "pi.live": {
              run: { taskId: 1, inputs: [] },
              generation: {
                attempt: 1,
                message: { role: "assistant", content },
              },
            },
          }),
        ),
      ).toEqual({ entries: [], running: true, compacting: false });
    }
  });
});
