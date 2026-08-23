// The runtime the program half installs: this plugin's CLI, and the library plugin-updater loads,
// both run with no host, so they take homes, logging and the ledger from core directly.
import { existsSync } from "fs";
import { emitEvent, getAppConfigDir, getApps, makeWriteLog, resolveHome } from "@intisy-ai/core";
import { setSyncRuntime, type HomeEntry, type SyncRuntime } from "./runtime.js";

const NAME = "sync-bridge";

function registeredHomes(): HomeEntry[] {
  const entries: HomeEntry[] = [];
  for (const descriptor of getApps()) {
    const home = resolveHome(descriptor);
    if (!home || entries.some((entry) => entry.home === home)) continue;
    entries.push({ home, app: descriptor.id, loaderId: descriptor.loader?.id, present: existsSync(home) });
  }
  return entries;
}

export function coreRuntime(): SyncRuntime {
  const writeLog = makeWriteLog(NAME);
  return {
    homes: registeredHomes,
    home: () => getAppConfigDir(),
    log: (message, isError) => writeLog(message, isError),
    emit: (activity) => { emitEvent(activity, NAME); },
  };
}

export function installCoreRuntime(): void {
  setSyncRuntime(coreRuntime());
}
