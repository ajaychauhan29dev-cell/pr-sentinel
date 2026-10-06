import { DEFAULT_TEST_COMMAND, demoDependencies, DEMO_PR, type FixtureGateway } from "@pr-sentinel/mcp-server";
import { describe, expect, it, vi } from "vitest";
import { ReviewAgent } from "../src/agent.js";
import { parseConfig, type SentinelConfig } from "../src/config.js";
import { MockProvider } from "../src/providers/mock.js";
import { connectInProcess } from "../src/tools.js";
import type { RunEvent } from "../src/types.js";

async function setup(config: SentinelConfig = parseConfig({}), dryRun = false) {
  const { gateway, workspaces } = await demoDependencies();
  const conn = await connectInProcess({ gateway, workspaces, dryRun, testCommand: DEFAULT_TEST_COMMAND, testTimeoutMs: 15_000 });
  const events: RunEvent[] = [];
  const provider = new MockProvider();
  const agent = new ReviewAgent({ tools: conn.tools, provider, config, onEvent: (e) => events.push(e), webhookFetch: vi.fn(async () => new Response("ok")) as unknown as typeof fetch });
  return { agent, conn, events, provider, gateway: gateway as FixtureGateway };
}

describe("ReviewAgent (self-verifying loop, end to end over MCP)", () => {
  it("confirms, refutes and escalates findings using real test runs", async () => {
    const { agent, conn, gateway } = await setup();
    const report = await agent.review(DEMO_PR);
    await conn.close();

    const byTitle = Object.fromEntries(report.findings.map((f) => [f.title, f]));
    const boundary = byTitle["Boundary condition changed from `>=` to `>`"]!;
    expect(boundary.verification.verdict).toBe("confirmed");
    expect(boundary.verification.testRun?.failures[0]?.name).toBe("bulk discount applies at exactly the threshold");
    expect(boundary.confidence).toBeGreaterThan(boundary.initialConfidence);
    expect(boundary.decision.action).toBe("comment");

    const guard = byTitle["Defensive default removed"]!;
    expect(guard.verification.verdict).toBe("refuted");
    expect(guard.decision.action).toBe("drop");

    const swallowed = byTitle["Error is silently swallowed"]!;
    expect(swallowed.verification.verdict).toBe("inconclusive");
    expect(swallowed.decision.action).toBe("escalate");

    expect(report.summary).toMatchObject({ generated: 5, commented: 2, escalated: 1, dropped: 2, testRuns: 3 });

    // writes went through the MCP server to the gateway: 2 inline comments, label, summary
    expect(gateway.writes.map((w) => w.kind)).toEqual(["inline", "inline", "labels", "summary"]);
    expect(gateway.writes.find((w) => w.kind === "labels")?.labels).toEqual(["needs-human-review"]);
    expect(gateway.writes.at(-1)?.body).toContain("Needs human review");
  });

  it("never touches GitHub in dry-run mode", async () => {
    const { agent, conn, gateway } = await setup(parseConfig({}), true);
    await agent.review(DEMO_PR);
    expect(gateway.writes).toHaveLength(0);
    expect(conn.outbox?.map((o) => o.action)).toEqual(["review_comment", "review_comment", "labels", "issue_comment"]);
    await conn.close();
  });

  it("bounds test execution with verification.maxTestRuns", async () => {
    const { agent, conn } = await setup(parseConfig({ verification: { maxTestRuns: 1 } }));
    const report = await agent.review(DEMO_PR);
    await conn.close();
    expect(report.summary.testRuns).toBe(1);
    expect(report.findings.filter((f) => f.verification.verdict === "skipped").length).toBe(2);
  });

  it("without verification, the unverified boundary finding is escalated instead of auto-posted", async () => {
    const { agent, conn } = await setup(parseConfig({ verification: { enabled: false } }));
    const report = await agent.review(DEMO_PR);
    await conn.close();
    const boundary = report.findings.find((f) => f.title.startsWith("Boundary"))!;
    expect(boundary.verification.verdict).toBe("skipped");
    expect(boundary.decision.action).toBe("escalate");
  });

  it("uses the LLM to adjudicate failing tests and fires the escalation webhook", async () => {
    const { gateway, workspaces } = await demoDependencies();
    const conn = await connectInProcess({ gateway, workspaces, dryRun: true, testCommand: DEFAULT_TEST_COMMAND, testTimeoutMs: 15_000 });
    const provider = new MockProvider();
    const webhookFetch = vi.fn(async () => new Response("ok"));
    const agent = new ReviewAgent({
      tools: conn.tools,
      provider,
      config: parseConfig({ escalation: { webhookUrl: "https://hooks.example.com/x" } }),
      webhookFetch: webhookFetch as unknown as typeof fetch
    });
    await agent.review(DEMO_PR);
    await conn.close();
    expect(provider.calls.map((c) => c.task)).toEqual(["review", "adjudicate"]);
    expect(webhookFetch).toHaveBeenCalledOnce();
    const body = JSON.parse((webhookFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.findings).toHaveLength(1);
  });

  it("emits ordered step events for live UIs", async () => {
    const { agent, conn, events } = await setup(parseConfig({}), true);
    await agent.review(DEMO_PR);
    await conn.close();
    const steps = events.filter((e) => e.kind === "step_completed").map((e) => e.data?.step);
    expect(steps).toEqual(["fetch_diff", "generate_findings", "verify_findings", "route_findings", "deliver"]);
    expect(events.at(-1)?.kind).toBe("run_completed");
  });
});
