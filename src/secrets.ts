// @ts-nocheck
// Secret handling for cross-home settings/config sync. The whole-file denylist
// mirrors config-ledger's TRACKED_DENYLIST; the key-name scrub is a broader
// safety net because we sync arbitrary per-plugin config files whose secret
// fields we cannot enumerate.

export const FILE_DENYLIST = new Set([
  "accounts.json",
  "auth.json",
  "core-auth-accounts.json",
  "core-auth-proxies.json",
  "sync-bridge.json",
]);

const SECRET_KEY_PATTERNS = [
  "secret", "password", "passwd", "token", "apikey", "api_key", "bearer",
  "credential", "cookie", "client_secret", "refresh", "access_token", "private_key", "authorization",
];

function isSecretKey(key) {
  const k = String(key).toLowerCase();
  return SECRET_KEY_PATTERNS.some((p) => k.includes(p));
}

export function scrubSecrets(value) {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSecretKey(k)) continue;
      out[k] = scrubSecrets(v);
    }
    return out;
  }
  return value;
}

export function scrubText(text) {
  try {
    return JSON.stringify(scrubSecrets(JSON.parse(text)), null, 2) + "\n";
  } catch {
    return text;
  }
}
