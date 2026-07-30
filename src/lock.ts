// @ts-nocheck
// A best-effort cross-process lock so two app launches never reconcile the shared
// home files at the same time. Held for the duration of one sync pass.

import { openSync, closeSync, unlinkSync, statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { getAppConfigDir, ensureDir } from "../core/src/index.js";

const STALE_MS = 60_000;

function lockPath() {
  return join(getAppConfigDir(), "config", "sync-bridge.lock");
}

// Run fn while holding the lock. If another process holds a fresh lock, skip fn
// and return null. A lock older than STALE_MS is treated as abandoned (a crashed
// holder) and taken over.
export function withSyncLock(fn) {
  const path = lockPath();
  ensureDir(dirname(path));
  let fd = acquire(path);
  if (fd === null && existsSync(path)) {
    try {
      if (Date.now() - statSync(path).mtimeMs > STALE_MS) { unlinkSync(path); fd = acquire(path); }
    } catch { return null; }
  }
  if (fd === null) return null;
  try { return fn(); }
  finally {
    try { closeSync(fd); } catch {}
    try { unlinkSync(path); } catch {}
  }
}

function acquire(path) {
  try { return openSync(path, "wx"); } catch { return null; }
}
