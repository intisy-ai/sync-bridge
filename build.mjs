// Bundle into self-contained ESM files. OpenCode/Claude deploy each plugin as one
// file (plugin/<name>.js), so sibling modules must be inlined — plain tsc output
// fails at load with "Cannot find module './sync.js'". We emit TWO bundles:
//   dist/index.js — the plugin hook (exports ONLY SyncBridgePlugin)
//   dist/lib.js   — the in-process library API (syncPlugins, sync, homes…)
import { build } from "esbuild";

const common = { bundle: true, external: ["@intisy-ai/core", "@intisy-ai/api"], platform: "node", format: "esm", target: "node20", logLevel: "info" };

await build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/index.js" });
await build({ ...common, entryPoints: ["src/lib.ts"], outfile: "dist/lib.js" });

console.log("Bundled sync-bridge -> dist/index.js (hook) + dist/lib.js (library)");
