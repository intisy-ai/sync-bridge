// @ts-nocheck
// In-process library entry — bundled to dist/lib.js. This is NOT the opencode/
// claude plugin hook (that's dist/index.js, which exports ONLY SyncBridgePlugin
// because the host runs every export as a hook). Consumers like plugin-updater
// load THIS bundle to call the real API without tripping that rule.

import { installCoreRuntime } from "./runtime-core.js";

// A consumer of this bundle runs it with no host, so the engine takes basekit's runtime.
installCoreRuntime();

export { syncFile, registerSyncFile, sync, registeredFiles } from "./sync.js";
export { syncPlugins } from "./pluginsync.js";
export { syncAll, syncStatus } from "./run.js";
export { existingHomes, allHomes } from "./homes.js";
