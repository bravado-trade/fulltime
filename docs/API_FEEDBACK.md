# TxLINE API feedback (from the FullTime team @ Bravado)

Context: we integrate third-party APIs professionally (our production platform consumes
Polymarket CLOB/Gamma, Privy, and several data vendors). Overall: TxLINE's docs-first approach
(llms.txt, full OpenAPI YAML, runnable scripts) is above the bar for a product this new. The
feedback below is what we hit building a settlement engine against it in one day.

## Things that worked well
- The `tx-on-chain` examples repo is the real documentation — `subscription_scores_v3c.ts` with
  real finalised fixture IDs (England v Argentina 18241006 seq 962) saved us hours.
- One `game_finalised` marker regardless of regulation/ET/pens is exactly right for settlement.
- `period` traveling inside each proven `ScoreStat` leaf is quietly the most important design
  decision in the product: it's what lets a consumer contract enforce finality on-chain. It
  deserves a headline in the docs, not an implicit detail.
- Guest JWT + on-chain subscribe + signed activation is a clean permissionless auth story.

## Friction / requests

1. **`validateStatV2` compute budget.** Docs say to set 1.4M CU — the whole tx limit. For
   composability (our `settle` wraps it in a CPI plus escrow logic) publish the *actual* consumed
   CU per proof size, and ideally optimize headroom: a settlement engine needs room for its own
   logic in the same transaction. This is the single biggest integration risk for anyone building
   "trustless settlement engines using Merkle proofs and CPIs" as the hackathon brief suggests.
2. **Devnet faucet dependency.** Free-tier auth requires an on-chain subscribe, which requires
   devnet SOL, and the public faucet was dry/rate-limited for most of our build day. A hackathon
   (or dev-tier) faucet — or a signed-message auth path that skips the tx for the free tier —
   would remove the only hard blocker we hit.
3. **Odds payload semantics are underdocumented.** `SuperOddsType` and the `Pct[]` array need a
   decoding table in the docs; we reverse-engineered enough for a reference display, but pricing
   consumers will need the full mapping.
4. **Fixture → competition discovery.** Finding "the World Cup final's fixtureId" requires
   scanning `fixtures/snapshot` day by day per competition. A `GET /fixtures/upcoming?competitionId=`
   with a date range (or fixture search by participants) would help every consumer UI.
5. **Proof endpoint ergonomics.** `stat-validation` returns base64 hashes while the on-chain
   types want `[u8; 32]` — every consumer rewrites the same `toBytes32`/`toProofNodes` mappers
   that exist in three of your example scripts. Ship a tiny official npm package with the payload
   builders (and the PDA derivations); it would cut every integration's first hour.
6. **SSE stream niceties.** Document heartbeat cadence and add a `Last-Event-ID` example for
   resuming mid-match; a settlement crank must not miss `game_finalised` over a reconnect.

## Found live during the World Cup final (July 19)

7. **Proof availability lags finalisation by ~90s.** At the final whistle the settlement crank
   got 404s from `stat-validation` for the finalised seq until the batch root was anchored
   (~9 poll cycles). Expected given the anchoring pipeline, but worth documenting with an
   expected upper bound — a settlement engine needs to know how long to keep retrying, and
   consumers will otherwise misread the 404 as "wrong seq".
8. **`DuplicateStatCoverage` makes conjunctions over shared stats non-obvious.** A parlay
   "home wins AND over 2.5" needs stats 1,2 in two predicates — rejected (exactly-once
   coverage). The workaround (request duplicated keys, `statKeys=1,2,1,2,3007`, and give each
   predicate its own leaf pair) works and your API happily serves duplicate leaves — but we
   found it by trial and error at 22:30 UTC on deadline day. Document it, or allow multi-cover
   in the strategy validator.

## Would we pay for this?
For a sports vertical: yes — the 60s-delay tiers are priced right for fan-facing surfaces. The
real-time tier's value for us is the settlement path plus the sharp consensus line; a
settlement-only tier (scores + proofs, no odds) at a lower price point would be an easy yes.
