// @ts-nocheck
// Resolves the Claude and OpenCode home dirs; sync-bridge is the only component permitted to span both. Precedence: Claude ~/.claude before ~/.config/claude (direct first); OpenCode ~/.config/opencode before ~/.opencode (XDG first). HUB_CLAUDE_DIR / HUB_OPENCODE_DIR override.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function trimmed(v) {
  return v && v.trim() ? v.trim() : "";
}

function resolve(override, candidates, fallback) {
  if (override && override.trim()) return override.trim();
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return fallback;
}

export function claudeHome() {
  const home = homedir();
  return resolve(process.env.HUB_CLAUDE_DIR, [join(home, ".claude"), join(home, ".config", "claude")], join(home, ".claude"));
}

export function opencodeHome() {
  const home = homedir();
  return resolve(process.env.HUB_OPENCODE_DIR, [join(home, ".config", "opencode"), join(home, ".opencode")], join(home, ".config", "opencode"));
}

// homes of apps registered in the global apps.json (SP-5a registry). Read here as
// a standalone mirror because sync-bridge's bundled core predates the registry.
function appsFile() {
  const override = trimmed(process.env.HUB_APPS_FILE);
  return override || join(homedir(), ".config", "cairn", "apps.json");
}

function expand(p, home) {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
  return p;
}

function registeredHomes() {
  const home = homedir();
  let raw = {};
  try { raw = JSON.parse(readFileSync(appsFile(), "utf8")); } catch { raw = {}; }
  if (!raw || typeof raw !== "object") return [];
  const out = [];
  for (const entry of Object.values(raw)) {
    const h = entry && entry.home;
    if (!h || !Array.isArray(h.candidates)) continue;
    const over = h.envOverride ? trimmed(process.env[h.envOverride]) : "";
    const native = h.nativeEnv ? trimmed(process.env[h.nativeEnv]) : "";
    const xdg = h.xdgSubdir ? trimmed(process.env.XDG_CONFIG_HOME) : "";
    let resolved = over || native || (xdg ? join(xdg, h.xdgSubdir) : "");
    if (!resolved) {
      const cands = h.candidates.map((c) => expand(c, home));
      resolved = cands.find((c) => existsSync(c)) || cands[cands.length - 1] || "";
    }
    if (resolved) out.push(resolved);
  }
  return out;
}

// every registered app home (built-in claude/opencode + apps.json), deduped.
export function allHomes() {
  const homes = [];
  for (const home of [claudeHome(), opencodeHome(), ...registeredHomes()]) {
    if (home && !homes.includes(home)) homes.push(home);
  }
  return homes;
}

// app homes that exist on disk; an absent home means that app isn't installed.
export function existingHomes() {
  return allHomes().filter((home) => existsSync(home));
}
