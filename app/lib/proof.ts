// Pure helpers to turn a raw TxLINE stat-validation API response into the
// Anchor-ready StatValidationInput shape (browser-safe: no node deps).
import { Buffer } from "buffer";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface ProofNodeJson { hash: string | number[]; isRightSibling: boolean }

export function toBytes32(value: string | number[] | Uint8Array): number[] {
  const bytes = Array.isArray(value) ? Uint8Array.from(value)
    : value instanceof Uint8Array ? value
    : (value as string).startsWith("0x")
      ? Uint8Array.from(Buffer.from((value as string).slice(2), "hex"))
      : Uint8Array.from(Buffer.from(value as string, "base64"));
  if (bytes.length !== 32) throw new Error(`Expected 32 bytes, got ${bytes.length}`);
  return Array.from(bytes);
}

export function toProofNodes(nodes: ProofNodeJson[]) {
  return nodes.map(n => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));
}

export function buildValidationPayload(v: any) {
  return {
    ts: new BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: {
      fixtureId: new BN(v.summary.fixtureId),
      updateStats: {
        updateCount: v.summary.updateStats.updateCount,
        minTimestamp: new BN(v.summary.updateStats.minTimestamp),
        maxTimestamp: new BN(v.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: toBytes32(v.summary.eventStatsSubTreeRoot),
    },
    fixtureProof: toProofNodes(v.subTreeProof),
    mainTreeProof: toProofNodes(v.mainTreeProof),
    eventStatRoot: toBytes32(v.eventStatRoot),
    stats: v.statsToProve.map((stat: any, i: number) => ({
      stat, statProof: toProofNodes(v.statProofs[i]),
    })),
  };
}

export function dailyScoresRootsPda(oracleProgram: PublicKey, proofTsMs: number): PublicKey {
  const epochDay = Math.floor(proofTsMs / 86400000);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    oracleProgram,
  )[0];
}
