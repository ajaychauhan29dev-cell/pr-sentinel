import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const order = { pending: 0, approved: 1, dismissed: 2 } as const;
  return NextResponse.json([...store.escalations.values()].sort((a, b) => order[a.status] - order[b.status]));
}
