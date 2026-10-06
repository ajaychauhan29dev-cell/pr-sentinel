import { NextResponse } from "next/server";
import { startRun } from "@/lib/runner";
import { prFromWebhook, verifyGitHubSignature } from "@/lib/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GitHub App / repository webhook for `pull_request` events. */
export async function POST(req: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "GITHUB_WEBHOOK_SECRET is not configured" }, { status: 503 });

  const raw = await req.text();
  if (!verifyGitHubSignature(secret, raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const decision = prFromWebhook(req.headers.get("x-github-event"), payload);
  if ("skip" in decision) return NextResponse.json({ skipped: decision.skip });

  const run = startRun(decision.pr, { trigger: "webhook", dryRun: process.env.SENTINEL_DRY_RUN === "true" });
  return NextResponse.json({ runId: run.id, pr: decision.pr }, { status: 202 });
}
