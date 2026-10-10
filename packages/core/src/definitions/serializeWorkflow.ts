import { stringify } from "yaml";
import type { WorkflowDefinition } from "./types.js";

export function serializeWorkflow(workflow: WorkflowDefinition): string {
  const metadata = {
    id: workflow.id,
    title: workflow.title,
    entry: workflow.entry,
    nodes: [...workflow.nodes]
      .sort((left, right) => left.id.localeCompare(right.id, "en"))
      .map((node) => ({
        id: node.id,
        title: node.title,
        role: node.role,
        position: { x: node.position.x, y: node.position.y },
      })),
    edges: [...workflow.edges]
      .sort(
        (left, right) =>
          left.source.localeCompare(right.source, "en") ||
          left.target.localeCompare(right.target, "en"),
      )
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        ...(edge.label === undefined ? {} : { label: edge.label }),
      })),
    ...(workflow.tools === undefined ? {} : { tools: workflow.tools }),
    ...(workflow.scripts === undefined ? {} : { scripts: workflow.scripts }),
  };
  return `---\n${stringify(metadata, { lineWidth: 0 })}---\n${workflow.content}`;
}
