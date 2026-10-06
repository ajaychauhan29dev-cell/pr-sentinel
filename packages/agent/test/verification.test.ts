import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { heuristicAdjudication } from "../src/providers/mock.js";
import type { Finding, TestRunEvidence } from "../src/types.js";
import { assessFinding, finalizeVerification, recalculateConfidence } from "../src/verification.js";

const v = DEFAULT_CONFIG.verification;
const finding = (over: Partial<Finding> = {}): Finding => ({
  file: "src/pricing.js",
  line: 14,
  severity: "major",
  category: "bug",
  kind: "behavioral",
  title: "Boundary condition changed",
  rationale: "Values exactly at the threshold are now handled differently.",
  confidence: 0.6,
  ...over
});
const run = (over: Partial<TestRunEvidence> = {}): TestRunEvidence => ({
  status: "passed",
  command: "node --test test/pricing.test.js",
  testFiles: ["test/pricing.test.js"],
  failures: [],
  durationMs: 10,
  outputExcerpt: "",
  ...over
});

describe("recalculateConfidence", () => {
  it("boosts confirmed findings towards 1", () => {
    expect(recalculateConfidence(0.6, "confirmed", v)).toBe(0.84);
  });
  it("penalises refuted findings", () => {
    expect(recalculateConfidence(0.6, "refuted", v)).toBe(0.21);
  });
  it("slightly discounts unverifiable findings", () => {
    expect(recalculateConfidence(0.6, "inconclusive", v)).toBe(0.54);
    expect(recalculateConfidence(0.6, "skipped", v)).toBe(0.54);
  });
  it("leaves static findings unchanged", () => {
    expect(recalculateConfidence(0.6, "not_applicable", v)).toBe(0.6);
  });
  it("stays within [0, 1]", () => {
    expect(recalculateConfidence(1, "confirmed", { ...v, confirmBoost: 1 })).toBe(1);
    expect(recalculateConfidence(0, "refuted", v)).toBe(0);
  });
});

describe("assessFinding", () => {
  it("does not test static findings", () => {
    expect(assessFinding(finding({ kind: "static" }), run()).verdict).toBe("not_applicable");
  });
  it("treats passing affected tests as refutation", () => {
    expect(assessFinding(finding(), run()).verdict).toBe("refuted");
  });
  it("needs adjudication when tests fail", () => {
    expect(assessFinding(finding(), run({ status: "failed" })).verdict).toBe("needs_adjudication");
  });
  it.each(["no_tests", "timed_out", "error"] as const)("is inconclusive when status is %s", (status) => {
    expect(assessFinding(finding(), run({ status })).verdict).toBe("inconclusive");
  });
  it("is skipped when no run happened (budget/disabled)", () => {
    expect(assessFinding(finding(), undefined).verdict).toBe("skipped");
  });
});

describe("adjudication of failing tests", () => {
  it("confirms when the failure relates to the finding", () => {
    const r = run({ status: "failed", failures: [{ name: "bulk discount applies at exactly the threshold" }] });
    const adj = heuristicAdjudication({ finding: finding(), testRun: r });
    expect(adj.supports).toBe(true);
    expect(finalizeVerification(assessFinding(finding(), r), r, adj).verdict).toBe("confirmed");
  });

  it("does not confirm on an unrelated failure", () => {
    const r = run({ status: "failed", failures: [{ name: "formats currency symbols" }] });
    const adj = heuristicAdjudication({ finding: finding(), testRun: r });
    expect(adj.supports).toBe(false);
    expect(finalizeVerification(assessFinding(finding(), r), r, adj).verdict).toBe("inconclusive");
  });

  it("confirms on any failure when adjudication is disabled", () => {
    const r = run({ status: "failed" });
    expect(finalizeVerification(assessFinding(finding(), r), r, undefined).verdict).toBe("confirmed");
  });
});
