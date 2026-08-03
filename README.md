# Bushfires

**Every mapped bushfire in Australia since 1899 — 124 years of fire scars, corrected for the double-counting that inflates most published totals.**

🔗 **Live:** [https://au-bushfires.benrichardson.dev](https://au-bushfires.benrichardson.dev)

## What is this?

Australia's state and territory fire agencies map the boundary of nearly every fire
they attend. Geoscience Australia compiles those maps into a single national dataset
and publishes it openly. This site is that dataset, made usable: **187,685 distinct
fires** between 1899 and 2025.

The raw file is close to unusable for three reasons, and this site fixes all three.

**It double-counts.** A fire that burnt several separate patches of ground is stored as
one row per patch — and every one of those rows repeats the *whole fire's* area. One
Western Australian fire of 162,367 ha is stored twenty-three times over, adding 3.7
million phantom hectares on its own. Sum the area column for the 2019–20 season and you
get 31.8 million hectares; the correct figure is 16.5 million. Most published analyses
of this file are silently doubled. This site collapses repeated rows to one record per
fire and shows both numbers side by side.

**Its history is split across services that overlap.** The historical layer runs to
October 2023, the 2020–25 layer starts July 2020, and for three seasons they contain the
same fires. Combining them adds those seasons twice. This site cuts over at 1 July 2020
and asserts in CI that no historical record crosses that line.

**It has no administrative geography.** There is no way to ask "has my suburb burnt?" of
a national polygon soup. This site intersects every fire against all 547 Australian
council areas, so that question becomes a search box.

## Who is this for?

- **People who live where it burns** — residents of the Blue Mountains, East Gippsland,
  the Adelaide Hills, the WA south-west, who want to know whether fire has reached their
  council before, how often, and when it last did.
- **Journalists and editors** in fire season who need a defensible number fast, and who
  are otherwise likely to publish the doubled one.
- **Researchers, planners and RFS/CFA volunteers** who want the long series with its
  caveats stated rather than buried.
- **Anyone who assumes Black Summer was the largest fire season on record.** It ranks
  fifth.

## Data Sources

| Source | What it provides | Update frequency |
|--------|-------------------|-----------------|
| [Digital Atlas of Australia](https://digital.atlas.gov.au/) — Historical Bushfire Boundaries v2.0 | 311,984 fire polygons, 1899 → Oct 2023, seven states | Irregular, ~annual |
| Digital Atlas — Historical Bushfire Extents 2020–25 | 46,267 records to Aug 2025, including the only NT data that exists | Annual |
| Digital Atlas — Near Real-Time Bushfire Extents | Current mapped extents, fetched live in your browser | ~3-hourly |
| [NSW Rural Fire Service](https://www.rfs.nsw.gov.au/) — major incidents | Live NSW incidents, fetched live in your browser | Minutes |
| [ABS](https://www.abs.gov.au/) — ASGS 2021 LGA and state boundaries | 547 council areas for the regional join | Static |

Fire data and boundaries are both **CC BY 4.0**. Victoria's emergency feed is
deliberately absent: it sends no cross-origin header, so a browser is not permitted to
read it.

## Features

- **Your area** — search any of 547 council areas for seasons with fire, fires that
  reached it, its largest fire, and when it last burnt
- **Map** — 7,260 real fire-scar polygons with a season slider and type filter
- **Seasons** — 124 years of burnt area, binned July–June, with the Northern Territory
  data gap drawn explicitly rather than left to be misread
- **The correction** — the double-counting explained, with the twenty-three-times fire
  as a worked example and Black Summer rebuilt state by state
- **Fire size** — a log-scale distribution showing fire size spans six orders of
  magnitude, which is why quantile-binned maps of this data mislead
- **Causes** — cause × state, behind a permanent strip stating that only 11% of fires
  have a recorded cause at all
- **Coverage** — records per state normalised by land area, exposing how much of the
  pattern is mapping effort rather than fire
- **Right now** — live extents and NSW incidents, with counters broken out by type so
  the page can never claim "511 fires burning"

## Tech Stack

- **Runtime:** Vanilla TypeScript (no framework — one page, nine views)
- **Build:** Vite 6
- **Testing:** Vitest — 71 tests
- **Maps:** Leaflet 1.9 with real ABS/Digital Atlas GeoJSON
- **Hosting:** GitHub Pages (static, no backend)
- **Data:** GitHub Actions pipeline, quarterly, plus client-side live feeds

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Production build
npm run build

# Preview production build
npm run preview

# Re-harvest the data (~10 minutes)
npm run collect
```

## How it works

`pipeline/collect.mjs` runs five passes: it harvests ~318,000 attribute rows from three
stitched ArcGIS layers; dedupes them to one record per fire; downloads simplified
polygons for fires of 5,000 ha and above; posts each of the 547 ABS council boundaries
back to the fire service as a spatial filter to compute the regional join; and finally
**asserts the result against published figures** before writing anything.

That last pass is the point. New South Wales in 2019–20 must come out between 5.30 and
5.65 million hectares against the widely published ~5.5 million, the ACT's Orroral
Valley fire must land near 87,000 ha, and the naive sum must still exceed the corrected
one by at least 1.9×. If a change breaks the correction the build fails loudly instead
of quietly publishing doubled numbers. The same anchors are re-asserted against the
committed JSON in `tests/data.test.ts`, so a bad file can never ship even if it was
committed by hand.

The frontend reads a few hundred kilobytes of JSON; the 3.5 MB fire-polygon layer loads
only when the map is opened.

## Caveats

- **Cumulative area is not land area.** The same ground burns repeatedly and every burn
  counts again, so the headline total approaches the size of the continent. It is not a
  measure of how much of Australia has burnt.
- **The Northern Territory is missing before 2020–21** — not because it did not burn.
- **Council figures count whole fires.** A fire counts for a council if any part of it
  falls inside, at its full size, so a council's combined figure can exceed its own area.
- **This is a historical research tool, not a warning service.** For current warnings
  always use your state emergency service, or call 000.

## License

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see [ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

A separate commercial licence without the AGPL's source-disclosure obligations is
available on request: <hi@ben.gy>.

Third-party components keep their own licences — see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
Data sources keep theirs, and their attribution requirements are listed in the site's
own About panel and footer.
