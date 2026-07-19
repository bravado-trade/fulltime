"use client";

import { Buffer } from "buffer";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "./fulltime.json";

export interface MarketAccount {
  publicKey: PublicKey;
  creator: PublicKey;
  marketId: BN;
  fixtureId: BN;
  stakeDeadline: BN;
  statKeys: number[];
  legs: any[];
  question: string;
  mint: PublicKey;
  yesTotal: BN;
  noTotal: BN;
  status: Record<string, object>;
  settledAt: BN;
}

const readonlyWallet = {
  publicKey: PublicKey.default,
  signTransaction: async (t: any) => t,
  signAllTransactions: async (t: any) => t,
};

export function getProgram(connection: Connection, wallet?: any): Program {
  const provider = new AnchorProvider(connection, wallet ?? (readonlyWallet as any), {
    commitment: "confirmed",
  });
  return new Program(idl as any, provider);
}

export async function fetchMarkets(program: Program): Promise<MarketAccount[]> {
  const all = await (program.account as any).market.all();
  return all.map((m: any) => ({ publicKey: m.publicKey, ...m.account }));
}

export function statusLabel(status: Record<string, object>): string {
  const k = Object.keys(status)[0];
  return { open: "OPEN", settledYes: "SETTLED · YES", settledNo: "SETTLED · NO", voided: "VOIDED" }[k] ?? k;
}

export function marketPda(programId: PublicKey, marketId: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), marketId.toArrayLike(Buffer, "le", 8)],
    programId,
  )[0];
}

export function fmtAmount(v: BN, decimals = 6): string {
  return (v.toNumber() / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Implied probability of YES from pool sizes (parimutuel). */
export function impliedYes(yes: BN, no: BN): number | null {
  const y = yes.toNumber(), n = no.toNumber();
  if (y + n === 0) return null;
  return y / (y + n);
}

export function legLabel(leg: any, statKeys: number[]): string {
  const KEY_NAMES: Record<number, string> = {
    1: "Home goals", 2: "Away goals", 3: "Home yellows", 4: "Away yellows",
    5: "Home reds", 6: "Away reds", 7: "Home corners", 8: "Away corners",
  };
  const name = (k: number) => {
    const base = k % 1000, prefix = Math.floor(k / 1000);
    const p = ["", "H1 ", "HT ", "H2 ", "ET1 ", "ET2 ", "Pens ", "ET "][prefix] ?? "";
    return p + (KEY_NAMES[base] ?? `stat ${k}`);
  };
  const cmp = (c: any) => ("gt" in c ? ">" : "lt" in c ? "<" : "=");
  if (leg.single) {
    const l = leg.single;
    return `${name(statKeys[l.index])} ${cmp(l.cmp)} ${l.threshold}`;
  }
  const l = leg.binary;
  return `${name(statKeys[l.indexA])} ${l.add ? "+" : "−"} ${name(statKeys[l.indexB])} ${cmp(l.cmp)} ${l.threshold}`;
}
