# TxLINE endpoints used by FullTime

All calls carry both credentials: `Authorization: Bearer <guest JWT>` + `X-Api-Token`.
Network: devnet (`https://txline-dev.txodds.com`). The client (`packages/txline-client`) also
supports mainnet via config.

## Auth lifecycle
| Endpoint | Use |
|---|---|
| `POST /auth/guest/start` | Guest JWT (30-day), auto-refreshed on 401 |
| on-chain `txoracle.subscribe(serviceLevelId=1, weeks=4)` | Free-tier subscription (World Cup) |
| `POST /api/token/activate` | Exchange subscribe tx + wallet signature (`${txSig}:${leagues}:${jwt}`, base64 detached ed25519) for the API token |

## Data
| Endpoint | Use |
|---|---|
| `GET /api/fixtures/snapshot?competitionId=72&startEpochDay=D` | World Cup fixtures for the market list / market creation |
| `GET /api/scores/snapshot/{fixtureId}?asOf=ts` | Live score state for the market page |
| `GET /api/scores/historical/{fixtureId}` | Replay of completed fixtures (finalised record discovery, demo vs real WC matches) |
| `GET /api/scores/stream` (SSE) | Real-time feed for the settlement crank (`game_finalised` trigger) |
| `GET /api/odds/snapshot/{fixtureId}` | StablePrice consensus line shown against pool-implied odds |

## Proofs / on-chain
| Endpoint | Use |
|---|---|
| `GET /api/scores/stat-validation?fixtureId&seq&statKeys=k1,k2,…` | Multi-stat Merkle proof for settlement (1–5 keys, ordered) |
| on-chain `txoracle.validateStatV2(payload, strategy)` | CPI'd from `fulltime.settle` — proof verification + predicate evaluation against `daily_scores_roots` PDA |
| `daily_scores_roots` PDA (`["daily_scores_roots", u16le(epochDay)]`) | Derived from the proof's `minTimestamp`, per docs |

Stat keys used in demo markets: `1,2` (full-match goals), `5,6` (red cards), `3007` (H2 home
corners), parlay `1,2,3007`.
