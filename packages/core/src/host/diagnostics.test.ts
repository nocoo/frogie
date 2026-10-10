import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { inspectDatabase } from "./diagnostics.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "frogie-diagnostics-"));
  directories.push(directory);
  const path = join(directory, "session.sqlite");
  const database = new DatabaseSync(path);
  database.exec(
    "CREATE TABLE entries (id INTEGER PRIMARY KEY, conversation_id INTEGER, record TEXT)",
  );
  const insert = database.prepare(
    "INSERT INTO entries (conversation_id, record) VALUES (?, ?)",
  );
  insert.run(
    1,
    JSON.stringify({
      kind: "pi.tool-result",
      model: [{ toolName: "read", isError: true }],
    }),
  );
  insert.run(
    1,
    JSON.stringify({
      kind: "pi.tool-result",
      model: [{ toolName: "read" }, { toolName: "read", isError: true }, {}],
    }),
  );
  insert.run(
    2,
    JSON.stringify({
      kind: "pi.tool-result",
      model: [{ toolName: "read", isError: false }],
    }),
  );
  insert.run(2, JSON.stringify({ kind: "pi.tool-result" }));
  insert.run(
    2,
    JSON.stringify({ kind: "pi.assistant", model: [{ toolName: "ignored" }] }),
  );
  database.close();
  return path;
}
it("reads only recent tool records, groups per conversation, and leaves SQLite byte-for-byte unchanged", () => {
  const path = fixture();
  const before = readFileSync(path);
  expect(inspectDatabase(path, 3)).toEqual([
    { conversationId: 2, name: "read", count: 1, failures: 0 },
    { conversationId: 1, name: "read", count: 2, failures: 1 },
  ]);
  expect(inspectDatabase(path)).toEqual([
    { conversationId: 2, name: "read", count: 1, failures: 0 },
    { conversationId: 1, name: "read", count: 3, failures: 2 },
  ]);
  expect(readFileSync(path)).toEqual(before);
});
it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid limit %s before opening a file",
  (limit) => {
    expect(() =>
      inspectDatabase("/nonexistent/should-not-be-created.sqlite", limit),
    ).toThrow("Invalid diagnostic limit");
  },
);
it("closes the read-only connection after malformed records fail", () => {
  const path = fixture();
  const database = new DatabaseSync(path);
  database
    .prepare("INSERT INTO entries (conversation_id, record) VALUES (?, ?)")
    .run(1, "not json");
  database.close();
  expect(() => inspectDatabase(path)).toThrow();
  const reopened = new DatabaseSync(path);
  reopened.exec("BEGIN EXCLUSIVE; DELETE FROM entries; COMMIT");
  reopened.close();
  expect(inspectDatabase(path)).toEqual([]);
});
