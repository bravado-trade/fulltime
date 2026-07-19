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

  // Try historical/snapshot first (match may already be over)
  const existing = await tx.latestFinalised(FIXTURE_ID).catch(() => undefined);
  if (existing) finalisedSeq = seqOf(existing);

  if (!finalisedSeq) {
    await new Promise<void>(resolve => {
      const stop = tx.scoresStream(rec => {
        const fid = rec.FixtureId ?? rec.fixtureId;
        if (fid !== FIXTURE_ID) return;
        const action = actionOf(rec);
        const score = (rec as any).score ?? (rec as any).Score;
        console.log(`[feed] ${action} seq=${seqOf(rec)} score=${JSON.stringify(score ?? "?")}`);
        if (action === "game_finalised") {
          finalisedSeq = seqOf(rec);
          stop();
          resolve();
        }
      }, FIXTURE_ID);
      // safety net: poll snapshot every 30s in case the stream misses it
      const iv = setInterval(async () => {
        const f = await tx.latestFinalised(FIXTURE_ID).catch(() => undefined);
        if (f) { finalisedSeq = seqOf(f); clearInterval(iv); stop(); resolve(); }
      }, 30_000);
    });
  }

  const t0 = Date.now();
  console.log(`\n[crank] GAME FINALISED (seq=${finalisedSeq}). Settling all open markets…`);

  const all = await (program.account as any).market.all();
  const open = all.filter((m: any) =>
    m.account.fixtureId.toNumber() === FIXTURE_ID && "open" in m.account.status);
  console.log(`[crank] ${open.length} open market(s) on this fixture`);

  for (const m of open) {
    try {
      const keys: number[] = m.account.statKeys;
      const v = await tx.statValidation(FIXTURE_ID, finalisedSeq!, keys);
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
