import { execFileSync } from "node:child_process";

export function fixtureEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
}

export function git(repository: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repository,
    env: fixtureEnv(),
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}
