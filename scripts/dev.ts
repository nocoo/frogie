import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadLocalModel,
  startLocal,
} from "../apps/daemon/src/server/localRuntime.js";
import { startPreview } from "../apps/daemon/src/server/preview.js";
import { version } from "../package.json";

export async function main(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const mode = env.FROGIE_MODE ?? "local";
  if (mode !== "local" && mode !== "e2e")
    throw new Error("FROGIE_MODE 仅支持 local 或 e2e。");
  const model =
    mode === "local"
      ? await loadLocalModel(
          env.FROGIE_MODEL_CONFIG ?? resolve("data/local-model.json"),
        )
      : undefined;
  const parent = resolve(`data/${mode}`);
  await mkdir(parent, { recursive: true });
  const directory = resolve(
    parent,
    mode === "local" ? "daemon" : `preview-${randomUUID()}`,
  );
  const preview = model
    ? await startLocal({ directory, model })
    : await startPreview({ directory });
  const shutdown = async () => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    const timeout = setTimeout(() => process.exit(1), 16_000);
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
  console.log(
    `Frogie v${version} — ${model ? `Local · ${model.modelId}` : "E2E（无模型费用）"}`,
  );
  console.log(`打开本地页面：${preview.url}`);
  console.log(`本地数据：${directory}`);
}
