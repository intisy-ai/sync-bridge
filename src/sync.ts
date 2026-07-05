// @ts-nocheck
// The sync engine: reconcile a relative path across every existing app home via the chosen merge strategy (atomic temp-rename, skipping homes already up to date).

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync } from "fs";
import { join, dirname } from "path";
import { randomBytes } from "crypto";
import { existingHomes } from "./homes.js";
import { STRATEGIES, newest } from "./merge.js";
import { getSyncConfig, writeLog } from "./config.js";

const REGISTERED = new Map();   // relativePath -> options

function readVersion(file) {
  try { if (existsSync(file)) return { file, data: readFileSync(file, "utf8"), mtimeMs: statSync(file).mtimeMs }; } catch (e) { writeLog(`readVersion failed for ${file}: ${e}`, true); }
  return null;
}

function atomicWrite(file, content) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = file + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}

// resolve a bare file name to where it lives in a home: config/<name> (preferred)
// or <name> at the top, whichever exists; config/<name> is the default write site.
// a name containing a path separator is treated as an explicit relative path.
function resolvePath(home, name) {
  if (name.includes("/") || name.includes("\\")) return join(home, name);
  const preferred = join(home, "config", name);
  const fallback = join(home, name);
  if (existsSync(preferred)) return preferred;
  if (existsSync(fallback)) return fallback;
  return preferred;
}

export function syncFile(name, options) {
  const defaultStrategy = getSyncConfig().default_strategy || "newest";
  const strategy = STRATEGIES[(options && options.strategy) || defaultStrategy] || newest;
  const homes = existingHomes();
  if (homes.length < 2) return { synced: false, reason: "fewer than two app homes", homes: homes.length, wrote: 0 };
  const files = homes.map((home) => resolvePath(home, name));
  const versions = files.map(readVersion).filter(Boolean);
  if (versions.length === 0) return { synced: false, reason: "no versions on any home", homes: homes.length, wrote: 0 };
  const merged = strategy(versions);
  if (merged == null) return { synced: false, reason: "strategy produced nothing", homes: homes.length, wrote: 0 };
  let wrote = 0;
  for (const file of files) {
    const current = readVersion(file);
    if (!current || current.data !== merged) { atomicWrite(file, merged); wrote++; }
  }
  return { synced: true, homes: homes.length, wrote };
}

// idempotent
export function registerSyncFile(relativePath, options) {
  REGISTERED.set(relativePath, options || {});
}

export function registeredFiles() {
  return [...REGISTERED.entries()].map(([path, options]) => ({ path, options }));
}

export function sync() {
  const results = {};
  for (const [relativePath, options] of REGISTERED) results[relativePath] = syncFile(relativePath, options);
  return results;
}