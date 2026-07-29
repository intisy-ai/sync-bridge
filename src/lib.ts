// @ts-nocheck
// In-process library entry — bundled to dist/lib.js. This is NOT the opencode/
// claude plugin hook (that's dist/index.js, which exports ONLY SyncBridgePlugin
// because the host runs every export as a hook). Consumers like plugin-updater
// load THIS bundle to call the real API without tripping that rule.

export { syncFile, registerSyncFile, sync, registeredFiles } from "./sync.js";
export { syncPlugins } from "./pluginsync.js";
export { syncAll, syncStatus } from "./run.js";
export { claudeHome, opencodeHome, existingHomes, allHomes } from "./homes.js";
