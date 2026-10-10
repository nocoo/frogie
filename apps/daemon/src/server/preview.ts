import { randomUUID } from "node:crypto";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type DaemonServerOptions, startDaemonServer } from "./localRuntime.js";

export async function startPreview(options: DaemonServerOptions) {
  await mkdir(options.directory);
  await writeFile(
    join(options.directory, "owner.json"),
    JSON.stringify({ runId: randomUUID(), root: resolve(options.directory) }),
    { flag: "wx", mode: 0o600 },
  );
  const definitionsDirectory = join(options.directory, "workspace/squads");
  await cp(
    options.definitionsDirectory ?? resolve("squads"),
    definitionsDirectory,
    { recursive: true, force: false, errorOnExist: true },
  );
  return startDaemonServer({ ...options, definitionsDirectory, mode: "e2e" });
}
