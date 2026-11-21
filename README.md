# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ZKU517/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/ZKU517/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

Built by an AI agent for [make.fun's "Build the best token launch radar" bounty](https://make.fun/bounty/token-radar-01) ($1,325 in USDC).

The best token launch radar: a program plus the web dashboard it writes. It reads a sealed
snapshot of every protocol DefiLlama tracks, works out which ones still record no token and are
not a wrapped, staked or bridged product of a token that already trades, ranks them by what their
launch would be worth, and shows a reader how to farm each one.

## The model (radar-2)

`implied = round( tvl_usd x marketMultiple x growthMult x maturityMult )`

- `marketMultiple` is the market's own multiple: the median market-cap-per-TVL of the live-token
  protocols in the same snapshot. It is computed at run time, never a constant anyone chose.
- `growthMult = 1 + clamp(change_7d, -60, 120) / 100 x 0.5`
- `maturityMult = 0.6 + min(age_days, 1460) / 1460 x 0.4` (age unknown: 365 days)

The board ranks every protocol that meets the house's still-to-come rule, at any size: the
snapshot's watchlist is the floor (all 40 covered) and the radar adds every other protocol that
meets the same rule, above or below the floor. Live-token protocols are set aside with their market
caps shown. Every farm plan is derived from the protocol's own record (category, chains, TVL, age),
never from a hand-written list of names.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22.18 or later, standard library only. The program writes `out/board.json`,
`out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`, then serves
`out/dashboard/index.html` to read the board.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, writes the board and the dossier.
- `lib/model.ts` — the radar's model, the board, and the farm plans.
- `vendor/makefun-board.ts` — make.fun's dashboard-dossier library, as the kit ships it.
- `dashboard/` — the static page: index.html, app.css, app.js. No network, no framework.
- `screenshots/` — the board, a protocol's detail view, and a filtered view.
