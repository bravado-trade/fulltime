import { NextRequest, NextResponse } from "next/server";
import { txline } from "@/lib/txlineServer";

export const dynamic = "force-dynamic";

// World Cup on devnet
const COMPETITION_ID = Number(process.env.TXLINE_COMPETITION_ID ?? 72);

export async function GET(_req: NextRequest) {
  const today = Math.floor(Date.now() / 86400000);
  const seen = new Map<number, unknown>();
  for (let d = today - 7; d <= today + 2; d++) {
    try {
      const r = await txline.get(`/fixtures/snapshot`, {
        params: { competitionId: COMPETITION_ID, startEpochDay: d },
      });
      for (const f of r.data ?? []) seen.set(f.FixtureId ?? f.fixtureId, f);
    } catch { /* day without fixtures */ }
  }
  return NextResponse.json([...seen.values()]);
}
