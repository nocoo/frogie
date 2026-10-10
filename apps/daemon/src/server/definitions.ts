import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, posix, resolve } from "node:path";
import {
  type DefinitionBundle,
  type DefinitionFile,
  loadDefinition,
} from "@frogie/core/definitions";

export interface DefinitionDraft {
  readonly path: string;
  readonly content: string;
  readonly baseContent: string;
}

export interface DefinitionWorkspace {
  list(): Promise<readonly { id: string; projectId: string; title: string }[]>;
  load(squadId: string): Promise<DefinitionBundle>;
  save(
    squadId: string,
    draft: DefinitionDraft,
    requestId: string,
  ): Promise<DefinitionBundle>;
}

const squadIdPattern = /^[a-z][a-z0-9-]*$/u;
const noFollow = constants.O_RDONLY | constants.O_NOFOLLOW;

function conflict(): Error {
  return Object.assign(
    new Error("Definition file changed since it was loaded"),
    {
      code: "conflict",
    },
  );
}

function validateSquadId(squadId: string): void {
  if (!squadIdPattern.test(squadId)) throw new TypeError("Invalid Squad ID");
}

function validateDraftPath(path: string): string[] {
  if (
    path.length === 0 ||
    path.includes("\\") ||
    path.includes("\0") ||
    posix.isAbsolute(path) ||
    !path.endsWith(".md")
  ) {
    throw new TypeError("Only relative Markdown paths can be saved");
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new TypeError("Invalid Markdown path");
  }
  return segments;
}

function utf8Bytes(content: string): Buffer {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.toString("utf8") !== content)
    throw new TypeError("Invalid UTF-8 content");
  return bytes;
}

async function readRegularFile(
  path: string,
): Promise<{ bytes: Buffer; mode: number }> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new TypeError("Markdown target must be a regular file");
  const file = await open(path, noFollow);
  try {
    return { bytes: await file.readFile(), mode: stat.mode & 0o777 };
  } finally {
    await file.close();
  }
}

async function assertRealDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new TypeError("Definition path must be a real directory");
}

async function rebuildCandidate(
  directory: string,
  files: readonly DefinitionFile[],
  changedPath: string,
  content: Buffer,
): Promise<void> {
  for (const file of files) {
    const target = join(directory, ...file.path.split("/"));
    await mkdir(
      posix.dirname(file.path) === "."
        ? directory
        : join(directory, ...posix.dirname(file.path).split("/")),
      { recursive: true },
    );
    const bytes =
      file.path === changedPath
        ? content
        : file.encoding === "base64"
          ? Buffer.from(file.content, "base64")
          : utf8Bytes(file.content);
    await writeFile(target, bytes, { mode: file.mode });
    await chmod(target, file.mode);
  }
}

export function createDefinitionWorkspace(root: string): DefinitionWorkspace {
  const authorizedRoot = resolve(root);
  let saveQueue: Promise<void> = Promise.resolve();

  const rootDirectory = async (): Promise<void> =>
    assertRealDirectory(authorizedRoot);

  const squadDirectory = async (squadId: string): Promise<string> => {
    validateSquadId(squadId);
    await rootDirectory();
    const directory = join(authorizedRoot, squadId);
    await assertRealDirectory(directory);
    return directory;
  };

  const load = async (squadId: string): Promise<DefinitionBundle> => {
    const directory = await squadDirectory(squadId);
    const definition = loadDefinition(directory);
    if (definition.squadId !== squadId)
      throw new TypeError("Squad ID does not match its directory");
    return definition;
  };

  const save = async (
    squadId: string,
    draft: DefinitionDraft,
    requestId: string,
  ): Promise<DefinitionBundle> => {
    if (requestId.trim().length === 0)
      throw new TypeError("A request ID is required");
    const segments = validateDraftPath(draft.path);
    const currentDirectory = await squadDirectory(squadId);
    const currentDefinition = loadDefinition(currentDirectory);
    if (currentDefinition.squadId !== squadId)
      throw new TypeError("Squad ID does not match its directory");
    const knownFile = currentDefinition.files.find(
      (file) => file.path === draft.path,
    );
    if (knownFile?.encoding !== "utf8")
      throw new TypeError("Only existing UTF-8 Markdown files can be saved");

    let parent = currentDirectory;
    for (const segment of segments.slice(0, -1)) {
      parent = join(parent, segment);
      await assertRealDirectory(parent);
    }
    const target = join(currentDirectory, ...segments);
    const initial = await readRegularFile(target);
    const desiredBytes = utf8Bytes(draft.content);
    const baseBytes = utf8Bytes(draft.baseContent);
    if (initial.bytes.equals(desiredBytes)) return currentDefinition;
    if (!initial.bytes.equals(baseBytes)) throw conflict();

    const candidateRoot = await mkdtemp(
      join(tmpdir(), "frogie-definition-candidate-"),
    );
    const temporaryTarget = join(
      authorizedRoot,
      `.${squadId}.${basename(target)}.${randomUUID()}.tmp`,
    );
    let temporaryCreated = false;
    try {
      await rebuildCandidate(
        candidateRoot,
        currentDefinition.files,
        draft.path,
        desiredBytes,
      );
      const candidate = loadDefinition(candidateRoot);
      if (candidate.squadId !== squadId)
        throw new TypeError("Candidate Squad ID does not match its directory");

      const staged = await open(temporaryTarget, "wx", initial.mode);
      temporaryCreated = true;
      try {
        await staged.writeFile(desiredBytes);
        await staged.chmod(initial.mode);
      } finally {
        await staged.close();
      }

      await squadDirectory(squadId);
      let verifiedParent = currentDirectory;
      for (const segment of segments.slice(0, -1)) {
        verifiedParent = join(verifiedParent, segment);
        await assertRealDirectory(verifiedParent);
      }
      const latestDefinition = loadDefinition(currentDirectory);
      if (latestDefinition.contentHash !== currentDefinition.contentHash)
        throw conflict();
      const current = await readRegularFile(target);
      if (!current.bytes.equals(baseBytes)) throw conflict();

      await rename(temporaryTarget, target);
      temporaryCreated = false;
      return candidate;
    } finally {
      if (temporaryCreated) await rm(temporaryTarget, { force: true });
      await rm(candidateRoot, { recursive: true, force: true });
    }
  };

  return {
    async list() {
      await rootDirectory();
      const entries = await readdir(authorizedRoot, { withFileTypes: true });
      const squads = entries
        .filter(
          (entry) => entry.isDirectory() && squadIdPattern.test(entry.name),
        )
        .sort((a, b) => a.name.localeCompare(b.name, "en"));
      const summaries: { id: string; projectId: string; title: string }[] = [];
      for (const entry of squads) {
        const definition = await load(entry.name);
        summaries.push({
          id: definition.squadId,
          projectId: definition.projectId,
          title: definition.title,
        });
      }
      return summaries;
    },
    load,
    save(squadId, draft, requestId) {
      const next = saveQueue.then(() => save(squadId, draft, requestId));
      saveQueue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}
