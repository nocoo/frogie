import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { startPreview } from "../apps/dashboard/src/server/preview.js";
import { version } from "../package.json";

export async function main(): Promise<void> {
  const parent = resolve("data/local");
  await mkdir(parent, { recursive: true });
  const directory = resolve(parent, `preview-${randomUUID()}`);
  const preview = await startPreview({ directory });
  const shutdown = async () => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    const timeout = setTimeout(() => process.exit(1), 5_000);
    try {
      await preview.close();
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  console.log(`Frogie v${version} — 本地测试模式（无模型费用）`);
  console.log(`打开一次性链接：${preview.url}`);
  console.log(`本地数据：${directory}`);
}
