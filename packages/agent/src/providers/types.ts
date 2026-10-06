import type { Finding } from "../types.js";
import type { TestRunEvidence } from "../types.js";

export interface ReviewContext {
  title: string;
  body: string;
  diff: string;
}

export interface AdjudicationContext {
  finding: Finding;
  testRun: TestRunEvidence;
}

/**
 * One LLM call. Real providers only use `system` + `prompt`; `context` carries the same
 * information in structured form so the deterministic mock provider can act on it.
 */
export type CompletionRequest =
  | { task: "review"; system: string; prompt: string; context: ReviewContext; maxTokens?: number }
  | { task: "adjudicate"; system: string; prompt: string; context: AdjudicationContext; maxTokens?: number };

export interface LLMProvider {
  readonly name: string;
  /** Returns the raw model text, expected to be a JSON document. */
  complete(req: CompletionRequest): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
