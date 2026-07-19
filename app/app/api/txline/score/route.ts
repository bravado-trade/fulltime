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

  const parse = (body: unknown): any[] => {
    if (Array.isArray(body)) return body;
    if (typeof body !== "string") return body ? [body] : [];
    const out: any[] = [];
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try { out.push(JSON.parse(line.slice(5).trim())); } catch { /* heartbeat */ }
    }
    return out;
  };
  let records: any[] = [];
  try {
    const r = await txline.get(`/scores/snapshot/${fixtureId}`,
      { params: { asOf: Date.now() }, responseType: "text" });
    records = parse(r.data);
  } catch { /* fall back to historical */ }
  if (!records.length) {
    try {
      const r = await txline.get(`/scores/historical/${fixtureId}`, { responseType: "text" });
      records = parse(r.data);
    } catch { /* no data yet */ }
  }

  const act = (r: any) => r.Action ?? r.action ?? "";
  const finalised = records.filter(r => act(r) === "game_finalised").pop() ?? null;
  // Prefer the last record that actually carries a score (feed tails off with
  // connection-status actions that have no Score field).
  const withScore = records.filter(r => (r.Score ?? r.score) != null).pop() ?? null;
  const latest = withScore ?? records[records.length - 1] ?? null;
  return NextResponse.json({ latest, finalised, count: records.length });
}
