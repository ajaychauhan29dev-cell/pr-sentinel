import type { PullRequestInfo } from "@pr-sentinel/mcp-server";
import type { SentinelConfig } from "./config.js";
import type { FetchLike } from "./providers/http.js";
import type { EvaluatedFinding } from "./types.js";

const VERDICT_ICON: Record<string, string> = {
  confirmed: "✅ confirmed by tests",
  refuted: "❌ refuted by tests",
  inconclusive: "❔ inconclusive",
  not_applicable: "➖ static (not test-verifiable)",
  skipped: "⏭️ not verified"
};

export function verificationLine(f: EvaluatedFinding): string {
  const v = f.verification;
  const failing = v.testRun?.failures.map((x) => `\`${x.name}\``).join(", ");
  return `${VERDICT_ICON[v.verdict]}${failing ? ` — failing: ${failing}` : ""}`;
}

export function formatInlineComment(f: EvaluatedFinding): string {
  return [
    `**${f.severity.toUpperCase()} · ${f.category}** — ${f.title}`,
    "",
    f.rationale,
    f.suggestion ? `\n**Suggestion:** ${f.suggestion}` : "",
    "",
    `<sub>PR Sentinel · confidence ${f.confidence.toFixed(2)} (model ${f.initialConfidence.toFixed(2)}) · ${verificationLine(f)}</sub>`
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");
}

export function formatSummaryComment(findings: EvaluatedFinding[], cfg: SentinelConfig): string {
  const commented = findings.filter((f) => f.decision.action === "comment");
  const escalated = findings.filter((f) => f.decision.action === "escalate");
  const dropped = findings.filter((f) => f.decision.action === "drop");
  const lines = [
    "## 🛡️ PR Sentinel review",
    "",
    `${commented.length} comment(s) posted · ${escalated.length} escalated for human review · ${dropped.length} dropped (low confidence)`,
    ""
  ];
  if (escalated.length) {
    lines.push(`### Needs human review ${cfg.escalation.mentions.join(" ")}`.trimEnd(), "");
    lines.push("| Finding | Location | Confidence | Verification |", "|---|---|---|---|");
    for (const f of escalated) {
      lines.push(`| ${f.title} | \`${f.file}:${f.line}\` | ${f.confidence.toFixed(2)} | ${verificationLine(f)} |`);
    }
    lines.push("");
  }
  lines.push(
    `<sub>Thresholds: auto-comment ≥ ${cfg.thresholds.autoComment}, escalate ≥ ${cfg.thresholds.escalate}. Behavioural findings were checked by running the affected tests.</sub>`
  );
  return lines.join("\n");
}

/** Notifies an external system (Slack-compatible incoming webhook or any JSON endpoint). */
export async function notifyWebhook(url: string, pr: PullRequestInfo, escalated: EvaluatedFinding[], fetchImpl: FetchLike = globalThis.fetch as FetchLike): Promise<void> {
  const text = `PR Sentinel escalated ${escalated.length} finding(s) on ${pr.owner}/${pr.repo}#${pr.number} (${pr.title}): ${pr.htmlUrl}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      pr: { owner: pr.owner, repo: pr.repo, number: pr.number, url: pr.htmlUrl },
      findings: escalated.map((f) => ({ id: f.id, title: f.title, file: f.file, line: f.line, confidence: f.confidence, verdict: f.verification.verdict }))
    })
  });
  if (!res.ok) throw new Error(`Escalation webhook returned HTTP ${res.status}`);
}
