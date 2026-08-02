# BLACK ⚑ FLAG

**Maritime intelligence. Decision support for captains.**

> Information answers *what?* Intelligence answers *what should I do?*

This is the Black Flag monorepo — the wedge product: trip planning, plotting,
fuel estimation, and go/no-go decision support for recreational coastal captains.

## Governing documents

The engineering docs live in the Black Flag project space and govern this code:

| Document | What it fixes |
|---|---|
| Vision & Principles v0.2 | who we serve, what trust costs |
| System Architecture Overview v0.1 | decisions D1–D10, the shape of everything here |
| Offline & Sync Design v0.1 | the op log, packs, the three guarantees |
| Recommendation & Explainability Standard v0.1 | the Explanation object — **normative for `packages/core`** |
| Data Governance Register v0.1 | every data source, licensed and gated |
| Trust Metrics Definition v0.1 | the numbers we are judged by |

## Layout

```
packages/core     Shared Intelligence Core — pure TS, zero deps. Every answer is an Explanation.
packages/schema   Entity types + sync operation vocabulary (client and server import the same file).
apps/web          The Captain's PWA — installable, offline-first planning surface.
demo/             Single-file product demo (the go/no-go surface, running the real core).
tools/packs       (next) ENC → PMTiles and GRIB2 → weather-pack pipeline.
```

## Quickstart

```bash
npm install
npm test          # Intelligence Core suite — 12 tests, the release gate
npm run demo      # → demo/blackflag-demo.html (open in any browser)
npm run build     # → apps/web/dist (installable PWA; npx serve apps/web/dist)
```

## The rules of this codebase

1. **The core returns Explanations, never bare numbers.** `explanation()` throws
   on an empty caveats list. This is the Explainability Standard, enforced by type.
2. **The core is pure.** No I/O, no platform APIs, no dependencies, no `Date.now()`.
   Same inputs + same version = same answer, bit for bit — CI asserts it.
3. **Offline is not a mode.** Nothing in `apps/web` may require the network for
   core planning functions.
4. **No unregistered data sources.** See the Data Governance Register before
   adding any fetch to the pipeline.

## Status (week 1 of the 90-day build order)

- [x] Monorepo, CI, Intelligence Core (fuel · tidal gate · departure windows · confidence) — tested
- [x] Go/no-go planning surface (demo + PWA shell with SW/manifest)
- [ ] Chart pipeline: first NOAA ENC region → PMTiles (`tools/packs`)
- [ ] MapLibre chart rendering replacing the stylized SVG
- [ ] Local SQLite (WASM/OPFS) + outbox → sync service

*Not for navigation. Demo forecast/tide data ships in NOAA formats but is synthetic.*
