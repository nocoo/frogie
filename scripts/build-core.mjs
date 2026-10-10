import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const core = join(root, "packages/core");
const require = createRequire(import.meta.url);
const compiler = join(
  dirname(require.resolve("typescript/package.json")),
  "bin/tsc",
);

await rm(join(core, "dist"), { recursive: true, force: true });
execFileSync(
  process.execPath,
  [compiler, "--project", join(core, "tsconfig.build.json")],
  {
    cwd: root,
    stdio: "inherit",
    timeout: 120_000,
  },
);

await rm(join(core, "squads"), { recursive: true, force: true });
await cp(join(root, "squads/hisfm"), join(core, "squads/hisfm"), {
  recursive: true,
});
await cp(join(root, "LICENSE"), join(core, "LICENSE"));

const prompts = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      'import { loadHisfmPrompts } from "./packages/core/src/squads/hisfm.ts"; process.stdout.write(JSON.stringify(loadHisfmPrompts()));',
    ],
    { cwd: root, encoding: "utf8", timeout: 30_000 },
  ),
);

const output = join(core, "dist/squads");
await mkdir(output, { recursive: true });
await writeFile(
  join(output, "hisfm-narration.js"),
  `export const narrationStyle = ${JSON.stringify(prompts.narrationStyle)};\n`,
);
await writeFile(
  join(output, "hisfm-narration.d.ts"),
  "export declare const narrationStyle: string;\n",
);
await writeFile(
  join(output, "hisfm-prompts.js"),
  `${Object.entries(prompts)
    .map(
      ([name, value]) =>
        `export const ${name} = ${JSON.stringify(value, null, 2)};`,
    )
    .join("\n\n")}\n`,
);
await writeFile(
  join(output, "hisfm-prompts.d.ts"),
  [
    "export interface HisfmPrompts {",
    ...Object.keys(prompts.defaultPrompts).map((key) => `  ${key}: string;`),
    "}",
    "export declare const defaultPrompts: HisfmPrompts;",
    "export declare const channelDefault: string;",
    "export declare const narrationStyle: string;",
    "",
  ].join("\n"),
);
