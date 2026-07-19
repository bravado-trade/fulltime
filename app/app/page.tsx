"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  MarketAccount, fetchMarkets, fmtAmount, getProgram, impliedYes, statusLabel,
} from "@/lib/anchorClient";

interface Fixture {
  FixtureId: number; StartTime: string; Participant1: string; Participant2: string;
  Competition: string; GameState: number;
}

export default function Home() {
  const { connection } = useConnection();
  const [markets, setMarkets] = useState<MarketAccount[]>([]);
  const [fixtures, setFixtures] = useState<Record<number, Fixture>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const program = getProgram(connection);
    Promise.all([
      fetchMarkets(program).catch(() => [] as MarketAccount[]),
      fetch("/api/txline/fixtures").then(r => r.json()).catch(() => []),
    ]).then(([ms, fs]) => {
      setMarkets(ms.sort((a, b) => b.stakeDeadline.toNumber() - a.stakeDeadline.toNumber()));
      const map: Record<number, Fixture> = {};
      for (const f of fs as Fixture[]) map[f.FixtureId] = f;
      setFixtures(map);
      setLoading(false);
    });
  }, [connection]);

  const grouped = useMemo(() => {
    const open = markets.filter(m => "open" in m.status);
    const done = markets.filter(m => !("open" in m.status));
    return { open, done };
  }, [markets]);

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-800 bg-gradient-to-br from-[#0d1420] to-[#101826] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">
              World Cup markets, settled at the <span className="text-emerald-400">final whistle</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Peer-to-peer parimutuel pools on Solana. No oracle committees, no token votes, no
              dispute windows — settlement is a <span className="text-amber-300">Merkle proof</span>{" "}
              verified on-chain against match data anchored by TxODDS, seconds after full-time.
            </p>
          </div>
          <WalletMultiButton />
        </div>
      </section>

      {loading && <p className="text-sm text-slate-500">Loading markets…</p>}

      {!loading && markets.length === 0 && (
        <p className="text-sm text-slate-500">
          No markets yet — create one with <code className="text-slate-300">npm run markets</code>.
        </p>
      )}

      {(["open", "done"] as const).map(k =>
        grouped[k].length ? (
          <section key={k}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
              {k === "open" ? "Open markets" : "Settled / voided"}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {grouped[k].map(m => {
                const fx = fixtures[m.fixtureId.toNumber()];
                const p = impliedYes(m.yesTotal, m.noTotal);
                return (
                  <Link
                    key={m.publicKey.toBase58()}
                    href={`/market/${m.marketId.toString()}`}
                    className="group rounded-lg border border-slate-800 bg-[#0d1219] p-4 transition hover:border-emerald-700"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>
                        {fx ? `${fx.Participant1} vs ${fx.Participant2}` : `Fixture ${m.fixtureId.toString()}`}
                      </span>
                      <span
                        className={
                          "rounded px-1.5 py-0.5 " +
                          ("open" in m.status
                            ? "bg-emerald-900/40 text-emerald-300"
                            : "voided" in m.status
                              ? "bg-slate-800 text-slate-400"
                              : "bg-amber-900/40 text-amber-300")
                        }
                      >
                        {statusLabel(m.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-slate-100 group-hover:text-white">
                      {m.question}
                    </p>
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-slate-500">
                        pool {fmtAmount(m.yesTotal.add(m.noTotal))} USDC
                      </span>
                      {p !== null && (
                        <span className="font-mono text-slate-300">
                          YES {(p * 100).toFixed(0)}% · NO {((1 - p) * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}
