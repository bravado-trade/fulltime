/**
 * txline-client — standalone TypeScript client for the TxODDS TxLINE API.
 *
 * Covers the full lifecycle: guest JWT → on-chain subscribe() → token
 * activation → fixtures/odds/scores (REST + SSE) → Merkle validation proofs.
 * Auth state is persisted to a JSON file so re-runs skip the on-chain step.
 *
 * Designed to be liftable as-is into a backend service (no framework deps).
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import axios, { AxiosInstance } from "axios";
import nacl from "tweetnacl";
import * as fs from "fs";
import * as path from "path";

export type Network = "devnet" | "mainnet";

export const NETWORKS: Record<Network, {
  apiBase: string;
  jwtUrl: string;
  rpc: string;
  oracleProgram: string;
  txlMint: string;
}> = {
  devnet: {
    apiBase: "https://txline-dev.txodds.com/api",
    jwtUrl: "https://txline-dev.txodds.com/auth/guest/start",
    rpc: "https://api.devnet.solana.com",
    oracleProgram: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    txlMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
  },
  mainnet: {
    apiBase: "https://txline.txodds.com/api",
    jwtUrl: "https://txline.txodds.com/auth/guest/start",
    rpc: "https://api.mainnet-beta.solana.com",
    oracleProgram: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    txlMint: "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
  },
};

export interface Fixture {
  Ts: number; StartTime: string; Competition: string; CompetitionId: number;
  FixtureId: number; Participant1: string; Participant2: string;
  Participant1IsHome: boolean; GameState: number;
}

export interface ScoreRecord {
  fixtureId?: number; FixtureId?: number;
  seq?: number; Seq?: number;
  action?: string; Action?: string;
  statusId?: number; StatusId?: number;
  period?: number; Period?: number;
  ts?: number; Ts?: number;
  [k: string]: unknown;
}

export interface ProofNodeJson { hash: string | number[]; isRightSibling: boolean }

export interface StatValidationResponse {
  summary: {
    fixtureId: number;
    updateStats: { updateCount: number; minTimestamp: number; maxTimestamp: number };
    eventStatsSubTreeRoot: string | number[];
  };
  subTreeProof: ProofNodeJson[];
  mainTreeProof: ProofNodeJson[];
  eventStatRoot: string | number[];
  statsToProve: Array<{ key: number; value: number; period: number }>;
  statProofs: ProofNodeJson[][];
}

export function seqOf(r: ScoreRecord): number { return (r.Seq ?? r.seq ?? 0) as number; }
export function actionOf(r: ScoreRecord): string { return (r.Action ?? r.action ?? "") as string; }

export function toBytes32(value: string | number[] | Uint8Array): number[] {
  const bytes = Array.isArray(value) ? Uint8Array.from(value)
    : value instanceof Uint8Array ? value
    : (value as string).startsWith("0x") ? Buffer.from((value as string).slice(2), "hex")
    : Buffer.from(value as string, "base64");
  if (bytes.length !== 32) throw new Error(`Expected 32 bytes, got ${bytes.length}`);
  return Array.from(bytes);
}

export function toProofNodes(nodes: ProofNodeJson[]) {
  return nodes.map(n => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));
}

/** Anchor-ready StatValidationInput from a raw API validation response. */
export function buildValidationPayload(v: StatValidationResponse) {
  return {
    ts: new anchor.BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: {
      fixtureId: new anchor.BN(v.summary.fixtureId),
      updateStats: {
        updateCount: v.summary.updateStats.updateCount,
        minTimestamp: new anchor.BN(v.summary.updateStats.minTimestamp),
        maxTimestamp: new anchor.BN(v.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: toBytes32(v.summary.eventStatsSubTreeRoot),
    },
    fixtureProof: toProofNodes(v.subTreeProof),
    mainTreeProof: toProofNodes(v.mainTreeProof),
    eventStatRoot: toBytes32(v.eventStatRoot),
    stats: v.statsToProve.map((stat, i) => ({ stat, statProof: toProofNodes(v.statProofs[i]) })),
  };
}

/** daily_scores_roots PDA for the epoch day of a proof timestamp. */
export function dailyScoresRootsPda(oracleProgram: PublicKey, proofTsMs: number): PublicKey {
  const epochDay = Math.floor(proofTsMs / 86400000);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new anchor.BN(epochDay).toArrayLike(Buffer, "le", 2)],
    oracleProgram,
  )[0];
}

export class TxLineClient {
  readonly net: (typeof NETWORKS)[Network];
  readonly http: AxiosInstance;
  private statePath: string;
  private state: { jwt?: string; apiToken?: string } = {};

  constructor(readonly network: Network, statePath?: string) {
    this.net = NETWORKS[network];
    this.statePath = statePath ?? path.join(process.cwd(), `.txline-${network}.json`);
    try { this.state = JSON.parse(fs.readFileSync(this.statePath, "utf8")); } catch { /* fresh */ }
    this.http = axios.create({ baseURL: this.net.apiBase, timeout: 30000 });
    this.http.interceptors.request.use(cfg => {
      if (this.state.jwt) cfg.headers["Authorization"] = `Bearer ${this.state.jwt}`;
      if (this.state.apiToken) cfg.headers["X-Api-Token"] = this.state.apiToken;
      return cfg;
    });
    this.http.interceptors.response.use(r => r, async err => {
      if (err.response?.status === 401 && !err.config._retry) {
        err.config._retry = true;
        await this.refreshJwt();
        return this.http(err.config);
      }
      throw err;
    });
  }

  get apiToken(): string | undefined { return this.state.apiToken; }
  get jwt(): string | undefined { return this.state.jwt; }

  private save() { fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2)); }

  async refreshJwt(): Promise<string> {
    const r = await axios.post(this.net.jwtUrl);
    this.state.jwt = r.data.token;
    this.save();
    return this.state.jwt!;
  }

  /**
   * Full auth: guest JWT + on-chain free-tier subscribe + token activation.
   * serviceLevelId 1 = free tier (World Cup + friendlies). Idempotent: reuses
   * a persisted apiToken when present.
   */
  async ensureAuth(keypairPath: string, serviceLevelId = 1, weeks = 4): Promise<void> {
    if (!this.state.jwt) await this.refreshJwt();
    if (this.state.apiToken) return;

    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")));
    const user = Keypair.fromSecretKey(secret);
    const connection = new Connection(this.net.rpc, "confirmed");
    const idl = JSON.parse(fs.readFileSync(
      path.join(__dirname, `../txoracle.${this.network}.json`), "utf8"));
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(user), {});
    const program = new anchor.Program(idl, provider);

    const tokenMint = new PublicKey(this.net.txlMint);
    const ata = getAssociatedTokenAddressSync(tokenMint, user.publicKey, false, TOKEN_2022_PROGRAM_ID);
    if (!(await connection.getAccountInfo(ata))) {
      const tx = new Transaction().add(createAssociatedTokenAccountInstruction(
        user.publicKey, ata, user.publicKey, tokenMint,
        TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
      await anchor.web3.sendAndConfirmTransaction(connection, tx, [user], { commitment: "confirmed" });
    }

    const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pricing_matrix")], program.programId);
    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_treasury_v2")], program.programId);
    const treasuryVault = getAssociatedTokenAddressSync(tokenMint, treasuryPda, true, TOKEN_2022_PROGRAM_ID);

    const tx = await (program.methods as any)
      .subscribe(serviceLevelId, weeks)
      .accounts({
        user: user.publicKey,
        pricingMatrix: pricingMatrixPda,
        tokenMint,
        userTokenAccount: ata,
        tokenTreasuryVault: treasuryVault,
        tokenTreasuryPda: treasuryPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    const bh = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = bh.blockhash;
    tx.feePayer = user.publicKey;
    tx.sign(user);
    const txSig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(
      { signature: txSig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
      "confirmed");

    const selectedLeagues: number[] = [];
    const message = new TextEncoder().encode(`${txSig}:${selectedLeagues.join(",")}:${this.state.jwt}`);
    const walletSignature = Buffer.from(nacl.sign.detached(message, user.secretKey)).toString("base64");
    const activation = await axios.post(`${this.net.apiBase}/token/activate`,
      { txSig, walletSignature, leagues: selectedLeagues },
      { headers: { Authorization: `Bearer ${this.state.jwt}` } });
    this.state.apiToken = activation.data.token || activation.data;
    this.save();
  }

  // ---- data endpoints ----

  async fixturesSnapshot(competitionId: number, startEpochDay: number): Promise<Fixture[]> {
    const r = await this.http.get(`/fixtures/snapshot`, { params: { competitionId, startEpochDay } });
    return r.data ?? [];
  }

  async scoresHistorical(fixtureId: number): Promise<ScoreRecord[]> {
    const r = await this.http.get(`/scores/historical/${fixtureId}`);
    return r.data ?? [];
  }

  async scoresSnapshot(fixtureId: number): Promise<ScoreRecord[]> {
    const r = await this.http.get(`/scores/snapshot/${fixtureId}`, { params: { asOf: Date.now() } });
    return r.data ?? [];
  }

  async oddsSnapshot(fixtureId: number): Promise<any[]> {
    const r = await this.http.get(`/odds/snapshot/${fixtureId}`);
    return r.data ?? [];
  }

  async statValidation(fixtureId: number, seq: number, statKeys: number[]): Promise<StatValidationResponse> {
    const r = await this.http.get(`/scores/stat-validation`, {
      params: { fixtureId, seq, statKeys: statKeys.join(",") } });
    return r.data;
  }

  /** Latest game_finalised record for a fixture (historical replay endpoint). */
  async latestFinalised(fixtureId: number): Promise<ScoreRecord | undefined> {
    const records = await this.scoresHistorical(fixtureId);
    return records.filter(r => actionOf(r) === "game_finalised").pop();
  }

  /**
   * Server-Sent Events scores stream. Calls onRecord for each parsed record.
   * Returns an abort function.
   */
  scoresStream(onRecord: (rec: ScoreRecord) => void, fixtureId?: number): () => void {
    const ctrl = new AbortController();
    const url = `${this.net.apiBase}/scores/stream${fixtureId ? `?fixtureId=${fixtureId}` : ""}`;
    (async () => {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.state.jwt}`,
          "X-Api-Token": this.state.apiToken ?? "",
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const evt of events) {
          const dataLines = evt.split("\n").filter(l => l.startsWith("data:"));
          if (!dataLines.length) continue;
          const raw = dataLines.map(l => l.slice(5).trim()).join("");
          try { onRecord(JSON.parse(raw)); } catch { /* heartbeat / non-JSON */ }
        }
      }
    })().catch(e => { if (e.name !== "AbortError") console.error("[scoresStream]", e.message); });
    return () => ctrl.abort();
  }
}
