/** One app home this plugin reconciles, and the loader that app is reached through. */
export interface HomeEntry {
  home: string;
  app: string;
  loaderId?: string;
  present: boolean;
}

/** What the sync engine reports to the activity ledger. */
export interface SyncActivity {
  topic: string;
  action: string;
  impact?: string;
  outcome?: string;
  subject?: { kind: string; id: string; label: string };
  details?: Record<string, unknown>;
}

/**
 * What the sync engine takes from whoever is running it.
 *
 * @remarks
 * This bundle runs two ways: as a program (its CLI, and the library plugin-updater loads) and as a
 * plugin a host activates. Taking homes, logging and the ledger by injection rather than by import
 * is what lets the plugin half reach them through its context, so the module graph behind the
 * plugin links nothing but the api.
 */
export interface SyncRuntime {
  /** Every app home there is, whether or not it exists on disk. */
  homes(): HomeEntry[];
  /** The home this process itself runs in, which is where the lock and the debounce stamp live. */
  home(): string;
  log(message: string, isError?: boolean): void;
  emit(activity: SyncActivity): void;
}

// The ids core registers for these topics. Named here because a plugin publishes a topic by id and
// nothing mints one for it; a rename in core's registry has to be mirrored here.
export const SYNC_TOPICS = {
  configChanged: "config.changed",
  syncCompleted: "sync.completed",
};

let RUNTIME: SyncRuntime | null = null;

export function setSyncRuntime(runtime: SyncRuntime): void {
  RUNTIME = runtime;
}

/**
 * The installed runtime.
 *
 * @remarks
 * Throws rather than falling back to an inert one, because every failure this engine can have is
 * "moved nothing" and a silent no-op is indistinguishable from a successful pass over identical
 * homes.
 */
export function syncRuntime(): SyncRuntime {
  if (!RUNTIME) throw new Error("sync-bridge: no runtime installed");
  return RUNTIME;
}
