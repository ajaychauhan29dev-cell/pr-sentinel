import type { SentinelConfig } from "./config.js";
import type { Action, Category } from "./types.js";

export interface RoutingInput {
  id: string;
  confidence: number;
  category: Category;
}

/** Threshold policy: >= autoComment -> comment, [escalate, autoComment) -> human, below -> drop. */
export function routeFinding(f: RoutingInput, cfg: Pick<SentinelConfig, "thresholds" | "alwaysEscalateCategories">): { action: Action; reason: string } {
  const { autoComment, escalate } = cfg.thresholds;
  const c = f.confidence.toFixed(2);
  if (f.confidence < escalate) return { action: "drop", reason: `confidence ${c} < escalate threshold ${escalate}` };
  if (cfg.alwaysEscalateCategories.includes(f.category)) {
    return { action: "escalate", reason: `category "${f.category}" always requires human review` };
  }
  if (f.confidence >= autoComment) return { action: "comment", reason: `confidence ${c} >= autoComment threshold ${autoComment}` };
  return { action: "escalate", reason: `confidence ${c} in [${escalate}, ${autoComment})` };
}

/**
 * Routes a batch and enforces `limits.maxComments`: the most confident findings keep their
 * comment slot; overflow is escalated rather than silently dropped.
 */
export function routeAll<T extends RoutingInput>(findings: T[], cfg: Pick<SentinelConfig, "thresholds" | "alwaysEscalateCategories" | "limits">): Map<string, { action: Action; reason: string }> {
  const out = new Map<string, { action: Action; reason: string }>();
  for (const f of findings) out.set(f.id, routeFinding(f, cfg));
  const commenting = findings.filter((f) => out.get(f.id)?.action === "comment").sort((a, b) => b.confidence - a.confidence);
  for (const f of commenting.slice(cfg.limits.maxComments)) {
    out.set(f.id, { action: "escalate", reason: `comment cap (${cfg.limits.maxComments}) reached` });
  }
  return out;
}
