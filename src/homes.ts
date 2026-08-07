// @ts-nocheck
// Resolves every app home from the shared registry (core's getApps + resolveHome).
// sync-bridge is the only component permitted to span all app homes.

import { existsSync } from "fs";
import { getApps, resolveHome } from "@intisy-ai/core";

// every registered app home (built-ins + apps.json), deduped by resolved path, each carrying
// the app it belongs to and the loader that app is reached through.
export function allHomeEntries() {
  const out = [];
  for (const desc of getApps()) {
    const home = resolveHome(desc);
    if (home && !out.some((e) => e.home === home)) out.push({ home, app: desc.id, loaderId: desc.loader?.id });
  }
  return out;
}

export function allHomes() {
  return allHomeEntries().map((e) => e.home);
}

// app homes that exist on disk; an absent home means that app isn't installed.
export function existingHomeEntries() {
  return allHomeEntries().filter((e) => existsSync(e.home));
}

export function existingHomes() {
  return existingHomeEntries().map((e) => e.home);
}
