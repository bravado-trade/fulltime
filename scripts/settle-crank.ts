/**
 * Permissionless settlement crank: watches a fixture until TxLINE emits the
 * game_finalised record, then settles every open market on that fixture with
 * the Merkle proof. This is the "seconds after the final whistle" machine.
 *
 * Usage: npx tsx scripts/settle-crank.ts <fixtureId>
 */
import * as anchor from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import {
  TxLineClient, buildValidationPayload, dailyScoresRootsPda, seqOf, actionOf,
} from "../packages/txline-client/src";

const REPO = path.resolve(__dirname, "..");
const FIXTURE_ID = Number(process.argv[2]);
if (!FIXTURE_ID) { console.error("usage: tsx scripts/settle-crank.ts <fixtureId>"); process.exit(1); }

async function main() {
  const payer = Keypair.fromSecretKey(Uint8Array.from(
    JSON.parse(fs.readFileSync(path.join(REPO, ".keys/dev-wallet.json"), "utf8"))));
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {});
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync(path.join(REPO, "program/target/idl/fulltime.json"), "utf8"));
  const program = new anchor.Program(idl, provider);

  const tx = new TxLineClient("devnet", path.join(REPO, ".txline-devnet.json"));
  await tx.ensureAuth(path.join(REPO, ".keys/dev-wallet.json"));

  console.log(`[crank] watching fixture ${FIXTURE_ID} for game_finalised…`);
  let finalisedSeq: number | null = null;

  const findFinalised = async (): Promise<number | null> => {
    // snapshot covers LIVE fixtures; historical only covers fixtures started 6h+ ago
    for (const source of [
      () => tx.scoresSnapshot(FIXTURE_ID),
      () => tx.scoresHistorical(FIXTURE_ID),
    ]) {
      try {
        const recs = await source();
        const f = recs.filter(r => actionOf(r) === "game_finalised").pop();
        if (f) return seqOf(f);
      } catch { /* try next source */ }
    }
    return null;
  };

  finalisedSeq = await findFinalised();

  if (!finalisedSeq) {
    await new Promise<void>(resolve => {
      let stopped = false;
      let stopStream: (() => void) | null = null;
      const finish = (seq: number) => {
        if (stopped) return;
        stopped = true;
        finalisedSeq = seq;
        clearInterval(iv);
        stopStream?.();
        resolve();
      };
      // SSE stream with auto-reconnect (server drops idle streams pre-match)
      const connect = () => {
        if (stopped) return;
        console.log(`[crank] (re)connecting scores stream…`);
        stopStream = tx.scoresStream(rec => {
          const fid = rec.FixtureId ?? rec.fixtureId;
          if (fid !== FIXTURE_ID) return;
          const action = actionOf(rec);
          const score = (rec as any).score ?? (rec as any).Score;
          console.log(`[feed] ${action} seq=${seqOf(rec)} score=${JSON.stringify(score ?? "?")}`);
          if (action === "game_finalised") finish(seqOf(rec));
        }, FIXTURE_ID);
      };
      connect();
      // reconnect the stream every 5 minutes regardless (belt), and poll the
      // live snapshot every 20s (suspenders)
      const reconnectIv = setInterval(() => { stopStream?.(); connect(); }, 5 * 60_000);
      const iv = setInterval(async () => {
        const seq = await findFinalised();
        if (seq) { clearInterval(reconnectIv); finish(seq); }
      }, 20_000);
    });
  }

  const t0 = Date.now();
  console.log(`\n[crank] GAME FINALISED (seq=${finalisedSeq}). Settling all open markets…`);

  const all = await (program.account as any).market.all();
  const open = all.filter((m: any) =>
    m.account.fixtureId.toNumber() === FIXTURE_ID && "open" in m.account.status);
  console.log(`[crank] ${open.length} open market(s) on this fixture`);

  const fetchProofWithRetry = async (keys: number[], attempts = 5) => {
    for (let i = 1; ; i++) {
      try {
        return await tx.statValidation(FIXTURE_ID, finalisedSeq!, keys);
      } catch (e: any) {
        const status = e.response?.status;
        if (i >= attempts) throw e;
        const wait = 1500 * i;
        console.log(`[crank] proof fetch ${status ?? e.message} — retry ${i}/${attempts} in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  };

  for (const m of open) {
    try {
      const keys: number[] = m.account.statKeys;
      const v = await fetchProofWithRetry(keys);
      const payload = buildValidationPayload(v);
      const rootsPda = dailyScoresRootsPda(
        new PublicKey(tx.net.oracleProgram), v.summary.updateStats.minTimestamp);
      const sig = await (program.methods as any)
        .settle(payload)
        .accounts({
          market: m.publicKey,
          dailyScoresMerkleRoots: rootsPda,
          oracleProgram: new PublicKey(tx.net.oracleProgram),
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
        .rpc();
      const after: any = await (program.account as any).market.fetch(m.publicKey);
      const status = Object.keys(after.status)[0];
      console.log(`[crank] settled "${m.account.question}" → ${status}  tx=${sig}`);
    } catch (e: any) {
      console.error(`[crank] FAILED "${m.account.question}": ${e.message?.slice(0, 160)}`);
    }
  }
  console.log(`\n[crank] done in ${((Date.now() - t0) / 1000).toFixed(1)}s after finalisation signal`);
}

main().catch(e => { console.error(e); process.exit(1); });
