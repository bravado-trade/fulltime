# Demo video script (≤5 min) — FullTime

Format: screen recording with captions (no voiceover needed). OBS/QuickTime + editor.
Two cuts: FALLBACK (replay-based, ready before kickoff) and LIVE (final-whistle clip spliced in).

## Cold open (0:00–0:35) — the problem
Black slide, white text, beats of ~4s:
1. "Prediction markets settled $31B in May 2026. Most of it: sports."
2. "Settlement still works like a courtroom: proposals, bonds, disputes, token votes."
3. "1,150+ Polymarket markets disputed in 5 months. Whales dominate the votes."
4. "A football result is known the second the whistle blows. Why does it take hours — and a vote?"
5. Title card: **FullTime — settled at the final whistle.** "P2P markets on Solana, settled by
   TxODDS Merkle proofs. By Bravado."

## Act 1 (0:35–1:30) — what you're looking at
Screen: FullTime app, markets list for the World Cup final.
- Caption: "Markets on any TxLINE stat — winner, over/under, red cards, 2nd-half corners."
- Open the parlay market. Caption: "This is a 3-leg parlay. Remember it."
- Market page: live score panel + pools. Caption: "Peer-to-peer parimutuel pools. USDC escrowed
  in a program vault. No market maker, no house."
- Stake YES with Phantom on one market (show wallet popup, tx confirm, explorer link).

## Act 2 (1:30–2:30) — the settlement engine
Screen: split — settle-crank terminal + app market page.
- Caption: "Settlement is permissionless. This crank watches TxLINE's SSE feed for one signal:
  game_finalised."
- Show code snippet of `settle` (10s, zoomed on the `period == 100` check + CPI):
  "The program only accepts proofs from FINALISED records — a mid-game score can never settle a
  market. Then it CPIs into TxODDS's on-chain program to verify the Merkle proof against the
  root TxODDS anchored on Solana."
- Caption: "No multisig. No vote. No 2-hour window. Either the proof verifies, or it doesn't."

## Act 3 (2:30–3:45) — THE MOMENT
FALLBACK cut: "England v Argentina, July 15 — replayed through the exact live pipeline."
LIVE cut: "World Cup Final — live, right now."
- Terminal: crank logs streaming actions → `GAME FINALISED (seq=…)` → settle txs firing.
- App: market flips OPEN → SETTLED · YES, seconds after the whistle. Show the stopwatch line
  from crank output: "settled N markets in X.Xs after finalisation".
- Click explorer link on the settle tx. Caption: "One transaction: Merkle proof in, outcome out."
- Proof explorer panel: stat values + period=100 + link to TxODDS's daily_scores_roots account.
  Caption: "The entire settlement authority is this proof. Anyone can re-verify it, forever."
- PARLAY market settles. Caption: "3 legs — winner + over 2.5 + H2 corners — ONE proof, ONE tx.
  Optimistic oracles structurally cannot do this."
- Claim payout with Phantom, balance updates.

## Close (3:45–4:30)
1. "Everything here is open source. Anchor program + TS client + this app." (repo URL)
2. "The edge cases are written down BEFORE the match: abandonment, postponement, void +
   refunds — on-chain." (flash SETTLEMENT_POLICY.md)
3. "Built in 36 hours by Bravado — we run a production prediction-markets platform. This is how
   we think sports settlement should work."
4. End card: FullTime logo · "settled at the final whistle" · TxODDS TxLINE x Solana ·
   repo + live URL.

## Shot checklist (record BEFORE kickoff)
- [ ] Cold-open slides (static, 30s)
- [ ] Markets list scroll
- [ ] Stake flow with Phantom popup
- [ ] settle code snippet zoom
- [ ] FALLBACK Act 3 vs England v Argentina via e2e/crank replay
- [ ] Claim flow
- [ ] End card
- LIVE swap: re-record ONLY Act 3 during the final; keep everything else.
