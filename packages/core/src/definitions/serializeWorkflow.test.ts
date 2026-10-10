import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { loadDefinition } from "./loadDefinition.js";
import { serializeWorkflow } from "./serializeWorkflow.js";

const source = fileURLToPath(
  new URL("../../../../tests/fixtures/minimal-squad", import.meta.url),
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("workflow Markdown serialization", () => {
  it("round trips all graph semantics through the actual definition loader", async () => {
    const definition = loadDefinition(source);
    const workflow = definition.workflows[0];
    if (!workflow) throw new Error("Missing Workflow fixture");
    const root = await mkdtemp(join(tmpdir(), "frogie-workflow-serialize-"));
    roots.push(root);
    await cp(source, root, { recursive: true });
    const body = `${workflow.content}\n\nA preserved code example:\n\n\`\`\`md\n### example\n## Not a real section\n\`\`\`\n`;
    const original = { ...workflow, content: body, tools: [], scripts: [] };
    const before = structuredClone(original);
    const markdown = serializeWorkflow(original);
    await writeFile(join(root, "workflows/review.md"), markdown);
    const loaded = loadDefinition(root).workflows[0];
    expect(loaded).toEqual(original);
    expect(original).toEqual(before);
    expect(markdown.endsWith(body)).toBe(true);
    const header = markdown.match(/^---\n([\s\S]*?)\n---\n/u)?.[1];
    if (!header) throw new Error("Missing YAML frontmatter");
    const fields = parseDocument(header).toJS();
    expect(fields).not.toHaveProperty("entryRole");
    expect(fields).not.toHaveProperty("participants");
    expect(fields).not.toHaveProperty("content");
    expect(fields).toMatchObject({ tools: [], scripts: [] });
  });

  it("uses stable node and edge ordering without changing body or optional capability semantics", () => {
    const workflow = loadDefinition(source).workflows[0];
    if (!workflow) throw new Error("Missing Workflow fixture");
    const forward = {
      ...workflow,
      title: 'Review: "evidence"',
      edges: [
        ...workflow.edges,
        { source: "report", target: "inspect", label: "Review again" },
      ],
    };
    const reversed = {
      ...forward,
      nodes: [...forward.nodes].reverse(),
      edges: [...forward.edges].reverse(),
    };
    expect(serializeWorkflow(reversed)).toBe(serializeWorkflow(forward));
    const markdown = serializeWorkflow(forward);
    expect(markdown).not.toMatch(/^tools:/m);
    expect(markdown).not.toMatch(/^scripts:/m);
    expect(markdown.endsWith(forward.content)).toBe(true);
  });
});
