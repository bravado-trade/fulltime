# FullTime — settled at the final whistle

**P2P World Cup prediction markets on Solana, settled trustlessly by TxODDS TxLINE Merkle proofs.**

Built by **[Bravado](https://bravadotrade.com)** — we run a production prediction-markets trading
platform, and we've lived the settlement problem this project attacks.

> TxODDS x Solana World Cup Hackathon — *Prediction Markets and Settlement* track.

## The problem

Prediction markets did $31B of monthly volume in 2026, most of it sports — and settlement is the
weakest link in the entire stack. Polymarket's optimistic oracle saw **1,150+ disputed markets in
five months**, dispute votes dominated by a handful of whales, a $60M market that resolved against
documented facts, and a mandatory 2-hour dispute window — for football matches whose result is
known the instant the referee blows full-time.

Sports outcomes don't need votes. They need **data with proof**.

## What FullTime does

TxLINE anchors a Merkle root of every scores update on Solana. FullTime turns that into a
settlement engine:

1. **Anyone creates a market** on any TxLINE fixture stat: match winner, over/under, red cards,
   second-half corners — any encoded stat, any period. Markets are 1–5 legs; a single-leg market
   and a 5-leg parlay are the same account type.
2. **Peers stake YES/NO** into an escrowed parimutuel pool (SPL token vault owned by the market PDA).
3. **Anyone settles** after full-time by submitting the TxLINE Merkle proof. The program:
   - binds the proof to the market's fixture and exact stat keys,
   - **requires `period == 100` on every proven stat leaf** — the TxLINE finalisation marker —
     so mid-game records can never settle a market,
   - CPIs into TxODDS's on-chain `txoracle.validateStatV2`, which verifies the proof against the
     Merkle root **TxODDS anchored on Solana** and evaluates the market's predicates,
   - resolves YES/NO from the returned boolean. No human input exists anywhere in the path.
4. **Winners claim** pro-rata from the pool. Zero protocol fee.

**Parlays settle atomically**: a 3-leg parlay (winner + over 2.5 + H2 corners) is resolved by ONE
multi-stat proof in ONE transaction — something no optimistic-oracle market can do.

## Architecture

```
┌──────────┐   fixtures/odds/scores (REST+SSE)   ┌──────────────┐
│  TxLINE   │ ───────────────────────────────────▶│ txline-client │──▶ Next.js app / crank
│  API      │   stat-validation (Merkle proofs)   └──────┬───────┘
└──────────┘                                            │ settle(proof)
     │ anchors daily Merkle roots                        ▼
     ▼                                    ┌───────────────────────────┐
┌─────────────────────┐   CPI validate    │  fulltime program (Anchor) │
│ txoracle (TxODDS)    │◀─────────────────│  create/stake/settle/claim │
│ daily_scores_roots   │   returns bool   │  /void · parimutuel vaults │
└─────────────────────┘                   └───────────────────────────┘
```

- `program/` — Anchor program (`create_market`, `stake`, `settle`, `claim`, `void`)
- `packages/txline-client/` — standalone TS client for the full TxLINE lifecycle (guest JWT →
  on-chain subscribe → activation → data + proofs + SSE)
- `app/` — Next.js UI: live scores, pools, one-click proof settlement, Merkle proof explorer
- `scripts/` — `e2e.ts` (full lifecycle vs a real finished WC fixture), `create-markets.ts`,
  `settle-crank.ts` (watches the SSE feed and settles everything seconds after `game_finalised`)
- `docs/` — settlement policy, TxLINE endpoints used, API feedback

## Security properties

| Threat | Defense |
|---|---|
| Settle with a mid-game record ("home leads 1-0 at HT") | Every proven stat leaf must carry `period == 100` (finalised) — enforced on-chain |
| Prove a different question than staked | Strategy is rebuilt from the market's stored legs; payload stat keys must match the market's keys, order included |
| Proof for a different match | `payload.fixture_summary.fixture_id` must equal the market's fixture |
| Forged proof | Merkle verification against TxODDS's anchored root inside `txoracle.validateStatV2` (CPI) |
| Match abandoned / postponed, no finalisation ever | Permissionless `void()` after a 48h timeout → full refunds (see settlement policy) |
| Empty side of the pool | Settlement auto-voids → refunds |

## Running it

```bash
npm install
# fund .keys/dev-wallet.json on devnet (faucet.solana.com), then:
npx tsx scripts/e2e.ts               # full lifecycle vs England v Argentina (Jul 15, devnet)
npx tsx scripts/create-markets.ts <fixtureId> <kickoffIso>
npx tsx scripts/settle-crank.ts <fixtureId>
cd app && npm run dev                # UI on :3000
```

Program (devnet): `6Aow8DZvpWFPrKYf1tUU2WsSXuFF36iNyh4rJegp62M9`
TxODDS txoracle (devnet): `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`

## Team

Bravado — Hugo Noyma + Claude (AI agent, permitted by the hackathon rules). The `txline-client`
package is written to be lifted directly into Bravado's backend as the data layer for a sports
vertical — this hackathon build is the prototype of markets whose settlement nobody has to trust.
