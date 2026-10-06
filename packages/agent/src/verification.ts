import type { AffectedTestsResult } from "@pr-sentinel/mcp-server";
import type { SentinelConfig } from "./config.js";
import type { Finding, TestRunEvidence, Verdict, VerificationEvidence } from "./types.js";

export function toEvidence(run: AffectedTestsResult): TestRunEvidence {
  return {
    status: run.status,
    command: run.command,
    testFiles: run.testFiles,
    failures: run.failures,
    counts: run.counts,
    durationMs: run.durationMs,
    outputExcerpt: run.output.slice(-2000)
  };
}

/**
 * Deterministic first pass: what does the test run say about this finding?
 * A failing run is only "candidate support"; it becomes `confirmed` after adjudication
 * (the agent checks the failure is actually about this finding).
 */
export function assessFinding(finding: Finding, run: TestRunEvidence | undefined): { verdict: Verdict | "needs_adjudication"; reason: string } {
  if (finding.kind === "static") {
    return { verdict: "not_applicable", reason: "Static finding; not falsifiable by tests." };
  }
  if (!run) return { verdict: "skipped", reason: "Verification skipped (disabled or test-run budget exhausted)." };
  switch (run.status) {
    case "no_tests":
      return { verdict: "inconclusive", reason: `No tests cover ${finding.file}.` };
    case "timed_out":
      return { verdict: "inconclusive", reason: "Affected tests timed out." };
    case "error":
      return { verdict: "inconclusive", reason: "Affected tests could not be executed." };
    case "passed":
      return {
        verdict: "refuted",
        reason: `All ${run.counts ? run.counts.passed + " " : ""}affected tests passed (${run.testFiles.join(", ")}); the claimed behaviour is not observed.`
      };
    case "failed":
      return { verdict: "needs_adjudication", reason: `${run.failures.length || "Some"} affected test(s) failed.` };
  }
}

/** Bayesian-flavoured update of the model's prior confidence given verification evidence. */
export function recalculateConfidence(prior: number, verdict: Verdict, cfg: SentinelConfig["verification"]): number {
  let next: number;
  switch (verdict) {
    case "confirmed":
      next = prior + (1 - prior) * cfg.confirmBoost;
      break;
    case "refuted":
      next = prior * cfg.refuteFactor;
      break;
    case "inconclusive":
    case "skipped":
      next = prior * cfg.inconclusiveFactor;
      break;
    case "not_applicable":
      next = prior;
      break;
  }
  return Math.round(Math.min(1, Math.max(0, next)) * 1000) / 1000;
}

export function finalizeVerification(
  base: { verdict: Verdict | "needs_adjudication"; reason: string },
  run: TestRunEvidence | undefined,
  adjudication?: { supports: boolean; explanation: string }
): VerificationEvidence {
  if (base.verdict !== "needs_adjudication") return { verdict: base.verdict, reason: base.reason, testRun: run };
  if (!adjudication) {
    // adjudication disabled: a failing affected test counts as confirmation
    return { verdict: "confirmed", reason: base.reason, testRun: run };
  }
  return {
    verdict: adjudication.supports ? "confirmed" : "inconclusive",
    reason: `${base.reason} ${adjudication.explanation}`.trim(),
    testRun: run,
    adjudication
  };
}
