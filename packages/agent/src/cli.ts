#!/usr/bin/env node
import { parseArgs } from "node:util";
import { serverOptionsFromEnv } from "@pr-sentinel/mcp-server";
import { ReviewAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import { createProvider } from "./providers/index.js";
import { connectInProcess, connectStdio } from "./tools.js";

const HELP = `Usage: pr-sentinel review <owner/repo#123 | PR URL> [options]

Options:
  --provider <mock|openai|anthropic>  LLM provider (default: $LLM_PROVIDER or mock)
  --config <path>                     sentinel.config.json (default: ./sentinel.config.json if present)
  --dry-run                           Record comments/labels instead of writing to GitHub
  --transport <stdio|memory>          How to reach the MCP server (default: stdio)
  --json                              Print the full report as JSON

Without GITHUB_TOKEN the bundled demo PR (demo/acme-shop#42) is served from fixtures.`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      provider: { type: "string" },
      config: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      transport: { type: "string", default: "stdio" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  });
  const [command, pr] = positionals;
  if (values.help || command !== "review" || !pr) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const config = await loadConfig(values.config);
  const provider = createProvider(values.provider);
  const dryRun = values["dry-run"] || !process.env.GITHUB_TOKEN;
  const env = { ...process.env, SENTINEL_DRY_RUN: dryRun ? "true" : process.env.SENTINEL_DRY_RUN };

  const conn =
    values.transport === "memory"
      ? await connectInProcess(await serverOptionsFromEnv(env))
      : await connectStdio({
          PATH: process.env.PATH,
          GITHUB_TOKEN: process.env.GITHUB_TOKEN,
          GITHUB_API_URL: process.env.GITHUB_API_URL,
          SENTINEL_DRY_RUN: env.SENTINEL_DRY_RUN,
          SENTINEL_DEMO: process.env.SENTINEL_DEMO,
          SENTINEL_TEST_COMMAND: process.env.SENTINEL_TEST_COMMAND,
          SENTINEL_TEST_TIMEOUT_MS: process.env.SENTINEL_TEST_TIMEOUT_MS,
          SENTINEL_WORKSPACE_DIR: process.env.SENTINEL_WORKSPACE_DIR,
          SENTINEL_INSTALL_COMMAND: process.env.SENTINEL_INSTALL_COMMAND
        });

  const agent = new ReviewAgent({
    tools: conn.tools,
    provider,
    config,
    dryRun,
    onEvent: (e) => {
      if (!values.json) console.log(`${new Date(e.at).toLocaleTimeString("en-GB")}  ${e.kind.padEnd(17)} ${e.message}`);
    }
  });

  try {
    const report = await agent.review(pr);
    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log("\nFindings:");
      for (const f of report.findings) {
        console.log(
          `  [${f.decision.action.toUpperCase().padEnd(8)}] ${f.id} ${f.file}:${f.line} ${f.title}\n` +
            `             ${f.verification.verdict}; confidence ${f.initialConfidence.toFixed(2)} → ${f.confidence.toFixed(2)}`
        );
      }
      if (conn.outbox?.length) console.log(`\nDry-run outbox: ${conn.outbox.length} write(s) suppressed.`);
    }
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
