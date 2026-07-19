import { NextRequest, NextResponse } from "next/server";
import { txline } from "@/lib/txlineServer";

export const dynamic = "force-dynamic";

/**
 * Latest score state for a fixture: live snapshot if available, otherwise the
 * historical replay. Also surfaces the latest game_finalised record (the
 * settlement trigger) with its seq.
 */
export async function GET(req: NextRequest) {
  const fixtureId = req.nextUrl.searchParams.get("fixtureId");
  if (!fixtureId) return NextResponse.json({ error: "fixtureId required" }, { status: 400 });

  let records: any[] = [];
  try {
    const r = await txline.get(`/scores/snapshot/${fixtureId}`, { params: { asOf: Date.now() } });
    records = r.data ?? [];
  } catch { /* fall back to historical */ }
  if (!records.length) {
    try {
      const r = await txline.get(`/scores/historical/${fixtureId}`);
      records = r.data ?? [];
    } catch { /* no data yet */ }
  }

  const act = (r: any) => r.Action ?? r.action ?? "";
  const finalised = records.filter(r => act(r) === "game_finalised").pop() ?? null;
  const latest = records[records.length - 1] ?? null;
  return NextResponse.json({ latest, finalised, count: records.length });
}
