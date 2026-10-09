import type { ObservationFrame } from "@frogie/core/protocol";
import type { ChatViewEntry } from "../views/ChatView.js";

export interface ChatProjection {
  entries: ChatViewEntry[];
  running: boolean;
  compacting: boolean;
}

function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export function projectChat(view: ObservationFrame["value"]): ChatProjection {
  const entries: ChatViewEntry[] = [];
  for (const entry of view.entries) {
    for (const [index, message] of (entry.model ?? []).entries()) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      const content = text(message.content);
      if (content)
        entries.push({
          id: `${entry.id}:${index}`,
          variant: message.role,
          content,
        });
    }
  }
  const live = view.docs["pi.live"];
  const generation = live?.generation;
  const partial =
    typeof generation === "object" &&
    generation !== null &&
    !Array.isArray(generation)
      ? generation.message
      : undefined;
  if (
    typeof partial === "object" &&
    partial !== null &&
    !Array.isArray(partial) &&
    partial.role === "assistant"
  ) {
    const content = text(partial.content);
    if (content)
      entries.push({
        id: `live:${view.conversation.id}:assistant`,
        variant: "assistant",
        content,
        streaming: true,
      });
  }
  return {
    entries,
    running: live?.run !== undefined,
    compacting: Array.isArray(live?.compactions) && live.compactions.length > 0,
  };
}
