import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";
import Type, { type Static, type TSchema } from "typebox";
import Value from "typebox/value";
import { parseDocument } from "yaml";
import type {
  DefinitionBundle,
  DefinitionDiagnostic,
  DefinitionFile,
  RoleDefinition,
  SkillDefinition,
  WorkflowDefinition,
} from "./types.js";

const id = Type.String({ pattern: "^[a-z][a-z0-9-]*$" });
const text = Type.String({ minLength: 1 });
const strings = Type.Array(text, { uniqueItems: true });
const scripts = Type.Array(
  Type.String({ pattern: "^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$" }),
  { uniqueItems: true },
);
const model = Type.Object(
  { provider: text, modelId: text },
  { additionalProperties: false },
);
const defaults = {
  model: Type.Optional(model),
  thinkingLevel: Type.Optional(
    Type.Union(
      ["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) =>
        Type.Literal(level),
      ),
    ),
  ),
};
const squadSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id,
    projectId: id,
    title: text,
    defaults: Type.Optional(
      Type.Object(defaults, { additionalProperties: false }),
    ),
  },
  { additionalProperties: false },
);
const roleSchema = Type.Object(
  {
    id,
    title: text,
    skills: Type.Array(id, { uniqueItems: true }),
    extensions: strings,
    tools: strings,
    scripts,
    ...defaults,
  },
  { additionalProperties: false },
);
const skillSchema = Type.Object(
  {
    name: id,
    description: text,
    frogie: Type.Optional(
      Type.Object(
        {
          scripts: Type.Array(
            Type.Object(
              {
                id,
                entry: text,
                runtime: Type.Literal("node"),
                replay: Type.Literal("safe"),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
const workflowSchema = Type.Object(
  {
    id,
    title: text,
    entry: id,
    nodes: Type.Array(
      Type.Object(
        {
          id,
          title: text,
          role: id,
          position: Type.Object(
            { x: Type.Number(), y: Type.Number() },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    edges: Type.Array(
      Type.Object(
        { source: id, target: id, label: Type.Optional(Type.String()) },
        { additionalProperties: false },
      ),
    ),
    tools: Type.Optional(strings),
    scripts: Type.Optional(scripts),
  },
  { additionalProperties: false },
);

export class DefinitionError extends Error {
  constructor(public readonly diagnostic: DefinitionDiagnostic) {
    super(`${diagnostic.path}: ${diagnostic.message}`);
    this.name = "DefinitionError";
  }
}

function fail(
  path: string,
  code: string,
  message: string,
  field?: string,
): never {
  throw new DefinitionError({
    path,
    code,
    message,
    ...(field === undefined ? {} : { field }),
  });
}

function parse<T extends TSchema>(
  file: DefinitionFile,
  schema: T,
): { metadata: Static<T>; content: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(
    file.content,
  );
  if (!match)
    fail(file.path, "frontmatter", "Missing or malformed YAML frontmatter");
  const document = parseDocument(match[1] ?? "", { uniqueKeys: true });
  const error = document.errors[0] ?? document.warnings[0];
  if (error) {
    throw new DefinitionError({
      path: file.path,
      code: "yaml",
      message: `YAML parse error: ${error.message}`,
      ...(error.linePos === undefined
        ? {}
        : { line: error.linePos[0].line + 1 }),
    });
  }
  let metadata: unknown;
  try {
    metadata = document.toJS({ maxAliasCount: 100 });
  } catch {
    fail(file.path, "yaml", "YAML alias expansion exceeds the permitted limit");
  }
  if (!Value.Check(schema, metadata)) {
    const errors = Value.Errors(schema, metadata);
    fail(
      file.path,
      "schema",
      errors
        .map(
          (issue) =>
            `${issue.instancePath || "frontmatter"}: ${issue.message} ${JSON.stringify(issue.params)}`,
        )
        .join("; "),
      errors[0]?.instancePath,
    );
  }
  return { metadata, content: match[2] ?? "" };
}

function unique(path: string, ids: string[], kind: string): void {
  if (new Set(ids).size !== ids.length)
    fail(path, "duplicate", `Duplicate ${kind} identifier`);
}

function validateWorkflow(
  file: DefinitionFile,
  roles: Set<string>,
): WorkflowDefinition {
  const { metadata, content } = parse(file, workflowSchema);
  if (`${metadata.id}.md` !== basename(file.path))
    fail(file.path, "id", "Workflow ID must match its filename", "id");
  unique(
    file.path,
    metadata.nodes.map((node) => node.id),
    "node",
  );
  const nodes = new Map(metadata.nodes.map((node) => [node.id, node]));
  const entry = nodes.get(metadata.entry);
  if (!entry) fail(file.path, "entry", "Unknown entry node", "entry");
  for (const node of metadata.nodes) {
    if (!roles.has(node.role))
      fail(
        file.path,
        "reference",
        `Unknown Role ${node.role}`,
        `nodes/${node.id}/role`,
      );
  }
  unique(
    file.path,
    metadata.edges.map((edge) => `${edge.source}/${edge.target}`),
    "edge",
  );
  for (const edge of metadata.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target))
      fail(file.path, "edge", "Unknown edge endpoint node", "edges");
  }
  const reached = new Set<string>();
  const pending = [metadata.entry];
  while (pending.length) {
    const current = pending.pop();
    if (current === undefined || reached.has(current)) continue;
    reached.add(current);
    for (const edge of metadata.edges)
      if (edge.source === current) pending.push(edge.target);
  }
  if (reached.size !== nodes.size)
    fail(
      file.path,
      "unreachable",
      "Workflow contains unreachable nodes",
      "nodes",
    );
  const sections: string[] = [];
  const steps: string[] = [];
  let section = "";
  let fence: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^## (.+?)\s*$/.exec(line)?.[1];
    if (heading) {
      section = heading;
      sections.push(heading);
    }
    const step = /^### (.+?)\s*$/.exec(line)?.[1];
    if (section === "步骤" && step) steps.push(step);
  }
  unique(file.path, sections, "body section");
  for (const required of ["目标", "输入", "步骤", "输出", "验收要点"]) {
    if (!sections.includes(required))
      fail(file.path, "body", `Missing body section ${required}`);
  }
  unique(file.path, steps, "node body section");
  if (steps.length !== nodes.size || steps.some((step) => !nodes.has(step)))
    fail(file.path, "body", "Node body sections must match the workflow nodes");
  return {
    ...metadata,
    content,
    entryRole: entry.role,
    participants: [...new Set(metadata.nodes.map((node) => node.role))],
  };
}

export function loadDefinition(root: string): DefinitionBundle {
  const files: DefinitionFile[] = [];
  const bytesByPath = new Map<string, Buffer>();
  const directories = new Set<string>();
  const hash = createHash("sha256");
  function visit(path: string): void {
    try {
      const absolute = join(root, path);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink())
        fail(path || ".", "symlink", "Symbolic links are not allowed");
      if (stat.isDirectory()) {
        directories.add(path);
        for (const name of readdirSync(absolute).sort())
          visit(path ? `${path}/${name}` : name);
      } else if (stat.isFile()) {
        const bytes = readFileSync(absolute);
        bytesByPath.set(path, bytes);
        const encoding = isUtf8(bytes) ? "utf8" : "base64";
        if (path.endsWith(".md") && encoding !== "utf8")
          fail(path, "encoding", "Markdown files must contain valid UTF-8");
        const mode = stat.mode & 0o777;
        files.push({ path, content: bytes.toString(encoding), encoding, mode });
      } else
        fail(path, "file", "Only regular files and directories are allowed");
    } catch (error) {
      if (error instanceof DefinitionError) throw error;
      fail(path || ".", "io", `Unable to read definition: ${String(error)}`);
    }
  }
  visit("");
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  for (const file of files) {
    const bytes = bytesByPath.get(file.path) as Buffer;
    hash.update(JSON.stringify([file.path, file.mode, bytes.length]));
    hash.update(bytes);
  }
  for (const path of directories) {
    if (
      path === "" ||
      ["roles", "skills", "workflows"].includes(path) ||
      path.startsWith("roles/") ||
      path.startsWith("skills/")
    )
      continue;
    fail(path, "path", "Unexpected directory in definition tree");
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  function required(path: string): DefinitionFile {
    const file = byPath.get(path);
    if (!file) fail(path, "missing", "Required definition file is missing");
    return file;
  }
  const { metadata: squad, content } = parse(required("SQUAD.md"), squadSchema);
  const rolePaths = [...directories].filter((path) =>
    path.startsWith("roles/"),
  );
  const roots = rolePaths.filter((path) => dirname(path) === "roles");
  if (roots.length !== 1)
    fail("roles", "root", "Exactly one root role is required");
  const roles: RoleDefinition[] = rolePaths.map((path) => {
    const { metadata, content } = parse(
      required(`${path}/ROLE.md`),
      roleSchema,
    );
    if (metadata.id !== basename(path))
      fail(`${path}/ROLE.md`, "id", "Role ID must match its directory", "id");
    return {
      ...metadata,
      content,
      parentRoleId: dirname(path) === "roles" ? null : basename(dirname(path)),
    };
  });
  unique(
    "roles",
    roles.map((role) => role.id),
    "Role",
  );
  const skills: SkillDefinition[] = [...directories]
    .filter((path) => dirname(path) === "skills")
    .map((path) => {
      const file = required(`${path}/SKILL.md`);
      const { metadata, content } = parse(file, skillSchema);
      if (metadata.name !== basename(path))
        fail(file.path, "id", "Skill name must match its directory", "name");
      const declared = metadata.frogie?.scripts ?? [];
      unique(
        file.path,
        declared.map((script) => script.id),
        "Script",
      );
      for (const script of declared) {
        if (
          posix.isAbsolute(script.entry) ||
          script.entry.includes("\\") ||
          script.entry
            .split("/")
            .some((part) => part === ".." || part === "." || part === "") ||
          script.entry.includes("\0")
        )
          fail(
            file.path,
            "path",
            "Script entry must be a relative path inside its Skill",
            "frogie/scripts",
          );
        const entry = required(`${path}/${script.entry}`);
        if (entry.encoding !== "utf8")
          fail(
            entry.path,
            "encoding",
            "Declared scripts must contain valid UTF-8",
          );
      }
      return {
        id: metadata.name,
        description: metadata.description,
        content,
        scripts: declared,
      };
    });
  const skillIds = new Set(skills.map((skill) => skill.id));
  const scriptIds = new Set(
    skills.flatMap((skill) =>
      skill.scripts.map((script) => `${skill.id}/${script.id}`),
    ),
  );
  for (const role of roles) {
    const path = `${rolePaths[roles.indexOf(role)]}/ROLE.md`;
    for (const skill of role.skills)
      if (!skillIds.has(skill))
        fail(path, "reference", `Unknown Skill ${skill}`, "skills");
    for (const script of role.scripts)
      if (!scriptIds.has(script))
        fail(path, "reference", `Unknown Script ${script}`, "scripts");
  }
  const roleIds = new Set(roles.map((role) => role.id));
  const workflows = files
    .filter(
      (file) => dirname(file.path) === "workflows" && file.path.endsWith(".md"),
    )
    .map((file) => validateWorkflow(file, roleIds));
  for (const workflow of workflows) {
    for (const script of workflow.scripts ?? [])
      if (!scriptIds.has(script))
        fail(
          `workflows/${workflow.id}.md`,
          "reference",
          `Unknown Script ${script}`,
          "scripts",
        );
  }
  for (const file of files) {
    if (
      file.path === "SQUAD.md" ||
      (file.path.startsWith("roles/") && basename(file.path) === "ROLE.md") ||
      (file.path.startsWith("skills/") && file.path.split("/").length >= 3) ||
      (dirname(file.path) === "workflows" && file.path.endsWith(".md"))
    )
      continue;
    fail(file.path, "path", "Unexpected file in definition tree");
  }
  return {
    schemaVersion: 1,
    squadId: squad.id,
    projectId: squad.projectId,
    title: squad.title,
    content,
    ...(squad.defaults === undefined ? {} : { defaults: squad.defaults }),
    rootRoleId: basename(roots[0] as string),
    roles,
    skills,
    workflows,
    files,
    contentHash: hash.digest("hex"),
  };
}
