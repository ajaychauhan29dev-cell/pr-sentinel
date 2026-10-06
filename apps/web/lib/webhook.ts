import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies GitHub's `X-Hub-Signature-256` header (HMAC-SHA256 of the raw body). */
export function verifyGitHubSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const REVIEW_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

interface PullRequestEvent {
  action?: string;
  number?: number;
  pull_request?: { draft?: boolean; number?: number };
  repository?: { full_name?: string };
}

/** Decides whether a webhook delivery should trigger a review; returns the PR ref or a skip reason. */
export function prFromWebhook(event: string | null, payload: unknown): { pr: string } | { skip: string } {
  if (event === "ping") return { skip: "ping" };
  if (event !== "pull_request") return { skip: `ignored event ${event}` };
  const p = payload as PullRequestEvent;
  if (!p.action || !REVIEW_ACTIONS.has(p.action)) return { skip: `ignored action ${p.action}` };
  if (p.pull_request?.draft) return { skip: "draft pull request" };
  const number = p.pull_request?.number ?? p.number;
  if (!p.repository?.full_name || !number) return { skip: "malformed payload" };
  return { pr: `${p.repository.full_name}#${number}` };
}
