import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import type { ArtifactRef, RuntimeScope } from "@frogie/core/protocol";

export interface ArtifactStore {
  write(input: {
    conversationId: number;
    taskId?: number;
    operationId: string;
    name: string;
    mediaType: string;
    content: string;
  }): Promise<ArtifactRef>;
  read(
    id: string,
    conversationId: number,
  ): Promise<{ ref: ArtifactRef; content: string }>;
  grant(
    ids: readonly string[],
    fromConversationId: number,
    toConversationId: number,
  ): Promise<void>;
  list(conversationId: number): Promise<readonly ArtifactRef[]>;
}

const byteLimit = 1024 * 1024;
const recordLimit = 131072;
const digestPattern = /^[a-f0-9]{64}$/u;

export function localFailure(
  code: string,
  message: string,
): Error & { code: string; retryable: false } {
  return Object.assign(new Error(message), { code, retryable: false as const });
}

function safeLocalError(error: unknown): Error {
  if (
    error instanceof Error &&
    "retryable" in error &&
    error.retryable === false
  )
    return error;
  return localFailure(
    "runtime_unavailable",
    "Local file operation could not complete",
  );
}

export function contentDigest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function scopeIdentity(scope: RuntimeScope): string {
  return JSON.stringify([
    scope.projectId,
    scope.environmentId,
    scope.squadId,
    scope.harnessId,
  ]);
}

export function utf8Content(value: string, limit = byteLimit): Buffer {
  if (typeof value !== "string")
    throw localFailure("invalid_request", "Text content is required");
  const bytes = Buffer.from(value, "utf8");
  if (bytes.toString("utf8") !== value || bytes.length > limit)
    throw localFailure(
      "invalid_request",
      "Text content is invalid or exceeds its byte limit",
    );
  return bytes;
}

export function objectId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw localFailure("invalid_request", "A positive object ID is required");
}

export async function readOwnedJSON(
  path: string,
  limit: number,
): Promise<unknown> {
  const bytes = await readOwnedBytes(path, limit);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw localFailure("binding_mismatch", "Stored local data is invalid");
  }
}

async function readOwnedBytes(path: string, limit: number): Promise<Buffer> {
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      throw localFailure("ENOENT", "Stored local data was not found");
    throw localFailure(
      "binding_mismatch",
      "Stored local data could not be opened",
    );
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit)
      throw localFailure("binding_mismatch", "Stored local data is invalid");
    const bytes = await file.readFile();
    if (
      bytes.length > limit ||
      Buffer.from(bytes.toString("utf8"), "utf8").compare(bytes) !== 0
    )
      throw localFailure("binding_mismatch", "Stored local data is invalid");
    return bytes;
  } finally {
    await file.close();
  }
}

export async function atomicLocalJSON(
  path: string,
  value: unknown,
): Promise<void> {
  return atomicLocalBytes(path, Buffer.from(JSON.stringify(value), "utf8"));
}

async function atomicLocalBytes(path: string, bytes: Buffer): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw localFailure("binding_mismatch", "Stored local data is invalid");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function ownLocalDirectory(
  directory: string,
  scope: RuntimeScope,
  kind: string,
): Promise<{ path: string; check(): Promise<void> }> {
  const requested = resolve(directory);
  const segments = requested.slice(parse(requested).root.length).split("/");
  let parent = parse(requested).root;
  for (const [index, segment] of segments.entries()) {
    parent = join(parent, segment);
    try {
      await mkdir(parent, { mode: 0o700 });
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw localFailure(
          "binding_mismatch",
          "Local data directory is not owned",
        );
    }
    const stat = await lstat(parent);
    if (
      stat.isSymbolicLink() &&
      index === 0 &&
      ["/var", "/tmp"].includes(parent) &&
      (await realpath(parent)) === `/private${parent}`
    )
      parent = await realpath(parent);
    else if (!stat.isDirectory() || stat.isSymbolicLink())
      throw localFailure(
        "binding_mismatch",
        "Local data directory is not owned",
      );
  }
  const initial = await lstat(requested);
  if (!initial.isDirectory() || initial.isSymbolicLink())
    throw localFailure("binding_mismatch", "Local data directory is not owned");
  const path = await realpath(requested);
  const metadata = { kind, scope: scopeIdentity(scope) };
  const files = await readdir(path);
  if (!files.length)
    await writeFile(join(path, "owner.json"), JSON.stringify(metadata), {
      flag: "wx",
      mode: 0o600,
    });
  const check = async (): Promise<void> => {
    const stat = await lstat(requested);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.dev !== initial.dev ||
      stat.ino !== initial.ino ||
      (await realpath(requested)) !== path
    )
      throw localFailure(
        "binding_mismatch",
        "Local data directory is not owned",
      );
    const owner = await readOwnedJSON(join(path, "owner.json"), 4096);
    if (
      !owner ||
      typeof owner !== "object" ||
      !("kind" in owner) ||
      owner.kind !== kind ||
      !("scope" in owner) ||
      owner.scope !== metadata.scope
    )
      throw localFailure(
        "binding_mismatch",
        "Local data directory is not owned",
      );
  };
  try {
    await check();
  } catch {
    throw localFailure("binding_mismatch", "Local data directory is not owned");
  }
  return { path, check };
}

interface ArtifactRecord {
  ref: ArtifactRef;
  content: string;
  operationId: string;
  grants: number[];
}

export async function createArtifactStore(options: {
  directory: string;
  scope: RuntimeScope;
}): Promise<ArtifactStore> {
  const scope = structuredClone(options.scope);
  const directory = await ownLocalDirectory(
    options.directory,
    scope,
    "frogie.artifacts.v1",
  );
  let queue = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation).catch((error: unknown) => {
      throw safeLocalError(error);
    });
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const validate = (record: ArtifactRecord, id: string): void => {
    if (
      !record?.ref ||
      typeof record.content !== "string" ||
      typeof record.operationId !== "string" ||
      !record.operationId.length ||
      record.operationId.length > 256 ||
      !Array.isArray(record.grants) ||
      record.grants.length > 4096 ||
      record.grants.some(
        (value) => !Number.isSafeInteger(value) || value <= 0,
      ) ||
      scopeIdentity(record.ref.scope) !== scopeIdentity(scope) ||
      record.ref.id !== id ||
      !Number.isSafeInteger(record.ref.conversationId) ||
      record.ref.conversationId <= 0 ||
      (record.ref.taskId !== undefined &&
        (!Number.isSafeInteger(record.ref.taskId) || record.ref.taskId <= 0)) ||
      typeof record.ref.name !== "string" ||
      !record.ref.name.length ||
      record.ref.name.length > 256 ||
      typeof record.ref.mediaType !== "string" ||
      !record.ref.mediaType.length ||
      record.ref.mediaType.length > 128 ||
      contentDigest(
        JSON.stringify([scopeIdentity(scope), record.operationId]),
      ) !== id
    )
      throw localFailure("binding_mismatch", "Stored artifact is invalid");
    const bytes = utf8Content(record.content);
    if (
      record.ref.byteLength !== bytes.length ||
      record.ref.sha256 !== contentDigest(bytes)
    )
      throw localFailure(
        "binding_mismatch",
        "Stored artifact digest does not match",
      );
  };
  const load = async (id: string): Promise<ArtifactRecord> => {
    if (!digestPattern.test(id))
      throw localFailure("not_found", "Artifact was not found");
    await directory.check();
    try {
      const record = (await readOwnedJSON(
        join(directory.path, `${id}.json`),
        recordLimit,
      )) as ArtifactRecord;
      try {
        record.content = (
          await readOwnedBytes(join(directory.path, `${id}.content`), byteLimit)
        ).toString("utf8");
      } catch {
        throw localFailure(
          "binding_mismatch",
          "Stored artifact content is invalid",
        );
      }
      validate(record, id);
      return record;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        throw localFailure("not_found", "Artifact was not found");
      throw localFailure("binding_mismatch", "Stored artifact is invalid");
    }
  };
  const allowed = (record: ArtifactRecord, conversationId: number): void => {
    objectId(conversationId);
    if (
      record.ref.conversationId !== conversationId &&
      !record.grants.includes(conversationId)
    )
      throw localFailure(
        "forbidden",
        "Artifact is not granted to this conversation",
      );
  };
  return {
    write: (input) =>
      serialize(async () => {
        objectId(input.conversationId);
        if (input.taskId !== undefined) objectId(input.taskId);
        if (
          typeof input.operationId !== "string" ||
          !input.operationId.trim() ||
          input.operationId.length > 256 ||
          typeof input.name !== "string" ||
          !input.name.trim() ||
          utf8Content(input.name, 1024).length === 0 ||
          input.name.length > 256 ||
          typeof input.mediaType !== "string" ||
          !input.mediaType.trim() ||
          input.mediaType.length > 128 ||
          [...(input.name + input.mediaType)].some(
            (character) =>
              character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          )
        )
          throw localFailure("invalid_request", "Artifact metadata is invalid");
        utf8Content(input.operationId, 1024);
        utf8Content(input.mediaType, 512);
        const bytes = utf8Content(input.content);
        const id = contentDigest(
          JSON.stringify([scopeIdentity(scope), input.operationId]),
        );
        const ref: ArtifactRef = {
          scope,
          id,
          name: input.name,
          mediaType: input.mediaType,
          byteLength: bytes.length,
          sha256: contentDigest(bytes),
          conversationId: input.conversationId,
          ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        };
        await directory.check();
        try {
          const previous = await load(id);
          if (
            JSON.stringify(previous.ref) !== JSON.stringify(ref) ||
            previous.content !== input.content ||
            previous.operationId !== input.operationId
          )
            throw localFailure(
              "conflict",
              "Artifact operation identifies different content",
            );
          return structuredClone(previous.ref);
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "not_found"
            )
          )
            throw error;
        }
        await atomicLocalBytes(join(directory.path, `${id}.content`), bytes);
        await atomicLocalJSON(join(directory.path, `${id}.json`), {
          ref,
          operationId: input.operationId,
          grants: [],
        });
        return structuredClone(ref);
      }),
    read: async (id, conversationId) => {
      const record = await load(id);
      allowed(record, conversationId);
      return { ref: structuredClone(record.ref), content: record.content };
    },
    grant: (ids, fromConversationId, toConversationId) =>
      serialize(async () => {
        objectId(fromConversationId);
        objectId(toConversationId);
        if (ids.length > 100)
          throw localFailure("invalid_request", "Too many artifact grants");
        const records = await Promise.all([...new Set(ids)].map(load));
        for (const record of records) {
          allowed(record, fromConversationId);
          if (
            record.grants.length >= 4096 &&
            !record.grants.includes(toConversationId)
          )
            throw localFailure(
              "invalid_request",
              "Artifact grant limit reached",
            );
        }
        for (const record of records) {
          if (
            record.ref.conversationId === toConversationId ||
            record.grants.includes(toConversationId)
          )
            continue;
          record.grants.push(toConversationId);
          await directory.check();
          const { content: _content, ...metadata } = record;
          await atomicLocalJSON(
            join(directory.path, `${record.ref.id}.json`),
            metadata,
          );
        }
      }),
    list: async (conversationId) => {
      objectId(conversationId);
      await directory.check();
      const refs: ArtifactRef[] = [];
      for (const name of (await readdir(directory.path)).sort()) {
        if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
        const record = await load(name.slice(0, -5));
        if (
          record.ref.conversationId === conversationId ||
          record.grants.includes(conversationId)
        )
          refs.push(structuredClone(record.ref));
      }
      return refs;
    },
  };
}
