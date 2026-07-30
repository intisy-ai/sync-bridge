// @ts-nocheck
// Resolves every app home from the shared registry (core's getApps + resolveHome).
// sync-bridge is the only component permitted to span all app homes.

import { existsSync } from "fs";
import { getApps, resolveHome } from "../core/src/index.js";

// every registered app home (built-ins + apps.json), deduped by resolved path.
export function allHomes() {
  const out = [];
  for (const desc of getApps()) {
    const home = resolveHome(desc);
    if (home && !out.includes(home)) out.push(home);
  }
  return out;
}

// app homes that exist on disk; an absent home means that app isn't installed.
export function existingHomes() {
  return allHomes().filter((home) => existsSync(home));
}
