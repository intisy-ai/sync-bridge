// Universal plugin contract via basekit's shared test-kit.
import { runPluginContract } from "@intisy-ai/basekit/testing";

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
