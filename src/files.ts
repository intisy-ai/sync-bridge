// Reconciling files across homes is this plugin's whole job, so it reads and writes them itself
// rather than through a library: a path-based file API is deliberately absent from the plugin
// context, which carries a path-free store instead.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { dirname } from "path";

export function atomicWrite(file: string, content: string): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, file);
}

// `fallback` on an absent OR unparseable file, so a caller can tell "nothing here" from "here but
// unreadable" by passing different fallbacks. Line comments are stripped first: the config files
// in these homes occasionally carry them.
export function readJson(file: string, fallback: unknown = null): unknown {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/^\s*\/\/[^\n]*/gm, ""));
  } catch {
    return fallback;
  }
}
