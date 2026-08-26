// @ts-nocheck
// sync-bridge config: bespoke multi-home file search; log writing goes to whoever is running this
// bundle, which is core for the program half and the plugin context for the plugin half.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { existingHomes } from "./homes.js";
import { syncRuntime } from "./runtime.js";
import type { CapabilitySchema } from "@intisy-ai/core";

const NAME = "sync-bridge";

// synced out of the box so one login serves both apps; override entirely with a
// `files` array in sync-bridge.json. Each entry is { name, strategy }; `name` is
// resolved per home to config/<name> or <name>, whichever exists.
const DEFAULT_FILES = [{ name: "accounts.json", strategy: "accounts" }];

// What each setting is called and how a surface renders it, beside the values the manifest
// declares. Data the settings capability answers with.
export const SYNC_BRIDGE_SETTINGS: CapabilitySchema = {
  fields: [
    { key: "logging", type: "boolean", label: "Logging", group: "General" },
    { key: "enabled", type: "boolean", label: "Sync across apps", description: "Keep accounts, plugins, and settings mirrored across every app. Secrets are never shared.", group: "General" },
    { key: "sync_plugins", type: "boolean", label: "Sync plugins", group: "General" },
    { key: "categories.accounts", type: "boolean", label: "Accounts", description: "Mirror provider logins across apps (no login is ever lost).", group: "Categories" },
    { key: "categories.plugins", type: "boolean", label: "Plugins", description: "Install a plugin in one app and it appears in the others.", group: "Categories" },
    { key: "categories.settings", type: "boolean", label: "Global settings", description: "Share config/settings.json across apps (secrets excluded).", group: "Categories" },
    { key: "categories.pluginConfigs", type: "boolean", label: "Plugin configs", description: "Share each plugin's config across apps (secrets excluded).", group: "Categories" },
    { key: "default_strategy", type: "string", label: "Default merge strategy", group: "Advanced" },
    { key: "debounce_seconds", type: "number", label: "Debounce (s)", min: 0, group: "Advanced" },
    { key: "exclude", type: "list", itemType: "string", label: "Exclude files", group: "Advanced" },
    { key: "files", type: "multiline", label: "Synced files", description: "JSON array of { name, strategy } entries.", group: "Advanced" },
  ],
  actions: [
    { id: "sync", label: "Sync now", description: "Reconcile every app home immediately." },
  ],
  // Reconciling homes against each other is the whole job, so these settings are not
  // per-home: a surface managing several writes them to all of them.
  sections: [
    {
      id: "sync",
      label: "Sync",
      description: "Keep accounts, plugins, and settings mirrored across every app. Secrets are never shared.",
      order: 40,
      scope: "allHomes",
      fields: ["enabled", "categories.accounts", "categories.plugins", "categories.settings", "categories.pluginConfigs"],
      actions: ["sync"],
    },
  ],
};

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

export function writeLog(message, isError) {
  syncRuntime().log(message, isError);
}