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

**Live MVP:** https://fulltime-noymaxxs-projects.vercel.app

Program (devnet): [`6Aow8DZvpWFPrKYf1tUU2WsSXuFF36iNyh4rJegp62M9`](https://explorer.solana.com/address/6Aow8DZvpWFPrKYf1tUU2WsSXuFF36iNyh4rJegp62M9?cluster=devnet)
TxODDS txoracle (devnet): `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`

### Proven on devnet (real World Cup data)

- E2E vs England v Argentina (semi, Jul 15): proof-settled `settledNo` (1-2) —
  [settle tx](https://explorer.solana.com/tx/4r9PZhkapA7gXytDdEeXZ5A17ef3KgxnhsYWUEnYDLxi5Tpo9yyS9gj6frkw59vXd3GWwPv3ZMepzUUEkEeWMfDj?cluster=devnet)
- Rehearsal vs France v England (3rd place, Jul 18), settled by the crank 13.5s after the
  finalisation signal:
  ["over 2.5 goals" → YES](https://explorer.solana.com/tx/3Am6pc1T8n66YtGwfRsnaWLL1BBJUbCN5YMBd5zjxLwYyQUT4CvbXLmWY5bRYuLuFg1QjpniN6iSiUNfPCAXKzE1?cluster=devnet) ·
  ["home wins" → NO](https://explorer.solana.com/tx/4Ho2h7Nkoz3vxcYTHPTGdF9v3At5QyXgJWd4CJYBD8R2cchY7yR7EjbPYgZwHMxnS48LUULKoraViJtX184QG3nn?cluster=devnet)
- Empty-pool markets auto-void → refunds (same rehearsal, 3 markets)
- **THE FINAL, SETTLED LIVE (Spain 1-0 Argentina, ET):** four markets proof-settled minutes
  after the whistle — [Spain wins → YES](https://explorer.solana.com/tx/48HmX6bhuBGYwa2pBv2bvNH5mb3Dy3TdL6gmjjSM9ywktEDodXsNaDeDKRo3wk25QkxaRYYqYkb4hdpdkLoFjNar?cluster=devnet),
  [over 2.5 → NO](https://explorer.solana.com/tx/664YX36jiJakcXJ5AM86wsC6n57NYaNXmrL9ts7YjscS48ugf1NojNHuAHy3v7ENb9CW2NEQRaZAjf3nJfJAHKkR?cluster=devnet),
  [red card → YES](https://explorer.solana.com/tx/UYRogwugumw1f3j9XkwkdEUf9BDxJDpXyEpJ6BGQptS1JTFtwDweqtsZ14Lb4oiqA1JCpjaPAjwTQPyWodrG6Bf?cluster=devnet),
  [5+ H2 corners → YES](https://explorer.solana.com/tx/c5r6GhXRb7eJQmcRsbm9cLxCRGhZyz2JhvBkCPu4ithU5eeEbcX43hEoVYTnPpqHoMnAkvpupzRBcMyo1b5UUxJ?cluster=devnet) —
  plus the **3-leg PARLAY settled by ONE 5-leaf proof in ONE tx**
  ([settledNo, 8.6s](https://explorer.solana.com/tx/4bJf8QWnRNa5uGBSN437S3B2xmoctR7Yfy5yPkz4BLnnwDY3wx8ajTZE1r3bgQWsdH6g7zRh7NfsJ3MpDnTCzZBe?cluster=devnet))

Note on parlays: the oracle enforces exactly-once stat coverage per strategy, so parlays whose
legs share a stat request duplicated keys in the proof (`statKeys=1,2,1,2,3007`). Our first
parlay market used the compact layout and is structurally unsettleable — it will void via the
48h timeout with full refunds, exactly as the settlement policy prescribes. Discovered live;
see docs/API_FEEDBACK.md #8.

## Team

Bravado — Hugo Noyma + Claude (AI agent, permitted by the hackathon rules). The `txline-client`
package is written to be lifted directly into Bravado's backend as the data layer for a sports
vertical — this hackathon build is the prototype of markets whose settlement nobody has to trust.
