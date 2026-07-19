/**
 * End-to-end devnet demo of the full FullTime lifecycle against a REAL
 * completed World Cup fixture:
 *
 *   1. TxLINE auth (guest JWT + on-chain free-tier subscribe + activation)
 *   2. Create a demo USDC mint + fund two staker wallets
 *   3. Create a market on the fixture's final result
 *   4. Stake YES (wallet A) and NO (wallet B)
 *   5. Wait for the stake deadline, fetch the TxLINE Merkle proof for the
 *      game_finalised record, and settle ON-CHAIN via CPI into txoracle
 *   6. Claim payouts and print balances
 *
 * Usage: npx tsx scripts/e2e.ts [fixtureId]
 *   Default fixture: 18241006 (England v Argentina, Jul 15 2026, devnet)
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, ComputeBudgetProgram } from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import {
  TxLineClient, buildValidationPayload, dailyScoresRootsPda, seqOf,
} from "../packages/txline-client/src";

const REPO = path.resolve(__dirname, "..");
const KEYS = path.join(REPO, ".keys");
const FIXTURE_ID = Number(process.argv[2] ?? 18241006);
const STAKE_WINDOW_SECS = 75; // deadline = now + this; settle allowed after

function loadOrCreateKeypair(file: string): Keypair {
  const p = path.join(KEYS, file);
  if (fs.existsSync(p)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  const kp = Keypair.generate();
  fs.mkdirSync(KEYS, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

async function main() {
  const payer = loadOrCreateKeypair("dev-wallet.json");
  const stakerA = loadOrCreateKeypair("staker-a.json");
  const stakerB = loadOrCreateKeypair("staker-b.json");
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {});
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(path.join(REPO, "program/target/idl/fulltime.json"), "utf8"));
  const program = new anchor.Program(idl, provider);
  console.log("fulltime program:", program.programId.toBase58());

  const sol = await connection.getBalance(payer.publicKey);
  console.log("payer:", payer.publicKey.toBase58(), "balance:", sol / LAMPORTS_PER_SOL, "SOL");
  if (sol < 0.5 * LAMPORTS_PER_SOL) throw new Error("Fund the payer wallet first (faucet.solana.com)");

  // ---- 1. TxLINE auth ----
  const tx = new TxLineClient("devnet", path.join(REPO, ".txline-devnet.json"));
  await tx.ensureAuth(path.join(KEYS, "dev-wallet.json"));
  console.log("TxLINE auth OK");

  // ---- sanity: fixture + finalised record + proof shape ----
  const finalised = await tx.latestFinalised(FIXTURE_ID);
  if (!finalised) throw new Error(`No game_finalised record yet for fixture ${FIXTURE_ID}`);
  const seq = seqOf(finalised);
  console.log(`fixture ${FIXTURE_ID} finalised at seq=${seq}`);

  // Full-match goals for both sides
  const statKeys = [1, 2];
  const v = await tx.statValidation(FIXTURE_ID, seq, statKeys);
  const [g1, g2] = [v.statsToProve[0], v.statsToProve[1]];
  console.log(`proof stats: P1 goals=${g1.value} (period=${g1.period})  P2 goals=${g2.value} (period=${g2.period})`);

  // ---- 2. demo mint + funded stakers ----
  for (const kp of [stakerA, stakerB]) {
    if ((await connection.getBalance(kp.publicKey)) < 0.05 * LAMPORTS_PER_SOL) {
      const sig = await connection.requestAirdrop(kp.publicKey, 0.1 * LAMPORTS_PER_SOL).catch(() => null);
      if (sig) await connection.confirmTransaction(sig).catch(() => null);
      // fallback: transfer from payer
      const bal = await connection.getBalance(kp.publicKey);
      if (bal < 0.05 * LAMPORTS_PER_SOL) {
        const t = new anchor.web3.Transaction().add(anchor.web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }));
        await anchor.web3.sendAndConfirmTransaction(connection, t, [payer]);
      }
    }
  }
  const statePath = path.join(REPO, ".e2e-state.json");
  let e2eState: any = {};
  try { e2eState = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { /* fresh */ }

  let mint: PublicKey;
  if (e2eState.mint) {
    mint = new PublicKey(e2eState.mint);
  } else {
    mint = await createMint(connection, payer, payer.publicKey, null, 6);
    e2eState.mint = mint.toBase58();
    fs.writeFileSync(statePath, JSON.stringify(e2eState, null, 2));
  }
  console.log("demo USDC mint:", mint.toBase58());

  const tokA = await getOrCreateAssociatedTokenAccount(connection, payer, mint, stakerA.publicKey);
  const tokB = await getOrCreateAssociatedTokenAccount(connection, payer, mint, stakerB.publicKey);
  await mintTo(connection, payer, mint, tokA.address, payer, 1_000_000_000); // 1000 USDC
  await mintTo(connection, payer, mint, tokB.address, payer, 1_000_000_000);

  // ---- 3. create market: "P1 beats P2" (goals1 > goals2) ----
  const marketId = new anchor.BN(Date.now());
  const stakeDeadline = Math.floor(Date.now() / 1000) + STAKE_WINDOW_SECS;
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), marketId.toArrayLike(Buffer, "le", 8)], program.programId);

  await (program.methods as any)
    .createMarket(
      marketId, new anchor.BN(FIXTURE_ID), new anchor.BN(stakeDeadline),
      statKeys,
      [{ binary: { indexA: 0, indexB: 1, add: false, threshold: 0, cmp: { gt: {} } } }],
      "Fixture " + FIXTURE_ID + ": home side wins (full match, incl. ET/pens)",
    )
    .accounts({ creator: payer.publicKey, market: marketPda, mint })
    .signers([payer])
    .rpc();
  console.log("market created:", marketPda.toBase58(), "deadline in", STAKE_WINDOW_SECS, "s");

  // ---- 4. stakes ----
  const stakeOne = async (staker: Keypair, tokenAcc: PublicKey, side: any, amount: number) => {
    await (program.methods as any)
      .stake(side, new anchor.BN(amount))
      .accounts({ staker: staker.publicKey, market: marketPda, stakerToken: tokenAcc })
      .signers([staker])
      .rpc();
  };
  await stakeOne(stakerA, tokA.address, { yes: {} }, 300_000_000); // 300 on YES
  await stakeOne(stakerB, tokB.address, { no: {} }, 200_000_000);  // 200 on NO
  console.log("staked: A→YES 300, B→NO 200");

  // ---- 5. wait out the window, then settle with the real proof ----
  const waitMs = stakeDeadline * 1000 - Date.now() + 3000;
  console.log(`waiting ${(waitMs / 1000).toFixed(0)}s for stake deadline...`);
  await new Promise(r => setTimeout(r, Math.max(0, waitMs)));

  const payload = buildValidationPayload(v);
  const rootsPda = dailyScoresRootsPda(
    new PublicKey(tx.net.oracleProgram), v.summary.updateStats.minTimestamp);
  console.log("daily_scores_roots PDA:", rootsPda.toBase58());

  const sig = await (program.methods as any)
    .settle(payload)
    .accounts({
      market: marketPda,
      dailyScoresMerkleRoots: rootsPda,
      oracleProgram: new PublicKey(tx.net.oracleProgram),
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  console.log("SETTLED on-chain, tx:", sig);

  const market: any = await (program.account as any).market.fetch(marketPda);
  console.log("market status:", JSON.stringify(market.status));

  // ---- 6. claims ----
  for (const [name, staker, tok] of [["A", stakerA, tokA.address], ["B", stakerB, tokB.address]] as const) {
    try {
      await (program.methods as any)
        .claim()
        .accounts({ claimer: staker.publicKey, market: marketPda, claimerToken: tok })
        .signers([staker])
        .rpc();
      const bal = await getAccount(connection, tok);
      console.log(`claim ${name}: OK — token balance now ${Number(bal.amount) / 1e6}`);
    } catch (e: any) {
      console.log(`claim ${name}: ${e.message?.slice(0, 120)}`);
    }
  }
  console.log("\nE2E COMPLETE — trustless settlement demonstrated");
}

main().catch(e => { console.error("E2E FAILED:", e.response?.data ?? e); process.exit(1); });
