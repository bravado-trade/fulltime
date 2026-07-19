# FullTime Settlement Policy

The ugly edge cases are where sports settlement dies (they are the #1 source of Polymarket
resolution disputes). This policy maps every TxLINE game state to a deterministic on-chain
outcome — written down *before* the matches, the way it should be.

## Normal settlement

- A market settles from a TxLINE scores record with `action = game_finalised`
  (`statusId = 100`, `period = 100`). TxODDS emits exactly this marker whether the match ends in
  regulation, extra time, or penalties — one signal, no ambiguity.
- The program enforces `period == 100` on **every stat leaf inside the Merkle proof**. Proofs
  built from in-running records are rejected on-chain (`NotFinalised`).
- Settlement is permissionless. The first valid proof settles the market; subsequent attempts
  fail (`MarketNotOpen`). There is nothing to dispute: a second "conflicting" proof cannot exist
  unless TxODDS's own anchored Merkle root contains it.

## Market semantics

- **Full-match markets** (keys 1–8, prefix 0) include extra time and penalty shootout goals as
  encoded by TxODDS in the finalised record. "Home side wins" on a knockout fixture means
  *advances/lifts the trophy* semantics as reflected in final stats.
- **Period markets** (prefix 1000/3000/4000/5000/6000) settle strictly on that period's stats
  from the finalised record — e.g. "5+ H2 corners" counts second-half corners only.
- Threshold comparisons use the oracle's own predicate evaluation (GT / LT / EQ over i32 stats)
  — the market's stored legs are rebuilt into the CPI strategy verbatim; the settler cannot
  substitute predicates.
- **Parlays**: all legs are evaluated inside a single `validateStatV2` call over one multi-stat
  proof. The market resolves YES only if the oracle returns true for the full conjunction.

## Abnormal fixtures

| Scenario | TxLINE signal | FullTime outcome |
|---|---|---|
| Abandoned | game state 15 / no finalisation | `void()` after 48h timeout → full refunds |
| Cancelled / postponed | game state 16 / 19, `GameState=6` on fixture | same — `void()` refunds |
| TxODDS coverage cancelled/suspended | game states 17–18 | same — `void()` refunds |
| Match finalised as abandoned by TxODDS | `game_finalised` emitted | settles on final recorded stats (mirrors bookmaker "result stands" rules) |
| One-sided pool (no counterparty) | — | settlement auto-voids → refunds |

## Known limitations (honest list)

- The 48h void timeout is a blunt instrument for postponements: a fixture rescheduled within the
  window could in principle still finalise. Roadmap: read the fixture-state proof
  (`validate_fixture`) on-chain to void early with evidence instead of a timer.
- Market creators choose the stake deadline; a deadline set after kickoff allows in-play staking
  by design (the finality gate still protects settlement).
- The oracle program address is constrained to TxODDS's published program IDs; if TxODDS rotates
  programs, markets created against the old ID must void by timeout.
