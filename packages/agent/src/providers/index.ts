import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { OpenAICompatibleProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

export * from "./types.js";
export { MockProvider, heuristicReview, heuristicAdjudication } from "./mock.js";
export { OpenAICompatibleProvider, type OpenAICompatibleOptions } from "./openai.js";
export { AnthropicProvider, type AnthropicOptions } from "./anthropic.js";
export { postJson, type FetchLike } from "./http.js";

export type ProviderKind = "mock" | "openai" | "anthropic";

export interface ProviderEnv {
  LLM_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

/** Builds a provider from an explicit kind or `LLM_PROVIDER` (default: mock). */
export function createProvider(kind?: string, env: ProviderEnv = process.env): LLMProvider {
  const k = (kind ?? env.LLM_PROVIDER ?? "mock").toLowerCase();
  switch (k) {
    case "mock":
      return new MockProvider();
    case "openai":
      if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for the openai provider");
      return new OpenAICompatibleProvider({
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL,
        model: env.OPENAI_MODEL ?? "gpt-4o-mini"
      });
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for the anthropic provider");
      return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5" });
    default:
      throw new Error(`Unknown LLM provider "${k}" (expected mock | openai | anthropic)`);
  }
}
