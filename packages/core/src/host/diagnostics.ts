import { DatabaseSync } from "node:sqlite";

export interface ToolDiagnostic {
  conversationId: number;
  name: string;
  count: number;
  failures: number;
}

export function inspectDatabase(
  databasePath: string,
  limit = 1000,
): ToolDiagnostic[] {
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new Error("Invalid diagnostic limit");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const groups = new Map<string, ToolDiagnostic>();
    const rows = database
      .prepare(
        "SELECT conversation_id, record FROM entries WHERE json_extract(record,'$.kind')='pi.tool-result' ORDER BY id DESC LIMIT ?",
      )
      .all(limit);
    for (const row of rows) {
      const value = JSON.parse(String(row.record)) as {
        model?: { toolName?: string; isError?: boolean }[];
      };
      for (const message of value.model ?? []) {
        if (!message.toolName) continue;
        const key = `${row.conversation_id}:${message.toolName}`;
        const item = groups.get(key) ?? {
          conversationId: Number(row.conversation_id),
          name: message.toolName,
          count: 0,
          failures: 0,
        };
        item.count++;
        item.failures += Number(message.isError === true);
        groups.set(key, item);
      }
    }
    return [...groups.values()];
  } finally {
    database.close();
  }
}
