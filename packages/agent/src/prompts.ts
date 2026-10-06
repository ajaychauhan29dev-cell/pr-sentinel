import { z } from "zod";
import type { AdjudicationContext, ReviewContext } from "./providers/types.js";
import { CATEGORIES, SEVERITIES, type Finding } from "./types.js";

export const REVIEW_SYSTEM = `You are PR Sentinel, a meticulous senior code reviewer.
Review ONLY the changes in the diff. Report concrete, actionable problems (bugs, security, error handling, performance, maintainability); do not praise or restate the diff.
For each finding:
- "file" and "line" must point at a line on the new (right) side of the diff.
- "confidence" is your calibrated probability (0-1) that a human expert would agree.
- "kind" is "behavioral" if the claim is about runtime behaviour that a test could reveal, otherwise "static".
Your behavioural findings will be checked by actually running the affected tests, so be precise.
Respond with JSON: {"findings": Finding[]}.`;

export function reviewPrompt(ctx: ReviewContext): string {
  return [
    `Pull request: ${ctx.title}`,
    ctx.body ? `Description:\n${ctx.body}` : "",
    "Finding schema:",
    JSON.stringify({
      file: "string",
      line: "number",
      severity: SEVERITIES.join("|"),
      category: CATEGORIES.join("|"),
      kind: "behavioral|static",
      title: "string (<= 100 chars)",
      rationale: "string",
      suggestion: "string (optional)",
      confidence: "number 0-1"
    }),
    "Diff:",
    "```diff",
    ctx.diff,
    "```"
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const ADJUDICATE_SYSTEM = `You verify code review findings against test evidence.
Given a finding and the output of the tests covering the affected file, decide whether the test result SUPPORTS the finding (the failure is caused by the issue described), or not (tests passed, or failed for an unrelated reason).
Respond with JSON: {"supports": boolean, "explanation": string}.`;

export function adjudicatePrompt(ctx: AdjudicationContext): string {
  return [
    "Finding:",
    JSON.stringify(ctx.finding, null, 2),
    `Test command: ${ctx.testRun.command}`,
    `Status: ${ctx.testRun.status}`,
    `Failures: ${JSON.stringify(ctx.testRun.failures)}`,
    "Output (tail):",
    "```",
    ctx.testRun.outputExcerpt,
    "```"
  ].join("\n");
}

const FindingSchema = z.object({
  file: z.string().min(1),
  line: z.coerce.number().int().positive(),
  severity: z.enum(SEVERITIES).catch("minor"),
  category: z.enum(CATEGORIES).catch("maintainability"),
  kind: z.enum(["behavioral", "static"]).catch("static"),
  title: z.string().min(1).max(200),
  rationale: z.string().min(1),
  suggestion: z.string().optional(),
  confidence: z.coerce.number().transform((n) => Math.min(1, Math.max(0, n)))
});

const ReviewSchema = z.object({ findings: z.array(z.unknown()) });
const AdjudicationSchema = z.object({ supports: z.boolean(), explanation: z.string().default("") });

/** Extracts the first JSON object from model text (tolerates ```json fences and preambles). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Model response did not contain a JSON object");
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Parses findings; individually malformed findings are discarded rather than failing the run. */
export function parseFindings(text: string): { findings: Finding[]; rejected: number } {
  const { findings: raw } = ReviewSchema.parse(extractJson(text));
  const findings: Finding[] = [];
  let rejected = 0;
  for (const item of raw) {
    const r = FindingSchema.safeParse(item);
    if (r.success) findings.push(r.data);
    else rejected++;
  }
  return { findings, rejected };
}

export function parseAdjudication(text: string): { supports: boolean; explanation: string } {
  return AdjudicationSchema.parse(extractJson(text));
}
