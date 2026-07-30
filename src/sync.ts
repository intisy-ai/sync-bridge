// @ts-nocheck
// The sync engine: reconcile a relative path across every existing app home via the chosen merge strategy (atomic temp-rename, skipping homes already up to date).

import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { atomicWrite, publish, TOPICS } from "../core/src/index.js";
import { existingHomes } from "./homes.js";
import { STRATEGIES, newest } from "./merge.js";
import { getSyncConfig, writeLog } from "./config.js";

const REGISTERED = new Map();   // relativePath -> options

// A home's view of the file. `present` distinguishes "absent" (safe to create)
// from "exists but unreadable" (locked or corrupt: must never be overwritten).
function readState(file) {
  if (!existsSync(file)) return { file, present: false, readable: false };
  try {
    return { file, present: true, readable: true, data: readFileSync(file, "utf8"), mtimeMs: statSync(file).mtimeMs };
  } catch (e) {
    writeLog(`read failed for ${file}: ${e}`, true);
    return { file, present: true, readable: false };
  }
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

// options.create: also write the merged text into homes that lack the file. Off
// by default so a plugin's config never lands in an app that doesn't have it; the
// app-level files (accounts, settings) opt in to propagate to every home.
export function syncFile(name, options) {
  const opts = options || {};
  const defaultStrategy = getSyncConfig().default_strategy || "newest";
  const strategy = STRATEGIES[opts.strategy || defaultStrategy] || newest;
  const homes = existingHomes();
  if (homes.length < 2) return { synced: false, reason: "fewer than two app homes", homes: homes.length, wrote: 0 };
  const states = homes.map((home) => readState(resolvePath(home, name)));
  const versions = states.filter((s) => s.readable).map((s) => ({ data: s.data, mtimeMs: s.mtimeMs }));
  if (versions.length === 0) return { synced: false, reason: "no versions on any home", homes: homes.length, wrote: 0 };
  const merged = strategy(versions);
  if (merged == null) return { synced: false, reason: "strategy produced nothing", homes: homes.length, wrote: 0 };
  let wrote = 0;
  for (const state of states) {
    if (state.present && !state.readable) continue; // locked or corrupt: never clobber
    if (!state.present && !opts.create) continue;   // absent and not propagating: leave it
    if (!state.readable || state.data !== merged) { atomicWrite(state.file, merged); wrote++; }
  }
  if (wrote > 0) publish(TOPICS.configChanged, { name }, "sync-bridge");
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