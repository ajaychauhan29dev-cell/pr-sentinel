import { ProviderError } from "./types.js";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface PostJsonOptions {
  fetch?: FetchLike;
  retries?: number;
  timeoutMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** POST JSON with timeout and exponential backoff on 429 / 5xx / network errors. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, opts: PostJsonOptions = {}): Promise<unknown> {
  const doFetch = opts.fetch ?? (globalThis.fetch as FetchLike);
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (res.ok) return await res.json();
      const text = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new ProviderError(`HTTP ${res.status}: ${text.slice(0, 500)}`, res.status, retryable);
      if (!retryable) throw lastErr;
    } catch (err) {
      if (err instanceof ProviderError && !err.retryable) throw err;
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError(String(lastErr));
}
