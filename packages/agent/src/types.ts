import type { AffectedTestsResult, PullRequestInfo } from "@pr-sentinel/mcp-server";

export const SEVERITIES = ["info", "minor", "major", "critical"] as const;
export const CATEGORIES = ["bug", "security", "performance", "error-handling", "style", "maintainability", "testing"] as const;

export type Severity = (typeof SEVERITIES)[number];
export type Category = (typeof CATEGORIES)[number];

/**
 * A finding as proposed by the LLM. `kind` says whether the claim is about runtime
 * behaviour (and therefore falsifiable by running tests) or purely static.
 */
export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  category: Category;
  title: string;
  rationale: string;
  suggestion?: string;
  confidence: number;
  kind: "behavioral" | "static";
}

export type Verdict = "confirmed" | "refuted" | "inconclusive" | "not_applicable" | "skipped";

export interface TestRunEvidence {
  status: AffectedTestsResult["status"];
  command: string;
  testFiles: string[];
  failures: AffectedTestsResult["failures"];
  counts?: AffectedTestsResult["counts"];
  durationMs: number;
  outputExcerpt: string;
}

export interface VerificationEvidence {
  verdict: Verdict;
  reason: string;
  testRun?: TestRunEvidence;
  adjudication?: { supports: boolean; explanation: string };
}

export type Action = "comment" | "escalate" | "drop";

export interface EvaluatedFinding extends Finding {
  id: string;
  initialConfidence: number;
  /** Whether `line` is on the RIGHT side of the diff (required for inline comments). */
  anchored: boolean;
  verification: VerificationEvidence;
  decision: { action: Action; reason: string };
  delivery?: { posted: boolean; dryRun: boolean; url?: string; error?: string };
}

export type RunEventKind =
  | "run_started"
  | "step_started"
  | "step_completed"
  | "tool_call"
  | "finding_generated"
  | "finding_verified"
  | "finding_routed"
  | "comment_posted"
  | "escalated"
  | "error"
  | "run_completed";

export interface RunEvent {
  at: string;
  kind: RunEventKind;
  message: string;
  data?: Record<string, unknown>;
}

export interface ReviewReport {
  pr: PullRequestInfo;
  provider: string;
  startedAt: string;
  finishedAt: string;
  findings: EvaluatedFinding[];
  summary: { generated: number; commented: number; escalated: number; dropped: number; testRuns: number; toolCalls: number };
  dryRun: boolean;
}
