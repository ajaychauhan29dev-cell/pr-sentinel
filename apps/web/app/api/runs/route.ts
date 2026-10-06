import { parsePrRef, formatPrRef } from "@pr-sentinel/mcp-server";
import { NextResponse } from "next/server";
import { startRun } from "@/lib/runner";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    store.list().map(({ id, pr, status, createdAt, provider, dryRun, trigger, report }) => ({
      id,
      pr,
      status,
      createdAt,
      provider,
      dryRun,
      trigger,
      summary: report?.summary
    }))
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { pr?: string; provider?: string; dryRun?: boolean };
  let pr: string;
  try {
    pr = formatPrRef(parsePrRef(body.pr ?? ""));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid PR" }, { status: 400 });
  }
  if (body.provider && !["mock", "openai", "anthropic"].includes(body.provider)) {
    return NextResponse.json({ error: "provider must be mock, openai or anthropic" }, { status: 400 });
  }
  const run = startRun(pr, { provider: body.provider, dryRun: body.dryRun ?? true });
  return NextResponse.json({ id: run.id }, { status: 202 });
}
