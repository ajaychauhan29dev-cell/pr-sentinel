import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CATEGORIES } from "./types.js";

const unit = z.number().min(0).max(1);

export const ConfigSchema = z
  .object({
    thresholds: z
      .object({
        /** confidence >= autoComment -> posted automatically */
        autoComment: unit.default(0.8),
        /** escalate <= confidence < autoComment -> human review; below -> dropped */
        escalate: unit.default(0.5)
      })
      .default({ autoComment: 0.8, escalate: 0.5 })
      .refine((t) => t.escalate <= t.autoComment, { message: "thresholds.escalate must be <= thresholds.autoComment" }),
    verification: z
      .object({
        enabled: z.boolean().default(true),
        /** Ask the LLM whether a failing test actually supports the finding before confirming it. */
        adjudicate: z.boolean().default(true),
        /** confirmed: c + (1 - c) * confirmBoost */
        confirmBoost: unit.default(0.6),
        /** refuted (tests ran and passed): c * refuteFactor */
        refuteFactor: unit.default(0.35),
        /** no tests / timeout / error / unrelated failure: c * inconclusiveFactor */
        inconclusiveFactor: unit.default(0.9),
        /** Upper bound on run_affected_tests calls per review. */
        maxTestRuns: z.number().int().min(0).default(5)
      })
      .default({ enabled: true, adjudicate: true, confirmBoost: 0.6, refuteFactor: 0.35, inconclusiveFactor: 0.9, maxTestRuns: 5 }),
    /** Categories that always go to a human (if above the drop threshold), however confident. */
    alwaysEscalateCategories: z.array(z.enum(CATEGORIES)).default(["security"]),
    limits: z
      .object({
        maxFindings: z.number().int().positive().default(20),
        maxComments: z.number().int().min(0).default(10)
      })
      .default({ maxFindings: 20, maxComments: 10 }),
    escalation: z
      .object({
        label: z.string().min(1).default("needs-human-review"),
        mentions: z.array(z.string()).default([]),
        webhookUrl: z.string().url().optional()
      })
      .default({ label: "needs-human-review", mentions: [] }),
    /** Post a summary comment for every review (escalations always produce one). */
    summaryComment: z.boolean().default(true)
  })
  .strict();

export type SentinelConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: SentinelConfig = ConfigSchema.parse({});

export function parseConfig(raw: unknown): SentinelConfig {
  const res = ConfigSchema.safeParse(raw ?? {});
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`Invalid sentinel config: ${issues}`);
  }
  return res.data;
}

/** Loads `sentinel.config.json` (explicit path, or from cwd if present); falls back to defaults. */
export async function loadConfig(file?: string): Promise<SentinelConfig> {
  const target = file ?? path.resolve("sentinel.config.json");
  if (!existsSync(/*turbopackIgnore: true*/ target)) {
    if (file) throw new Error(`Config file not found: ${file}`);
    return DEFAULT_CONFIG;
  }
  return parseConfig(JSON.parse(await readFile(/*turbopackIgnore: true*/ target, "utf8")));
}
