import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider, createProvider, MockProvider, OpenAICompatibleProvider, postJson, ProviderError } from "../src/providers/index.js";

const req = { task: "review" as const, system: "sys", prompt: "review this", context: { title: "t", body: "", diff: "" } };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OpenAICompatibleProvider", () => {
  it("calls /chat/completions with JSON mode and returns the content", async () => {
    const fetch = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '{"findings":[]}' } }] }));
    const p = new OpenAICompatibleProvider({ apiKey: "k", model: "m", baseUrl: "http://llm.local/v1/", fetch });
    expect(await p.complete(req)).toBe('{"findings":[]}');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://llm.local/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
  });
});

describe("AnthropicProvider", () => {
  it("calls /v1/messages and joins text blocks", async () => {
    const fetch = vi.fn(async () => jsonResponse({ content: [{ type: "text", text: '{"findings":' }, { type: "text", text: "[]}" }] }));
    const p = new AnthropicProvider({ apiKey: "k", model: "claude", fetch });
    expect(await p.complete(req)).toBe('{"findings":[]}');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(JSON.parse(init.body as string).system).toContain("sys");
  });
});

describe("postJson retries", () => {
  it("retries 429/5xx then succeeds", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const sleep = vi.fn(async () => {});
    expect(await postJson("http://x", {}, {}, { fetch, sleep, retries: 2 })).toEqual({ ok: true });
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([500, 1000]);
  });

  it("does not retry client errors", async () => {
    const fetch = vi.fn(async () => jsonResponse({ error: "bad" }, 400));
    await expect(postJson("http://x", {}, {}, { fetch, sleep: async () => {} })).rejects.toBeInstanceOf(ProviderError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("createProvider", () => {
  it("defaults to the mock provider", () => {
    expect(createProvider(undefined, {})).toBeInstanceOf(MockProvider);
  });
  it("requires API keys for real providers", () => {
    expect(() => createProvider("openai", {})).toThrow(/OPENAI_API_KEY/);
    expect(createProvider("anthropic", { ANTHROPIC_API_KEY: "k" }).name).toBe("anthropic:claude-sonnet-4-5");
  });
});
