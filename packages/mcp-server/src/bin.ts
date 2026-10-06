#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { serverOptionsFromEnv } from "./config.js";
import { createSentinelServer } from "./server.js";

async function main() {
  const opts = await serverOptionsFromEnv();
  const { server } = createSentinelServer(opts);
  await server.connect(new StdioServerTransport());
  // stdout is the protocol channel; log to stderr only.
  console.error(`[pr-sentinel-mcp] ready (dryRun=${opts.dryRun}, testCommand="${opts.testCommand}")`);
}

main().catch((err) => {
  console.error("[pr-sentinel-mcp] fatal:", err);
  process.exit(1);
});
