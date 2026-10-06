import { parsePrRef, formatPrRef } from "@pr-sentinel/mcp-server";
import type { SentinelConfig } from "./config.js";
import { parseUnifiedDiff } from "./diff.js";
import { formatInlineComment, formatSummaryComment, notifyWebhook } from "./escalation.js";
import { ADJUDICATE_SYSTEM, adjudicatePrompt, parseAdjudication, parseFindings, REVIEW_SYSTEM, reviewPrompt } from "./prompts.js";
import type { LLMProvider } from "./providers/types.js";
import { routeAll } from "./routing.js";
import type { SentinelTools } from "./tools.js";
import type { EvaluatedFinding, ReviewReport, RunEvent, TestRunEvidence } from "./types.js";
import { assessFinding, finalizeVerification, recalculateConfidence, toEvidence } from "./verification.js";

export interface ReviewAgentOptions {
  tools: SentinelTools;
  provider: LLMProvider;
  config: SentinelConfig;
  onEvent?: (e: RunEvent) => void;
  /** Only used to label the report; dry-run itself is enforced by the MCP server. */
  dryRun?: boolean;
  webhookFetch?: typeof fetch;
}

/**
 * The self-verifying review loop:
 *   1. fetch the diff (MCP get_pr_diff)
 *   2. ask the LLM for findings with calibrated confidence
 *   3. verify behavioural findings by running the affected tests (MCP run_affected_tests),
 *      letting the LLM adjudicate whether a failure really supports the finding
 *   4. recompute confidence from the evidence
 *   5. route by threshold: auto-comment / escalate to humans / drop
 *   6. deliver (MCP post_review_comment, add_pr_labels, webhook)
 */
export class ReviewAgent {
  private testRuns = 0;

  constructor(private readonly opts: ReviewAgentOptions) {}

  private emit(kind: RunEvent["kind"], message: string, data?: Record<string, unknown>) {
    this.opts.onEvent?.({ at: new Date().toISOString(), kind, message, data });
  }

  private async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.emit("step_started", name, { step: name });
    const t = Date.now();
    try {
      const out = await fn();
      this.emit("step_completed", name, { step: name, durationMs: Date.now() - t });
      return out;
    } catch (err) {
      this.emit("error", `${name} failed: ${err instanceof Error ? err.message : String(err)}`, { step: name });
      throw err;
    }
  }

  async review(prInput: string): Promise<ReviewReport> {
    const { tools, provider, config } = this.opts;
    const pr = formatPrRef(parsePrRef(prInput));
    const startedAt = new Date().toISOString();
    this.testRuns = 0;
    this.emit("run_started", `Reviewing ${pr} with ${provider.name}`, { pr, provider: provider.name });

    // 1. diff
    const { pr: info, diff, truncated } = await this.step("fetch_diff", () => tools.getPrDiff(pr));
    const parsedDiff = parseUnifiedDiff(diff);
    if (truncated) this.emit("error", "Diff truncated; review covers a partial diff.");

    // 2. findings
    const generated = await this.step("generate_findings", async () => {
      const raw = await provider.complete({
        task: "review",
        system: REVIEW_SYSTEM,
        prompt: reviewPrompt({ title: info.title, body: info.body, diff }),
        context: { title: info.title, body: info.body, diff }
      });
      const { findings, rejected } = parseFindings(raw);
      if (rejected) this.emit("error", `Discarded ${rejected} malformed finding(s) from the model.`);
      return findings
        .filter((f) => parsedDiff.has(f.file))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, config.limits.maxFindings);
    });

    const findings: EvaluatedFinding[] = generated.map((f, i) => ({
      ...f,
      id: `F${i + 1}`,
      initialConfidence: f.confidence,
      anchored: parsedDiff.get(f.file)?.rightLines.has(f.line) ?? false,
      verification: { verdict: "skipped", reason: "pending" },
      decision: { action: "drop", reason: "pending" }
    }));
    for (const f of findings) {
      this.emit("finding_generated", `${f.id} ${f.title} (${f.file}:${f.line}, conf ${f.confidence.toFixed(2)})`, { finding: f });
    }

    // 3 + 4. verify and recompute confidence
    await this.step("verify_findings", async () => {
      const runsByFile = new Map<string, TestRunEvidence | undefined>();
      for (const f of findings) {
        let run: TestRunEvidence | undefined;
        if (config.verification.enabled && f.kind === "behavioral") {
          run = await this.testRunFor(pr, f.file, runsByFile);
        }
        const base = assessFinding(f, run);
        let adjudication: { supports: boolean; explanation: string } | undefined;
        if (base.verdict === "needs_adjudication" && run && config.verification.adjudicate) {
          try {
            const raw = await provider.complete({
              task: "adjudicate",
              system: ADJUDICATE_SYSTEM,
              prompt: adjudicatePrompt({ finding: f, testRun: run }),
              context: { finding: f, testRun: run }
            });
            adjudication = parseAdjudication(raw);
          } catch (err) {
            adjudication = { supports: false, explanation: `Adjudication failed: ${err instanceof Error ? err.message : String(err)}` };
          }
        }
        f.verification = finalizeVerification(base, run, adjudication);
        f.confidence = recalculateConfidence(f.initialConfidence, f.verification.verdict, config.verification);
        this.emit(
          "finding_verified",
          `${f.id} ${f.verification.verdict}: ${f.initialConfidence.toFixed(2)} → ${f.confidence.toFixed(2)}`,
          { id: f.id, verification: f.verification, confidence: f.confidence }
        );
      }
    });

    // 5. route
    await this.step("route_findings", async () => {
      const decisions = routeAll(findings, config);
      for (const f of findings) {
        f.decision = decisions.get(f.id)!;
        this.emit("finding_routed", `${f.id} → ${f.decision.action} (${f.decision.reason})`, { id: f.id, decision: f.decision });
      }
    });

    // 6. deliver
    const escalated = findings.filter((f) => f.decision.action === "escalate");
    await this.step("deliver", async () => {
      for (const f of findings.filter((x) => x.decision.action === "comment")) {
        try {
          const res = await tools.postReviewComment(pr, {
            body: formatInlineComment(f),
            ...(f.anchored ? { path: f.file, line: f.line } : {})
          });
          f.delivery = { posted: res.posted, dryRun: res.dryRun, url: res.url };
          this.emit("comment_posted", `${f.id} ${res.dryRun ? "recorded (dry-run)" : "posted"}`, { id: f.id, ...res });
        } catch (err) {
          f.delivery = { posted: false, dryRun: false, error: err instanceof Error ? err.message : String(err) };
          this.emit("error", `Failed to post ${f.id}: ${f.delivery.error}`);
        }
      }
      if (escalated.length) {
        await tools.addLabels(pr, [config.escalation.label]);
        if (config.escalation.webhookUrl) {
          try {
            await notifyWebhook(config.escalation.webhookUrl, info, escalated, this.opts.webhookFetch);
          } catch (err) {
            this.emit("error", `Escalation webhook failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        this.emit("escalated", `${escalated.length} finding(s) escalated (label "${config.escalation.label}")`, { ids: escalated.map((f) => f.id) });
      }
      if (config.summaryComment || escalated.length) {
        await tools.postReviewComment(pr, { body: formatSummaryComment(findings, config) });
      }
    });

    const report: ReviewReport = {
      pr: info,
      provider: provider.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      findings,
      dryRun: this.opts.dryRun ?? false,
      summary: {
        generated: findings.length,
        commented: findings.filter((f) => f.decision.action === "comment").length,
        escalated: escalated.length,
        dropped: findings.filter((f) => f.decision.action === "drop").length,
        testRuns: this.testRuns,
        toolCalls: "callCount" in tools ? Number((tools as { callCount: number }).callCount) : 0
      }
    };
    this.emit("run_completed", `Done: ${report.summary.commented} commented, ${report.summary.escalated} escalated, ${report.summary.dropped} dropped`, { summary: report.summary });
    return report;
  }

  /** One test run per changed file, cached, bounded by verification.maxTestRuns. */
  private async testRunFor(pr: string, file: string, cache: Map<string, TestRunEvidence | undefined>): Promise<TestRunEvidence | undefined> {
    if (cache.has(file)) return cache.get(file);
    if (this.testRuns >= this.opts.config.verification.maxTestRuns) {
      cache.set(file, undefined);
      return undefined;
    }
    this.testRuns++;
    let evidence: TestRunEvidence;
    try {
      evidence = toEvidence(await this.opts.tools.runAffectedTests(pr, [file]));
    } catch (err) {
      evidence = { status: "error", command: "", testFiles: [], failures: [], durationMs: 0, outputExcerpt: err instanceof Error ? err.message : String(err) };
    }
    this.emit("tool_call", `run_affected_tests ${file}: ${evidence.status}`, { file, status: evidence.status, testFiles: evidence.testFiles });
    cache.set(file, evidence);
    return evidence;
  }
}
