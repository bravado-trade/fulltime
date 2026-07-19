# Superteam submission — copy-paste material

**Track:** Prediction Markets and Settlement (TxODDS x Solana World Cup Hackathon)

**Project name:** FullTime — settled at the final whistle

**One-liner:** P2P World Cup prediction markets on Solana, settled trustlessly by TxODDS TxLINE
Merkle proofs — seconds after full-time, with no votes, committees, or dispute windows.

**Links**
- Live MVP (devnet): https://fulltime-noymaxxs-projects.vercel.app
- Repo (public): https://github.com/bravado-trade/fulltime
- Demo video: https://github.com/bravado-trade/fulltime/releases/download/v1.0/fulltime-demo.mp4 (also on the repo's v1.0 release page)
- Program: https://explorer.solana.com/address/6Aow8DZvpWFPrKYf1tUU2WsSXuFF36iNyh4rJegp62M9?cluster=devnet

**Description (short)**

Sports settlement is prediction markets' weakest link: optimistic oracles brought 1,150+ disputed
markets in five months, whale-dominated votes, and 2-hour windows for results known at the
whistle. FullTime replaces all of it with math. Markets are P2P parimutuel pools on any TxLINE
stat (winner, over/under, cards, per-period corners — 1 to 5 legs; parlays settle from ONE
multi-stat proof in ONE transaction). Settlement is permissionless: anyone submits the TxLINE
Merkle proof after full-time; our Anchor program binds it to the market's fixture and stat keys,
requires the finalisation marker (period=100) on every proven leaf — so mid-game records can
never settle — and CPIs into TxODDS's on-chain validateStatV2 to verify the proof against the
root TxODDS anchored on Solana. Demonstrated live on real World Cup data: England v Argentina
(e2e), France v England settled by our crank 13.5s after the finalisation signal, and the FINAL
itself settled live: Spain 1-0 Argentina (ET) — four markets + a 3-leg parlay (ONE 5-leaf proof,
ONE tx, 8.6s) proof-settled minutes after the whistle, every outcome correct. Full settlement policy for abandonment/postponement (void + refunds) is
enforced on-chain. Built by Bravado — a production prediction-markets platform team; the TxLINE
client is the seed of our sports data layer.

**TxLINE endpoints used:** see docs/ENDPOINTS.md in the repo (fixtures snapshot, scores
snapshot/historical/stream SSE, stat-validation multiproofs, on-chain subscribe + activate,
validateStatV2 CPI, daily_scores_roots PDAs).

**API feedback:** docs/API_FEEDBACK.md in the repo — includes the validateStatV2 CU-budget
composability question, devnet faucet friction, odds schema docs gaps, and a proposal for an
official payload-builder npm package.

**Team:** Bravado (bravadotrade.com) — Hugo Noyma + Claude (AI agent, per hackathon rules).
