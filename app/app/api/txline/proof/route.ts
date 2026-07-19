import { NextRequest, NextResponse } from "next/server";
import { txline } from "@/lib/txlineServer";

export const dynamic = "force-dynamic";

/** Raw TxLINE Merkle validation proof for (fixtureId, seq, statKeys). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const fixtureId = q.get("fixtureId");
  const seq = q.get("seq");
  const statKeys = q.get("statKeys");
  if (!fixtureId || !seq || !statKeys) {
    return NextResponse.json({ error: "fixtureId, seq, statKeys required" }, { status: 400 });
  }
  try {
    const r = await txline.get(`/scores/stat-validation`, {
      params: { fixtureId, seq, statKeys },
    });
    return NextResponse.json(r.data);
  } catch (e: any) {
    return NextResponse.json(
      { error: e.response?.data ?? e.message },
      { status: e.response?.status ?? 500 },
    );
  }
}
