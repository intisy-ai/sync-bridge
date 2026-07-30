// @ts-nocheck
// Files that are never blanket-synced by the pluginConfigs sweep: the secret and
// account stores (reconciled by the `accounts` strategy or left alone) and
// sync-bridge's own control file. Mirrors config-ledger's TRACKED_DENYLIST.

export const FILE_DENYLIST = new Set([
  "accounts.json",
  "auth.json",
  "core-auth-accounts.json",
  "core-auth-proxies.json",
  "sync-bridge.json",
]);
