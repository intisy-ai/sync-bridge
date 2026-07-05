// @ts-nocheck
// sync-bridge plugin hook entry — exports ONLY the hook; library API lives in dist/lib.js (see lib.ts) since OpenCode runs every export as a hook.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { syncFile, sync } from "./sync.js";
import { getSyncConfig, writeLog } from "./config.js";
import { deployCommands, defineReadme, maybeRunReadmeCli } from "../core/src/index.js";
import { SYNC_COMMANDS, maybeRunCli } from "./commands.js";
import { claudeHome } from "./homes.js";

defineReadme({
  description:
    "Syncs config and account files between the Claude Code and OpenCode home directories. Every other plugin in the ecosystem stays inside the single home of the app it is running in; **sync-bridge is the one component permitted to span both homes**, so an account logged in (or a config changed) in one app is mirrored to the other. It is consumed two ways: as its own **plugin hook** (reconciles configured files on load — by default the core-auth account store), and as an **in-process library** (`dist/lib.js`) that [plugin-updater](https://github.com/intisy-ai/plugin-updater) loads to run `syncPlugins()`, mirroring `plugins.json` entries flagged `sync: true` into the other app.\n\nEach home is resolved by precedence (Claude prefers `~/.claude`; OpenCode prefers `~/.config/opencode`), overridable via `HUB_CLAUDE_DIR` / `HUB_OPENCODE_DIR`. A relative path (e.g. `config/accounts.json`) is read from every existing home, reconciled by a merge strategy, and written back atomically to all homes. The `accounts` strategy unions the core-auth account store by account id so no login is ever lost; `newest` copies the most-recently-modified version.",
  architecture: `flowchart TD
    subgraph Homes
        CLAUDE["Claude home<br/>~/.claude → ~/.config/claude"]
        OPENCODE["OpenCode home<br/>~/.config/opencode → ~/.opencode"]
    end

    subgraph Bridge [sync-bridge]
        HOOK["plugin hook (dist/index.js)<br/>reconciles configured files on load"]
        LIB["library (dist/lib.js)<br/>syncFile / sync / syncPlugins / homes"]
        RECONCILE["reconcile: read each home → merge → write all homes"]
        STRAT["strategies: newest | accounts (union)<br/>plugins: per-home union of sync:true entries"]
        HOOK --> RECONCILE
        LIB --> RECONCILE --> STRAT
    end

    CLAUDE <--> RECONCILE
    OPENCODE <--> RECONCILE
    UPDATER["plugin-updater"] -->|syncPlugins() each launch| LIB`,
  structure: {
    src: [
      "TypeScript source (`homes`, `merge`, `sync`, `pluginsync`, `config`, `commands`, `index` = hook, `lib` = library entry)",
      "`core/` — git submodule ([`intisy-ai/core`](https://github.com/intisy-ai/core)): shared config, logging, and the cross-app command framework — bundled into both output files by esbuild",
      "`test/` — Node test runner specs",
    ],
    dist: ["Compiled output (generated; not committed): `index.js` (plugin hook) + `lib.js` (in-process library)"],
  },
  commands: SYNC_COMMANDS,
  dependencies: ["core", "plugin-updater"],
  extraSections: [
    {
      id: "api",
      title: "API",
      after: "installation",
      body: `The package main (\`dist/index.js\`) is the plugin hook and intentionally exports **only** \`SyncBridgePlugin\` — OpenCode runs every export as a hook, so the library functions live in a separate bundle. In-process consumers import from \`sync-bridge/dist/lib.js\`:

\`\`\`ts
import { syncPlugins, syncFile, registerSyncFile, sync, existingHomes } from "sync-bridge/dist/lib.js";

syncPlugins();                                    // mirror plugins.json entries flagged sync:true across apps
syncFile("accounts.json", { strategy: "accounts" }); // union the account store
syncFile("config/plugins.json", { strategy: "newest" });
registerSyncFile("config/plugins.json", { strategy: "newest" });
sync();                                           // reconcile everything registered
\`\`\`

### Cross-app plugin sync (\`sync: true\`)

Give any \`plugins.json\` entry a \`sync: true\` flag and it is mirrored into the other app's \`plugins.json\` on the next \`plugin-updater\` run, so installing a plugin in one app installs it in the other. It is a **per-home union** (each app keeps its own non-synced entries) and **additive** (never removes).

\`\`\`json
[{ "name": "antigravity-auth", "url": "https://github.com/intisy-ai/antigravity-auth", "enabled": true, "autoUpdate": false, "sync": true }]
\`\`\``,
    },
  ],
});

// When invoked as `node <bundle> <action>` (from a slash-command), run the action
// and exit before the plugin/hook logic. On a normal load, keep the slash-commands
// deployed to both apps (idempotent, best-effort).
if (maybeRunReadmeCli("sync-bridge")) process.exit(0);
if (await maybeRunCli("sync-bridge")) {
  process.exit(0);
}
try {
  deployCommands("sync-bridge", SYNC_COMMANDS);
} catch {
  /* best-effort */
}

// Path for the debounce timestamp; stored in the Claude config dir (always present
// as the primary home) so it persists across runs without requiring both apps.
function lastsyncedPath() {
  const dir = join(claudeHome(), "config");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "sync-bridge.lastsynced");
}

// Returns true if a successful sync happened within `seconds` seconds. 0 = skip check.
function isWithinDebounce(seconds) {
  if (!seconds || seconds <= 0) return false;
  try {
    const ts = parseFloat(readFileSync(lastsyncedPath(), "utf8"));
    return !isNaN(ts) && (Date.now() - ts) < seconds * 1000;
  } catch {
    return false;
  }
}

function markSynced() {
  try { writeFileSync(lastsyncedPath(), String(Date.now()), "utf8"); } catch (e) { writeLog(`markSynced failed: ${e}`, true); }
}

// sync every file from sync-bridge.json (`files: [{ name, strategy }]`, defaulting
// to the core-auth account store), plus any library-registered files.
function syncAll() {
  const cfg = getSyncConfig();
  const defaultStrategy = cfg.default_strategy || "newest";
  const results = {};
  for (const entry of cfg.files || []) {
    const name = entry && (entry.name || entry.path);
    if (name) results[name] = syncFile(name, { strategy: entry.strategy || defaultStrategy });
  }
  Object.assign(results, sync());
  markSynced();
  return results;
}

// plugin entry — best-effort sync on load, never throws
export const SyncBridgePlugin = async function () {
  try {
    const cfg = getSyncConfig();
    if (cfg.enabled !== false && !isWithinDebounce(cfg.debounce_seconds)) syncAll();
  } catch (e) {
    writeLog(`sync-bridge plugin load sync failed: ${e}`, true);
  }
  return {};
};

export default SyncBridgePlugin;