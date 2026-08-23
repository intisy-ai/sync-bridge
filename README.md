# sync-bridge

[![npm version](https://img.shields.io/npm/v/sync-bridge)](https://www.npmjs.com/package/sync-bridge)
[![npm downloads](https://img.shields.io/npm/dm/sync-bridge)](https://www.npmjs.com/package/sync-bridge)
[![CI](https://img.shields.io/github/actions/workflow/status/intisy-ai/sync-bridge/publish.yml)](https://github.com/intisy-ai/sync-bridge/actions)

Syncs config and account files between the Claude Code and OpenCode home directories. Every other plugin in the ecosystem stays inside the single home of the app it is running in; **sync-bridge is the one component permitted to span both homes**, so an account logged in (or a config changed) in one app is mirrored to the other. It is consumed two ways: as its own **plugin hook** (reconciles configured files on load — by default the core-auth account store), and as an **in-process library** (`dist/lib.js`) that [plugin-updater](https://github.com/intisy-ai/plugin-updater) loads to run `syncPlugins()`, mirroring `plugins.json` entries flagged `sync: true` into the other app.

Each home is resolved by precedence (Claude prefers `~/.claude`; OpenCode prefers `~/.config/opencode`), overridable via `HUB_CLAUDE_DIR` / `HUB_OPENCODE_DIR`. A relative path (e.g. `config/accounts.json`) is read from every existing home, reconciled by a merge strategy, and written back atomically to all homes. The `accounts` strategy unions the core-auth account store by account id so no login is ever lost; `newest` copies the most-recently-modified version.

## Under-the-Hood Architecture

```mermaid
flowchart TD
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
    UPDATER["plugin-updater"] -->|syncPlugins() each launch| LIB
```

## Structure

- `src/`
  - TypeScript source (`homes`, `merge`, `sync`, `pluginsync`, `config`, `commands`, `index` = hook, `lib` = library entry)
  - `core/` — git submodule ([`intisy-ai/core`](https://github.com/intisy-ai/core)): shared config, logging, and the cross-app command framework — bundled into both output files by esbuild
  - `test/` — Node test runner specs
- `dist/`
  - Compiled output (generated; not committed): `index.js` (plugin hook) + `lib.js` (in-process library)

## Installation

### Via plugin-updater (recommended)

```bash
npx plugin-updater@latest init https://github.com/intisy-ai/sync-bridge
```

### Via npm

```bash
npm install sync-bridge
```

## API

The package main (`dist/index.js`) is the plugin hook and intentionally exports **only** `SyncBridgePlugin` — OpenCode runs every export as a hook, so the library functions live in a separate bundle. In-process consumers import from `sync-bridge/dist/lib.js`:

```ts
import { syncPlugins, syncFile, registerSyncFile, sync, existingHomes } from "sync-bridge/dist/lib.js";

syncPlugins();                                    // mirror plugins.json entries flagged sync:true across apps
syncFile("accounts.json", { strategy: "accounts" }); // union the account store
syncFile("config/plugins.json", { strategy: "newest" });
registerSyncFile("config/plugins.json", { strategy: "newest" });
sync();                                           // reconcile everything registered
```

### Cross-app plugin sync (`sync: true`)

Give any `plugins.json` entry a `sync: true` flag and it is mirrored into the other app's `plugins.json` on the next `plugin-updater` run, so installing a plugin in one app installs it in the other. It is a **per-home union** (each app keeps its own non-synced entries) and **additive** (never removes).

```json
[{ "name": "antigravity-auth", "url": "https://github.com/intisy-ai/antigravity-auth", "enabled": true, "autoUpdate": false, "sync": true }]
```

## Configuration

Config file: `<configDir>/config/sync-bridge.json` (edit it directly, or through whatever settings surface the app offers).

```json
{
  "logging": true,
  "files": [
    {
      "name": "accounts.json",
      "strategy": "accounts"
    }
  ],
  "enabled": true,
  "sync_plugins": true,
  "categories": {
    "accounts": true,
    "plugins": true,
    "settings": true,
    "pluginConfigs": true
  },
  "exclude": [],
  "default_strategy": "newest",
  "debounce_seconds": 0
}
```

| Key | Default |
| --- | --- |
| `logging` | `true` |
| `files` | `[{"name":"accounts.json","strategy":"accounts"}]` |
| `enabled` | `true` |
| `sync_plugins` | `true` |
| `categories` | `{"accounts":true,"plugins":true,"settings":true,"pluginConfigs":true}` |
| `exclude` | `[]` |
| `default_strategy` | `"newest"` |
| `debounce_seconds` | `0` |

## Commands

| Command | Description | Arguments |
| --- | --- | --- |
| `/sync` | Reconcile synced files + mirror sync-enabled plugins across both apps now |  |

## Dependencies

- `core`
- `plugin-updater`

## Logging

Logs are written to `<configDir>/logs/YYYY-MM-DD/sync-bridge-HH-MM-SS.log` and are toggled by
this plugin's `logging` config (default on). Console mirroring is global, off by default,
and controlled by the shared `config/settings.json` `logConsole` flag.

## License

MIT.
