import { postJson, type FetchLike } from "./http.js";
import { ProviderError, type CompletionRequest, type LLMProvider } from "./types.js";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  fetch?: FetchLike;
}

interface MessagesResponse {
  content?: { type: string; text?: string }[];
}

export class AnthropicProvider implements LLMProvider {
  readonly name: string;

  constructor(private readonly opts: AnthropicOptions) {
    this.name = `anthropic:${opts.model}`;
  }

  async complete(req: CompletionRequest): Promise<string> {
    const base = (this.opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    const json = (await postJson(
      `${base}/v1/messages`,
      { "x-api-key": this.opts.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: this.opts.model,
        max_tokens: req.maxTokens ?? 4096,
        temperature: this.opts.temperature ?? 0,
        system: `${req.system}\nRespond with a single JSON object and nothing else.`,
        messages: [{ role: "user", content: req.prompt }]
      },
      { fetch: this.opts.fetch }
    )) as MessagesResponse;
    const text = (json.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("");
    if (!text) throw new ProviderError("Anthropic response had no text content");
    return text;
  }
}
