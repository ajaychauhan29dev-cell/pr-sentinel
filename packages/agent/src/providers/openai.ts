import { postJson, type FetchLike } from "./http.js";
import { ProviderError, type CompletionRequest, type LLMProvider } from "./types.js";

export interface OpenAICompatibleOptions {
  apiKey: string;
  model: string;
  /** Any OpenAI-compatible endpoint (OpenAI, Azure-compatible gateways, vLLM, Ollama, LM Studio...). */
  baseUrl?: string;
  temperature?: number;
  fetch?: FetchLike;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;

  constructor(private readonly opts: OpenAICompatibleOptions) {
    this.name = `openai:${opts.model}`;
  }

  async complete(req: CompletionRequest): Promise<string> {
    const base = (this.opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const json = (await postJson(
      `${base}/chat/completions`,
      { authorization: `Bearer ${this.opts.apiKey}` },
      {
        model: this.opts.model,
        temperature: this.opts.temperature ?? 0,
        max_tokens: req.maxTokens ?? 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt }
        ]
      },
      { fetch: this.opts.fetch }
    )) as ChatCompletionResponse;
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError("OpenAI-compatible response had no message content");
    return content;
  }
}
