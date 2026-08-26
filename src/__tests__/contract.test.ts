// Universal plugin contract via core's shared test-kit.
import { runPluginContract } from "@intisy-ai/core/testing";

runPluginContract({
  name: "sync-bridge",
  entry: "dist/index.js",
  configName: "sync-bridge",
  app: "both",
  commands: ["sync"],
  deploy: "load",
  actions: [["sync"]],
  readme: true,
});
