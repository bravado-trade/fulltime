"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  MarketAccount, fmtAmount, getProgram, impliedYes, legLabel, marketPda, statusLabel,
} from "@/lib/anchorClient";
import { buildValidationPayload, dailyScoresRootsPda } from "@/lib/proof";
import { EXPLORER, ORACLE_PROGRAM_ID } from "@/lib/config";

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { connected } = useWallet();

  const [market, setMarket] = useState<MarketAccount | null>(null);
  const [score, setScore] = useState<any>(null);
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<Array<{ t: string; link?: string }>>([]);
  const [proofView, setProofView] = useState<any>(null);

  const say = (t: string, link?: string) => setLog(l => [...l, { t, link }]);

  const program = useMemo(
    () => getProgram(connection, wallet ?? undefined),
    [connection, wallet],
  );
  const pda = useMemo(
    () => marketPda(program.programId, new BN(id)),
    [program.programId, id],
  );

  const refresh = useCallback(async () => {
    const m = await (program.account as any).market.fetch(pda).catch(() => null);
    if (m) setMarket({ publicKey: pda, ...m });
    return m;
  }, [program, pda]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll the live score while the market is open
  useEffect(() => {
    if (!market) return;
    const fid = market.fixtureId.toString();
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/txline/score?fixtureId=${fid}`).then(r => r.json()).catch(() => null);
      if (!stop && r) setScore(r);
    };
    tick();
    const iv = setInterval(tick, 10_000);
    return () => { stop = true; clearInterval(iv); };
  }, [market?.fixtureId?.toString()]);

  const stake = async (side: "yes" | "no") => {
    if (!wallet || !market) return;
    setBusy(side);
    try {
      const lamports = new BN(Math.round(parseFloat(amount) * 1e6));
      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      const stakerToken = getAssociatedTokenAddressSync(market.mint, wallet.publicKey);
      const sig = await (program.methods as any)
        .stake(side === "yes" ? { yes: {} } : { no: {} }, lamports)
        .accounts({ staker: wallet.publicKey, market: pda, stakerToken })
        .rpc();
      say(`Staked ${amount} USDC on ${side.toUpperCase()}`, EXPLORER(sig));
      await refresh();
    } catch (e: any) {
      say(`Stake failed: ${e.message?.slice(0, 140)}`);
    } finally { setBusy(null); }
  };

  const settle = async () => {
    if (!wallet || !market) return;
    setBusy("settle");
    try {
      const fid = market.fixtureId.toString();
      say("Looking for game_finalised record…");
      const s = await fetch(`/api/txline/score?fixtureId=${fid}`).then(r => r.json());
      const finalised = s?.finalised;
      if (!finalised) { say("Match not finalised yet — no settlement record."); return; }
      const seq = finalised.Seq ?? finalised.seq;
      say(`Finalised at seq=${seq}. Fetching Merkle proof from TxLINE…`);
      const keys = market.statKeys.join(",");
      const v = await fetch(`/api/txline/proof?fixtureId=${fid}&seq=${seq}&statKeys=${keys}`)
        .then(r => r.json());
      if (v.error) { say(`Proof fetch failed: ${JSON.stringify(v.error).slice(0, 120)}`); return; }
      setProofView(v);
      say("Proof in hand. Submitting on-chain settlement (CPI → txoracle.validateStatV2)…");
      const payload = buildValidationPayload(v);
      const rootsPda = dailyScoresRootsPda(
        new PublicKey(ORACLE_PROGRAM_ID), v.summary.updateStats.minTimestamp);
      const sig = await (program.methods as any)
        .settle(payload)
        .accounts({
          market: pda,
          dailyScoresMerkleRoots: rootsPda,
          oracleProgram: new PublicKey(ORACLE_PROGRAM_ID),
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
        .rpc();
      const m = await refresh();
      say(`SETTLED: ${statusLabel(m.status)} — proof verified on-chain`, EXPLORER(sig));
    } catch (e: any) {
      say(`Settle failed: ${e.message?.slice(0, 180)}`);
    } finally { setBusy(null); }
  };

  const claim = async () => {
    if (!wallet || !market) return;
    setBusy("claim");
    try {
      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      const claimerToken = getAssociatedTokenAddressSync(market.mint, wallet.publicKey);
      const sig = await (program.methods as any)
        .claim()
        .accounts({ claimer: wallet.publicKey, market: pda, claimerToken })
        .rpc();
      say("Claimed payout", EXPLORER(sig));
      await refresh();
    } catch (e: any) {
      say(`Claim failed: ${e.message?.slice(0, 140)}`);
    } finally { setBusy(null); }
  };

  if (!market) return <p className="text-sm text-slate-500">Loading market…</p>;

  const p = impliedYes(market.yesTotal, market.noTotal);
  const open = "open" in market.status;
  const deadline = new Date(market.stakeDeadline.toNumber() * 1000);
  const latest = score?.latest;
  const rawScore = latest?.score ?? latest?.Score;
  const goals = (side: "Participant1" | "Participant2"): number | null => {
    if (Array.isArray(rawScore)) return rawScore[side === "Participant1" ? 0 : 1] ?? 0;
    const s = rawScore?.[side];
    if (!s) return null;
    return s.Total?.Goals ?? 0;
  };
  const [g1, g2] = [goals("Participant1"), goals("Participant2")];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">
            Fixture {market.fixtureId.toString()} · stakes close {deadline.toUTCString()}
          </div>
          <h1 className="mt-1 text-xl font-bold text-white">{market.question}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {market.legs.map((leg, i) => (
              <span key={i} className="rounded bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300">
                {legLabel(leg, market.statKeys)}
              </span>
            ))}
            <span
              className={
                "rounded px-2 py-1 text-xs " +
                (open ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300")
              }
            >
              {statusLabel(market.status)}
            </span>
          </div>
        </div>
        <WalletMultiButton />
      </div>

      {/* live score */}
      <section className="rounded-lg border border-slate-800 bg-[#0d1219] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Live match data · TxLINE
          </h2>
          {score?.finalised && (
            <span className="rounded bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">
              GAME FINALISED — settlement proof available
            </span>
          )}
        </div>
        <div className="mt-2 font-mono text-2xl text-white">
          {g1 !== null || g2 !== null ? `${g1 ?? 0} — ${g2 ?? 0}` : "— vs —"}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {latest
            ? `last action: ${latest.Action ?? latest.action ?? "n/a"} · seq ${latest.Seq ?? latest.seq ?? "?"} · records: ${score.count}`
            : "no records yet (match not started or feed idle)"}
        </div>
      </section>

      {/* pools + stake */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-[#0d1219] p-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Pool</h2>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-emerald-300">YES</span>
              <span className="font-mono">{fmtAmount(market.yesTotal)} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-rose-300">NO</span>
              <span className="font-mono">{fmtAmount(market.noTotal)} USDC</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-rose-900/50">
              <div
                className="h-full bg-emerald-500/70"
                style={{ width: `${((p ?? 0.5) * 100).toFixed(1)}%` }}
              />
            </div>
            {p !== null && (
              <div className="text-xs text-slate-500">
                pool-implied: YES {(p * 100).toFixed(1)}% · NO {((1 - p) * 100).toFixed(1)}%
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#0d1219] p-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            {open ? "Stake" : "Actions"}
          </h2>
          {!connected && <p className="mt-3 text-xs text-slate-500">Connect a wallet to act.</p>}
          {connected && open && (
            <div className="mt-3 space-y-3">
              <input
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm"
                placeholder="Amount (USDC)"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => stake("yes")}
                  disabled={!!busy}
                  className="flex-1 rounded bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {busy === "yes" ? "…" : "Stake YES"}
                </button>
                <button
                  onClick={() => stake("no")}
                  disabled={!!busy}
                  className="flex-1 rounded bg-rose-600 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  {busy === "no" ? "…" : "Stake NO"}
                </button>
              </div>
            </div>
          )}
          {connected && (
            <div className="mt-3 flex gap-2">
              {open && (
                <button
                  onClick={settle}
                  disabled={!!busy}
                  className="flex-1 rounded bg-amber-600 py-2 text-sm font-semibold text-black hover:bg-amber-500 disabled:opacity-50"
                >
                  {busy === "settle" ? "Verifying proof…" : "Settle with TxLINE proof"}
                </button>
              )}
              {!open && (
                <button
                  onClick={claim}
                  disabled={!!busy}
                  className="flex-1 rounded bg-slate-200 py-2 text-sm font-semibold text-black hover:bg-white disabled:opacity-50"
                >
                  {busy === "claim" ? "…" : "Claim payout"}
                </button>
              )}
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
            Settlement is permissionless: anyone can submit the TxLINE Merkle proof after
            full-time. The program only accepts proofs from finalised records (period = 100) and
            verifies them via CPI against TxODDS&apos;s on-chain daily root.
          </p>
        </div>
      </section>

      {/* activity log */}
      {log.length > 0 && (
        <section className="rounded-lg border border-slate-800 bg-[#0d1219] p-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Activity</h2>
          <ul className="mt-2 space-y-1 font-mono text-xs text-slate-400">
            {log.map((l, i) => (
              <li key={i}>
                → {l.t}{" "}
                {l.link && (
                  <a className="text-sky-400 underline" href={l.link} target="_blank" rel="noreferrer">
                    explorer
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* proof explorer */}
      {proofView && (
        <section className="rounded-lg border border-amber-900/60 bg-[#12100a] p-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-amber-500">
            Merkle proof — the entire settlement authority
          </h2>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
            {proofView.statsToProve?.map((s: any, i: number) => (
              <div key={i} className="rounded bg-black/40 p-2 font-mono">
                <div className="text-slate-500">stat key {s.key}</div>
                <div className="text-lg text-white">{s.value}</div>
                <div className="text-amber-400/80">period {s.period} (finalised)</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 font-mono text-[10px] leading-relaxed text-slate-500">
            <div>eventStatRoot: <span className="text-slate-300">{String(proofView.eventStatRoot).slice(0, 44)}…</span></div>
            <div>subTreeProof: {proofView.subTreeProof?.length} nodes · mainTreeProof: {proofView.mainTreeProof?.length} nodes</div>
            <div>
              anchored root account:{" "}
              <a
                className="text-sky-400 underline"
                target="_blank"
                rel="noreferrer"
                href={EXPLORER(
                  dailyScoresRootsPda(
                    new PublicKey(ORACLE_PROGRAM_ID),
                    proofView.summary?.updateStats?.minTimestamp ?? Date.now(),
                  ).toBase58(),
                  "address",
                )}
              >
                daily_scores_roots (TxODDS, on-chain)
              </a>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
