/**
 * Create the demo markets for a fixture (default: the World Cup final).
 *
 * Usage: npx tsx scripts/create-markets.ts <fixtureId> <kickoffIsoUtc>
 *   e.g. npx tsx scripts/create-markets.ts 18250000 2026-07-19T19:00:00Z
 *
 * Markets created (stat keys are TxLINE soccer encodings):
 *   M1  Home side wins (full match)          keys [1,2]   binary 1-2 > 0
 *   M2  Over 2.5 goals (full match)          keys [1,2]   binary 1+2 > 2
 *   M3  Red card shown (either side)         keys [5,6]   binary 5+6 > 0
 *   M4  5+ second-half corners (home side)   keys [3007]  single > 4
 *   M5  PARLAY: home wins AND over 2.5 AND 2+ home corners H2
 *       keys [1,2,3007] — settled by ONE multi-stat Merkle proof
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const REPO = path.resolve(__dirname, "..");
const FIXTURE_ID = Number(process.argv[2]);
const KICKOFF = process.argv[3];
if (!FIXTURE_ID || !KICKOFF) {
  console.error("usage: tsx scripts/create-markets.ts <fixtureId> <kickoffIsoUtc>");
  process.exit(1);
}

const single = (index: number, threshold: number, cmp: object) =>
  ({ single: { index, threshold, cmp } });
const binary = (a: number, b: number, add: boolean, threshold: number, cmp: object) =>
  ({ binary: { indexA: a, indexB: b, add, threshold, cmp } });
const GT = { gt: {} };

async function main() {
  const payer = Keypair.fromSecretKey(Uint8Array.from(
    JSON.parse(fs.readFileSync(path.join(REPO, ".keys/dev-wallet.json"), "utf8"))));
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {});
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync(path.join(REPO, "program/target/idl/fulltime.json"), "utf8"));
  const program = new anchor.Program(idl, provider);

  const state = JSON.parse(fs.readFileSync(path.join(REPO, ".e2e-state.json"), "utf8"));
  const mint = new PublicKey(state.mint);
  const deadline = Math.floor(new Date(KICKOFF).getTime() / 1000);

  const markets: Array<{ q: string; keys: number[]; legs: object[] }> = [
    { q: "Final: home side wins (full match, incl. ET/pens)", keys: [1, 2], legs: [binary(0, 1, false, 0, GT)] },
    { q: "Final: over 2.5 goals (full match)", keys: [1, 2], legs: [binary(0, 1, true, 2, GT)] },
    { q: "Final: a red card is shown", keys: [5, 6], legs: [binary(0, 1, true, 0, GT)] },
    { q: "Final: 5+ home-side corners in the 2nd half", keys: [3007], legs: [single(0, 4, GT)] },
    {
      q: "PARLAY: home wins + over 2.5 goals + 2+ home H2 corners — one proof, one tx",
      keys: [1, 2, 3007],
      legs: [binary(0, 1, false, 0, GT), binary(0, 1, true, 2, GT), single(2, 1, GT)],
    },
  ];

  const created: any[] = [];
  for (const [i, m] of markets.entries()) {
    const marketId = new anchor.BN(Date.now() + i);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), marketId.toArrayLike(Buffer, "le", 8)], program.programId);
    const sig = await (program.methods as any)
      .createMarket(marketId, new anchor.BN(FIXTURE_ID), new anchor.BN(deadline), m.keys, m.legs, m.q)
      .accounts({ creator: payer.publicKey, market: pda, mint })
      .rpc();
    created.push({ marketId: marketId.toString(), pda: pda.toBase58(), q: m.q, sig });
    console.log(`created: ${m.q}\n  id=${marketId} pda=${pda.toBase58()}`);
  }
  fs.writeFileSync(path.join(REPO, ".markets.json"), JSON.stringify(created, null, 2));
  console.log(`\n${created.length} markets created for fixture ${FIXTURE_ID}, staking closes ${KICKOFF}`);
}

main().catch(e => { console.error(e); process.exit(1); });
