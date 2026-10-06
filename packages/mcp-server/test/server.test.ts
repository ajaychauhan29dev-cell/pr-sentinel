import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TEST_COMMAND, DEMO_PR, demoDependencies } from "../src/config.js";
import type { FixtureGateway } from "../src/github/fixture-gateway.js";
import { createSentinelServer } from "../src/server.js";
import type { OutboxEntry } from "../src/types.js";

async function connect(dryRun: boolean) {
  const { gateway, workspaces } = await demoDependencies();
  const { server, outbox } = createSentinelServer({ gateway, workspaces, dryRun, testCommand: DEFAULT_TEST_COMMAND, testTimeoutMs: 15_000 });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return { client, gateway, outbox };
}

const data = (r: unknown) => (r as { structuredContent: Record<string, unknown> }).structuredContent;

describe("PR Sentinel MCP server", () => {
  let ctx: { client: Client; gateway: FixtureGateway; outbox: OutboxEntry[] };

  beforeEach(async () => {
    ctx = await connect(true);
  });

  it("lists the GitHub tools", async () => {
    const { tools } = await ctx.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_pr_labels",
      "get_pr_diff",
      "list_changed_files",
      "post_review_comment",
      "run_affected_tests"
    ]);
  });

  it("returns the PR diff", async () => {
    const r = data(await ctx.client.callTool({ name: "get_pr_diff", arguments: { pr: DEMO_PR } }));
    expect(r.fileCount).toBe(4);
    expect(r.diff).toContain("+  if (quantity > BULK_THRESHOLD) {");
  });

  it("runs affected tests and reports failures", async () => {
    const r = data(await ctx.client.callTool({ name: "run_affected_tests", arguments: { pr: DEMO_PR, files: ["src/pricing.js"] } }));
    expect(r.status).toBe("failed");
    expect(r.testFiles).toEqual(["test/pricing.test.js"]);
    expect(r.failures).toEqual([{ name: "bulk discount applies at exactly the threshold" }]);
  });

  it("reports no_tests for files without coverage", async () => {
    const r = data(await ctx.client.callTool({ name: "run_affected_tests", arguments: { pr: DEMO_PR, files: ["src/webhooks.js"] } }));
    expect(r.status).toBe("no_tests");
    expect(r.unmapped).toEqual(["src/webhooks.js"]);
  });

  it("records instead of posting in dry-run mode", async () => {
    const r = data(await ctx.client.callTool({ name: "post_review_comment", arguments: { pr: DEMO_PR, body: "hello", path: "src/cart.js", line: 4 } }));
    expect(r).toMatchObject({ posted: false, dryRun: true, kind: "inline" });
    expect(ctx.outbox).toHaveLength(1);
    expect(ctx.gateway.writes).toHaveLength(0);
  });

  it("posts through the gateway when not in dry-run", async () => {
    const live = await connect(false);
    await live.client.callTool({ name: "post_review_comment", arguments: { pr: DEMO_PR, body: "summary" } });
    await live.client.callTool({ name: "add_pr_labels", arguments: { pr: DEMO_PR, labels: ["needs-human-review"] } });
    expect(live.gateway.writes.map((w) => w.kind)).toEqual(["summary", "labels"]);
  });

  it("surfaces errors as tool errors", async () => {
    const r = await ctx.client.callTool({ name: "get_pr_diff", arguments: { pr: "nope/nope#1" } });
    expect(r.isError).toBe(true);
  });
});
