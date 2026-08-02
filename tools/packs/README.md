# tools/packs — the pack pipeline

Every byte a captain sees offline comes through here, provenance-stamped
(Data Governance Register R1/R4).

| Script | Source | Output | Status |
|---|---|---|---|
| `hydro.mjs` | Natural Earth 10m lakes & rivers (public domain, bundled via @geo-maps) | `demo/packs/hydro-<region>.json` | **working** — runs anywhere, no native deps |
| `enc.mjs` | NOAA ENC S-57 cells (public domain) | PMTiles per layer + manifest | code complete; runs where `gdal-bin` + `tippecanoe` are installed (CI/production) |
| live-obs pack | NOAA NDBC + CO-OPS | `demo/packs/live-obs.json` | fetchers in `apps/workers`; sandbox snapshot committed with provenance |

## ENC pipeline (CI)

```bash
sudo apt-get install gdal-bin tippecanoe   # CI image
# download cells from https://charts.noaa.gov/ENCs/ (e.g. US5NJ51M for Manasquan)
node tools/packs/enc.mjs nj-coast US5NJ51M.zip US5NJ52M.zip
```

Extracted S-57 layers: DEPARE (depth areas → the tinted bands), DEPCNT, COALNE,
SOUNDG (soundings), BOYLAT/BOYSPP (aids), LIGHTS, OBSTRN, WRECKS, RESARE.

A failed stage quarantines the pack — nothing publishes on a warning (R4).
