import { fileURLToPath } from "node:url";
import { type DefinitionBundle, loadDefinition } from "../definitions/index.js";

export interface HisfmPrompts {
  coordinator: string;
  executor: string;
  reviewer: string;
  speech: string;
  voiceComparison: string;
  capabilities: string;
  network: string;
  decisionPlan: string;
  decisionThinking: string;
  compaction: string;
  editorial: string;
  boundary: string;
  brief: string;
  script: string;
  cover: string;
  description: string;
}

const squadDirectory = fileURLToPath(
  new URL(
    import.meta.url.endsWith(".ts")
      ? "../../../../squads/hisfm"
      : "../../squads/hisfm",
    import.meta.url,
  ),
);

export const executorTools = ["read", "write", "edit", "bash", "submit_result"];

export function loadHisfmDefinition(
  directory = squadDirectory,
): DefinitionBundle {
  return loadDefinition(directory);
}

export function loadHisfmPrompts(directory = squadDirectory): {
  defaultPrompts: HisfmPrompts;
  channelDefault: string;
  narrationStyle: string;
} {
  const definition = loadHisfmDefinition(directory);
  const role = (id: string) => {
    const found = definition.roles.find((item) => item.id === id);
    if (!found) throw new Error(`Missing his.fm role: ${id}`);
    return found.content;
  };
  const resource = (name: string) => {
    const path = `skills/prompt-catalog/resources/${name}.md`;
    const file = definition.files.find((item) => item.path === path);
    if (file?.encoding !== "utf8")
      throw new Error(`Missing his.fm prompt resource: ${path}`);
    return file.content;
  };
  return {
    defaultPrompts: {
      coordinator: role("coordinator"),
      executor: role("writer"),
      reviewer: role("reviewer"),
      speech: role("speech"),
      voiceComparison: resource("voice-comparison"),
      capabilities: resource("capabilities"),
      network: resource("network"),
      decisionPlan: resource("decision-plan"),
      decisionThinking: resource("decision-thinking"),
      compaction: resource("compaction"),
      editorial: resource("editorial"),
      boundary: resource("boundary"),
      brief: resource("brief"),
      script: resource("script"),
      cover: resource("cover"),
      description: resource("description"),
    },
    channelDefault: definition.content,
    narrationStyle: resource("narration-style"),
  };
}

export function workPolicy(prompts: HisfmPrompts, role: string): string {
  return role === "speech"
    ? prompts.speech
    : [
        prompts.executor,
        role === "reviewer" ? prompts.reviewer : "",
        prompts.editorial,
        prompts.boundary,
      ]
        .filter(Boolean)
        .join("\n");
}
