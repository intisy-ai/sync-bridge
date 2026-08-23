// @ts-nocheck
// Every app home, from whoever is running this bundle. sync-bridge is the only component
// permitted to span all app homes.

import { syncRuntime } from "./runtime.js";

// every app home there is, deduped by resolved path, each carrying the app it belongs to and the
// loader that app is reached through.
export function allHomeEntries() {
  return syncRuntime().homes();
}

export function allHomes() {
  return allHomeEntries().map((e) => e.home);
}

// app homes that exist on disk; an absent home means that app isn't installed.
export function existingHomeEntries() {
  return allHomeEntries().filter((e) => e.present);
}

export function existingHomes() {
  return existingHomeEntries().map((e) => e.home);
}
