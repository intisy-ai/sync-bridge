// @ts-nocheck
// The broadened default sync set, shared by the plugin hook, plugin-updater, and Cairn.
// Category-gated (accounts / plugins / settings / pluginConfigs), exclude-aware, secrets scrubbed.

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { emitEvent, TOPICS } from "../core/src/index.js";
import { existingHomes } from "./homes.js";
import { getSyncConfig } from "./config.js";
import { syncFile, sync as syncRegistered } from "./sync.js";
import { syncPlugins } from "./pluginsync.js";
import { withSyncLock } from "./lock.js";
import { FILE_DENYLIST } from "./secrets.js";

// every config/<name>.json present in any home, minus secret-store, control, and
// explicitly-handled files.
function discoverPluginConfigs() {
  const names = new Set();
  for (const home of existingHomes()) {
    const dir = join(home, "config");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      if (FILE_DENYLIST.has(f)) continue;
      if (f === "plugins.json" || f === "settings.json") continue;
      names.add(f);
    }
  }
  return [...names];
}

export function syncAll() {
  const cfg = getSyncConfig();
  if (cfg.enabled === false) return { enabled: false, files: {}, plugins: null };
  return withSyncLock(() => runPass(cfg)) ?? { enabled: true, skipped: "locked", files: {}, plugins: null };
}

function plural(n, noun) {
  return n + " " + noun + (n === 1 ? "" : "s");
}

// The generic renderer has no template for this topic, so the readable line ships
// with the record.
function summarize(files, plugins, homes) {
  const parts = [];
  if (files) parts.push(plural(files, "file"));
  if (plugins) parts.push(plural(plugins, "plugin"));
  return "Synced " + parts.join(" and ") + " across " + plural(homes, "home");
}

function runPass(cfg) {
  const cats = cfg.categories || {};
  const exclude = new Set(Array.isArray(cfg.exclude) ? cfg.exclude : []);
  const defaultStrategy = cfg.default_strategy || "newest";
  const results = {};

  if (cats.accounts !== false && !exclude.has("accounts.json")) {
    results["accounts.json"] = syncFile("accounts.json", { strategy: "accounts", create: true });
  }
  if (cats.settings !== false && !exclude.has("settings.json")) {
    results["config/settings.json"] = syncFile("config/settings.json", { strategy: "newest", create: true });
  }
  if (cats.pluginConfigs !== false) {
    for (const name of discoverPluginConfigs()) {
      if (exclude.has(name)) continue;
      results["config/" + name] = syncFile("config/" + name, { strategy: "newest" });
    }
  }
  // explicit per-config overrides from sync-bridge.json, plus library-registered files.
  for (const entry of cfg.files || []) {
    const name = entry && (entry.name || entry.path);
    if (name && !exclude.has(name)) results[name] = syncFile(name, { strategy: entry.strategy || defaultStrategy });
  }
  Object.assign(results, syncRegistered());

  const plugins = cats.plugins !== false ? syncPlugins() : null;

  const changedFiles = Object.keys(results).filter((name) => results[name] && results[name].wrote > 0);
  const addedPlugins = plugins && plugins.added
    ? [...new Set(Object.values(plugins.added).flat())]
    : [];
  if (changedFiles.length > 0 || addedPlugins.length > 0) {
    const homes = existingHomes();
    emitEvent({
      topic: TOPICS.syncCompleted,
      action: "sync_completed",
      impact: "notice",
      outcome: "ok",
      details: {
        files: changedFiles,
        plugins: addedPlugins,
        homes,
        message: summarize(changedFiles.length, addedPlugins.length, homes.length),
      },
    }, "sync-bridge");
  }
  return { enabled: true, files: results, plugins };
}

export function syncStatus() {
  const cfg = getSyncConfig();
  return {
    enabled: cfg.enabled !== false,
    categories: cfg.categories || { accounts: true, plugins: true, settings: true, pluginConfigs: true },
    exclude: Array.isArray(cfg.exclude) ? cfg.exclude : [],
    homes: existingHomes(),
    pluginConfigs: discoverPluginConfigs(),
  };
}
