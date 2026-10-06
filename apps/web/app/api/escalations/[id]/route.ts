import { NextResponse } from "next/server";
import { resolveEscalation } from "@/lib/runner";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const esc = store.escalations.get(decodeURIComponent(id));
  if (!esc) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; note?: string };
  if (body.action !== "approve" && body.action !== "dismiss") {
    return NextResponse.json({ error: "action must be approve or dismiss" }, { status: 400 });
  }
  try {
    return NextResponse.json(await resolveEscalation(esc, body.action, body.note));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
