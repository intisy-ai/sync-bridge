// @ts-nocheck
// Cross-app plugin-list sync: mirrors every plugins.json entry into every other home via per-home union (additive, never removes). An entry opts out with sync:false, or via the exclude list.

import { existsSync } from "fs";
import { join } from "path";
import { atomicWrite, readJson } from "../core/src/index.js";
import { existingHomes } from "./homes.js";
import { getSyncConfig } from "./config.js";

// matches plugin-updater's getPluginsPath: config/plugins.json is canonical,
// top-level plugins.json is the legacy fallback, config/ is the default site.
function pluginsFile(home) {
  const preferred = join(home, "config", "plugins.json");
  const fallback = join(home, "plugins.json");
  if (existsSync(preferred)) return preferred;
  if (existsSync(fallback)) return fallback;
  return preferred;
}

// [] = genuinely absent/empty (safe to add into). null = the file exists but is
// unreadable/unparseable — callers MUST skip that home so we never clobber real
// local entries we just failed to read. Tolerates // line comments (core's readJson).
function readEntries(file) {
  if (!existsSync(file)) return [];
  const parsed = readJson(file, null);
  if (parsed === null) return null;
  return Array.isArray(parsed) ? parsed : [];
}

// Reconcile plugins.json across all existing homes: collect every entry marked
// sync:true, then add any a home is missing (matched by name). Returns a summary
// { synced, homes, added: { <home>: [names] } }.
export function syncPlugins() {
  const cfg = getSyncConfig();
  if (cfg.sync_plugins === false) return { synced: false, reason: "sync_plugins disabled", homes: 0, added: {} };
  const exclude = new Set(Array.isArray(cfg.exclude) ? cfg.exclude : []);

  const homes = existingHomes();
  if (homes.length < 2) return { synced: false, reason: "fewer than two app homes", homes: homes.length, added: {} };

  const files = homes.map(pluginsFile);
  const perHome = files.map(readEntries);

  // shared pool: the definition of each sync:true entry, keyed by name (a later
  // home's definition wins, which is fine — the entries are app-agnostic).
  const shared = new Map();
  for (const entries of perHome) {
    if (!entries) continue; // unreadable home contributes nothing to the shared pool
    for (const entry of entries) {
      if (entry && entry.sync !== false && entry.name && !exclude.has(entry.name)) shared.set(entry.name, entry);
    }
  }
  if (shared.size === 0) return { synced: true, homes: homes.length, added: {} };

  const added = {};
  files.forEach((file, index) => {
    const entries = perHome[index];
    if (!entries) return; // skip a home we couldn't read — never overwrite it
    const have = new Set(entries.map((entry) => entry && entry.name));
    const missing = [...shared.values()].filter((entry) => !have.has(entry.name));
    if (missing.length === 0) return;
    // mirror as a fresh entry; drop the source's local `enabled` state so the
    // plugin lands enabled in the receiving app (default) rather than inheriting
    // a disable toggle from the other app.
    const next = entries.concat(missing.map((entry) => { const e = { ...entry }; delete e.enabled; return e; }));
    atomicWrite(file, JSON.stringify(next, null, 2) + "\n");
    added[homes[index]] = missing.map((entry) => entry.name);
  });
  return { synced: true, homes: homes.length, added };
}