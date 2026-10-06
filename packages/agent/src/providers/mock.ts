import { parseUnifiedDiff, type DiffLine } from "../diff.js";
import type { Finding } from "../types.js";
import type { AdjudicationContext, CompletionRequest, LLMProvider } from "./types.js";

/**
 * Deterministic, offline stand-in for an LLM. It applies a handful of review heuristics to
 * the diff and emits the same JSON shape a real model is asked for, so the full agent
 * pipeline (parsing, verification, routing) runs unchanged in demos and tests.
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly calls: CompletionRequest[] = [];

  async complete(req: CompletionRequest): Promise<string> {
    this.calls.push(req);
    if (req.task === "review") return JSON.stringify({ findings: heuristicReview(req.context.diff) });
    return JSON.stringify(heuristicAdjudication(req.context));
  }
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const keywords = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((w) => w.length >= 4)
  );

export function heuristicReview(diff: string): Finding[] {
  const findings: Finding[] = [];
  for (const [file, fd] of parseUnifiedDiff(diff)) {
    for (const hunk of fd.hunks) {
      const removed = hunk.lines.filter((l) => l.type === "del");
      const added = hunk.lines.filter((l): l is DiffLine & { newLine: number } => l.type === "add" && l.newLine !== undefined);

      for (const add of added) {
        const text = add.text;

        // 1. Comparison boundary flipped (>= -> >, <= -> <, and vice versa)
        const flipped = removed.find((r) => {
          const a = norm(r.text);
          const b = norm(text);
          return a !== b && (a.replace(/>=/g, ">") === b || a.replace(/<=/g, "<") === b || b.replace(/>=/g, ">") === a || b.replace(/<=/g, "<") === a);
        });
        if (flipped) {
          const before = /([<>]=?)/.exec(flipped.text)?.[1] ?? "?";
          const after = /([<>]=?)/.exec(text)?.[1] ?? "?";
          findings.push({
            file,
            line: add.newLine,
            severity: "major",
            category: "bug",
            kind: "behavioral",
            title: `Boundary condition changed from \`${before}\` to \`${after}\``,
            rationale: `The comparison \`${norm(flipped.text)}\` became \`${norm(text)}\`. Values exactly at the threshold are now handled differently, which looks like an unintended off-by-one change.`,
            suggestion: `Restore \`${before}\` unless excluding the threshold value is intentional (and covered by a test).`,
            confidence: 0.62
          });
        }

        // 2. Debug output left in
        if (/\bconsole\.(log|debug)\(|\bdebugger\b/.test(text)) {
          findings.push({
            file,
            line: add.newLine,
            severity: "minor",
            category: "style",
            kind: "static",
            title: "Debug logging left in production code",
            rationale: "This `console.log` looks like leftover debugging output; it adds noise and may log customer data.",
            suggestion: "Remove it or route it through the application logger at debug level.",
            confidence: 0.85
          });
        }

        // 3. Removed nullish/optional-chaining guard
        const unguarded = removed.find((r) => /\?\?\s*(\[\]|\{\})|\?\./.test(r.text) && !/\?\?|\?\./.test(text) && sharesIdentifier(r.text, text));
        if (unguarded) {
          findings.push({
            file,
            line: add.newLine,
            severity: "major",
            category: "bug",
            kind: "behavioral",
            title: "Defensive default removed",
            rationale: `\`${norm(unguarded.text)}\` guarded against null/undefined input; the new code will throw a TypeError when called without a value.`,
            suggestion: "Keep the nullish default or validate the argument explicitly.",
            confidence: 0.58
          });
        }

        // 4. Swallowed errors
        if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(text)) {
          findings.push({
            file,
            line: add.newLine,
            severity: "major",
            category: "error-handling",
            kind: "behavioral",
            title: "Error is silently swallowed",
            rationale: "The empty catch block hides failures from `send`, yet the function still reports success to its caller.",
            suggestion: "Log and rethrow, or return a failure result so callers can retry.",
            confidence: 0.7
          });
        }

        // 5. Hard-coded secret
        if (/(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/i.test(text)) {
          findings.push({
            file,
            line: add.newLine,
            severity: "critical",
            category: "security",
            kind: "static",
            title: "Possible hard-coded credential",
            rationale: "A credential-like literal is committed to source control.",
            suggestion: "Move it to a secret manager / environment variable and rotate the value.",
            confidence: 0.9
          });
        }

        // 6. New TODO
        if (/\b(TODO|FIXME)\b/.test(text)) {
          findings.push({
            file,
            line: add.newLine,
            severity: "info",
            category: "maintainability",
            kind: "static",
            title: "New TODO added",
            rationale: "Consider tracking this in an issue instead of a code comment.",
            confidence: 0.3
          });
        }
      }
    }
  }
  return findings;
}

function sharesIdentifier(a: string, b: string): boolean {
  const ka = keywords(a);
  return [...keywords(b)].some((w) => ka.has(w));
}

/** Does the failing test plausibly relate to the finding? Keyword overlap between finding and failure names. */
export function heuristicAdjudication({ finding, testRun }: AdjudicationContext): { supports: boolean; explanation: string } {
  if (testRun.status !== "failed") {
    return { supports: false, explanation: `Tests did not fail (status: ${testRun.status}).` };
  }
  if (testRun.failures.length === 0) {
    return { supports: true, explanation: "The affected tests failed, but individual failures could not be parsed." };
  }
  const fk = keywords(`${finding.title} ${finding.rationale}`);
  const related = testRun.failures.filter((f) => [...keywords(f.name)].some((w) => fk.has(w)));
  if (related.length > 0) {
    return { supports: true, explanation: `Failing test(s) ${related.map((r) => `"${r.name}"`).join(", ")} exercise the behaviour described by the finding.` };
  }
  return { supports: false, explanation: "Tests failed, but the failures do not appear related to this finding." };
}
