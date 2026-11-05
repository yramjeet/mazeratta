import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MAZERATTA_COMMAND = Bun.which("mazeratta") ? "mazeratta" : `bun ${join(import.meta.dir, "mazeratta.ts")}`;

export function runQuiet(cmd: string[], cwd: string) {
  const result = Bun.spawnSync(cmd, { cwd, stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : "";
}

export function currentTmuxSession() {
  return process.env.TMUX ? runQuiet(["tmux", "display-message", "-p", "#S"], process.cwd()) : "";
}

export type LocalManifest = {
  state: "on" | "off";
  base: string;
  saved: string;
  files: string[];
  tracked: string[];
};

export function localStoreDir(gitDir: string) {
  return join(gitDir, "mazeratta-local");
}

export function localManifestFile(gitDir: string) {
  return join(localStoreDir(gitDir), "manifest.json");
}

export function readLocalManifest(gitDir: string): { manifest: LocalManifest | null; error?: string } {
  const file = localManifestFile(gitDir);
  if (!existsSync(file)) return { manifest: null };
  try {
    return { manifest: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return { manifest: null, error: `${file} is not valid JSON (${(error as Error).message})` };
  }
}

const REGEX_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

export function escapeRegExp(text: string) {
  return text.replace(REGEX_SPECIAL_CHARACTERS, "\\$&");
}

export function logToStderr(line: string) {
  console.error(line);
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}
