// @ts-nocheck
// sync-bridge config: bespoke multi-home file search; log writing delegated to core's makeWriteLog.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { existingHomes } from "./homes.js";
import { makeWriteLog, defineConfig } from "../core/src/index.js";

const NAME = "sync-bridge";

// synced out of the box so one login serves both apps; override entirely with a
// `files` array in sync-bridge.json. Each entry is { name, strategy }; `name` is
// resolved per home to config/<name> or <name>, whichever exists.
const DEFAULT_FILES = [{ name: "accounts.json", strategy: "accounts" }];

// register defaults so the loader can discover + edit them (writes no file on load)
defineConfig(NAME, {
  logging: true,
  files: DEFAULT_FILES,
  enabled: true,
  sync_plugins: true,
  default_strategy: "newest",
  debounce_seconds: 0,
});

let SYNC_CONFIG = null;

function findConfigFile() {
  for (const home of existingHomes()) {
    const preferred = join(home, "config", NAME + ".json");
    const fallback = join(home, NAME + ".json");
    if (existsSync(preferred)) return preferred;
    if (existsSync(fallback)) return fallback;
  }
  return null;
}

export function getSyncConfig() {
  if (SYNC_CONFIG !== null) return SYNC_CONFIG;
  let loaded = {};
  try {
    const file = findConfigFile();
    if (file) loaded = JSON.parse(readFileSync(file, "utf8"));
  } catch { loaded = {}; }
  SYNC_CONFIG = { ...loaded, files: Array.isArray(loaded.files) ? loaded.files : DEFAULT_FILES };
  return SYNC_CONFIG;
}

export const writeLog = makeWriteLog(NAME);