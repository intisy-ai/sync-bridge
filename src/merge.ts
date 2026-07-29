// @ts-nocheck
// Merge strategies for synced files: a strategy takes per-home versions ([{ data, mtimeMs }]) and returns the reconciled text. "newest" is the default; "accounts" unions the core-auth store so a login in either app is never lost; "newest-safe" is newest with secret keys scrubbed for settings/config files.

import { scrubText } from "./secrets.js";

export function newest(versions) {
  let best = null;
  for (const version of versions) if (!best || version.mtimeMs > best.mtimeMs) best = version;
  return best ? best.data : null;
}

export function newestSafe(versions) {
  const best = newest(versions);
  return best == null ? null : scrubText(best);
}

function parse(text) {
  try { return typeof text === "string" ? JSON.parse(text) : text; } catch { return null; }
}

// b is the newer entry; prefer its scalar fields, but never lose rate-limit lanes
// or meta keys present only on the older copy.
function mergeAccount(a, b) {
  const lanes = { ...(a.rateLimitResetTimes || {}) };
  for (const [lane, reset] of Object.entries(b.rateLimitResetTimes || {})) {
    lanes[lane] = Math.max(lanes[lane] || 0, reset || 0);
  }
  return { ...a, ...b, rateLimitResetTimes: lanes, meta: { ...(a.meta || {}), ...(b.meta || {}) } };
}

export function accounts(versions) {
  const out = { version: 1, providers: {} };
  const ordered = [...versions].sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first so newest wins
  for (const version of ordered) {
    const store = parse(version.data);
    if (!store || !store.providers) continue;
    for (const [providerId, pool] of Object.entries(store.providers)) {
      const target = out.providers[providerId] || (out.providers[providerId] = { accounts: [], activeIndex: 0, activeIndexByLane: {} });
      const byId = new Map(target.accounts.map((account) => [account.id, account]));
      for (const account of pool.accounts || []) {
        const existing = byId.get(account.id);
        byId.set(account.id, existing ? mergeAccount(existing, account) : account);
      }
      target.accounts = [...byId.values()];
      if (typeof pool.activeIndex === "number") target.activeIndex = pool.activeIndex;
      target.activeIndexByLane = { ...target.activeIndexByLane, ...(pool.activeIndexByLane || {}) };
    }
  }
  return JSON.stringify(out, null, 2);
}

export const STRATEGIES = { newest, accounts, "newest-safe": newestSafe };
