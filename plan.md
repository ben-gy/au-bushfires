# Site Plan: Bushfires

## Overview
- **Name:** Bushfires
- **Repo name:** au-bushfires
- **Tagline:** Every mapped bushfire in Australia since 1899 — 124 years of fire scars, corrected for the double-counting that inflates most published totals.

### Naming Convention
Plain topic name, no country code. `country: "AU"` in the index entry supplies the flag.

## Target Audience
Four groups, in priority order:

1. **People who live where it burns** — residents of the Blue Mountains, East Gippsland,
   the Adelaide Hills, the WA south-west. They arrive in October wanting one answer:
   *has my area burnt before, how often, and when was the last time?* They are on a
   phone, they are not experts, and they may be anxious. The Regions view exists for them.
2. **Journalists and editors** in fire season, who need a defensible number fast and who
   currently get burnt by the duplicate-row trap in this exact dataset.
3. **Researchers, planners and RFS/CFA volunteers** who want the long series and the
   caveats spelled out rather than hidden.
4. **The generally curious**, who have absorbed "Black Summer was the biggest fire ever"
   and will find the real picture genuinely surprising.

## Value Proposition
The Digital Atlas publishes 311,984 fire polygons under CC BY 4.0. Three things make
them unusable in practice, and this site fixes all three:

1. **Multi-part fires are exploded into one row per polygon, and every row repeats the
   parent fire's full `area_ha`.** One WA fire (`BF 2019 ESP 013`, 162,367 ha) appears
   23 times, inflating the national total by 3.57 million hectares on its own. A naive
   `SUM(area_ha)` over the 2019-20 season returns 31.8 Mha; the correct figure is
   16.5 Mha. **Most published analyses of this file are silently doubled.** This site
   dedupes, shows the delta openly, and pins the result to published figures in CI.
2. **The history is split across three services that overlap for three full seasons.**
   The historic layer runs to Oct 2023, the 2020–25 layer starts Jul 2020. Union them and
   you double-count 2020–2023. This site cuts over at 1 July 2020.
3. **There is no way to ask "has my suburb burnt?"** — the data is a national polygon
   soup with no administrative geography attached. This site intersects every fire
   against all 566 ABS LGAs so the question becomes a search box.

Nothing else does this. The government portals publish the raw service; the news
coverage publishes the inflated numbers.

## Data Sources
| Source | URL | What it provides | Update frequency | Auth required? |
|--------|-----|-------------------|-----------------|----------------|
| Historical Bushfire Boundaries v2.0 (Digital Atlas / NBIC) | `services-ap1.arcgis.com/.../Bushfire_Boundaries_Historic_Dec_view/FeatureServer/0` | 311,984 fire polygons, 1899-12-30 → 2023-10-15, 7 states (no NT) | Irregular, ~annual | No |
| Historical Bushfire Extents 2020–25 — "Other States" (layer 3) | `.../Historical_Bushfire_Extents_2020%E2%80%9325_View/FeatureServer/3` | 43,778 records, 2020-07-01 → 2025-06-30 | Annual | No |
| Historical Bushfire Extents 2020–25 — "Northern Territory" (layer 0) | `.../FeatureServer/0` | 2,489 records, 2020-09-11 → 2025-08-10 — the **only** NT data that exists | Annual | No |
| Near Real-Time Bushfire Extents | `.../Near_Real_Time_Bushfire_Boundaries_view/FeatureServer/3` | 511 current extents, ~3-hourly | ~3-hourly (client-side) | No |
| NSW RFS major incidents | `rfs.nsw.gov.au/feeds/majorIncidents.json` | Live NSW incidents, GeoJSON | Minutes (client-side) | No |
| ABS ASGS 2021 LGA boundaries | `geo.abs.gov.au/arcgis/rest/services/ASGS2021/LGA/MapServer/0` | 566 LGA polygons for the regional join | Static | No |
| ABS ASGS state boundaries | `patterns/geo/au-states.geojson` | 8 state/territory polygons | Static | No |

**Licences.** Fire data: **CC BY 4.0**, `licenseInfo` read directly from the ArcGIS item
(`db9ae2c1d2374e20b60f26c45118f6f3`), © Commonwealth of Australia (Geoscience Australia),
owner `aus_digitalatlas`. Boundaries: **CC BY 4.0**, ABS. Both attributions appear in the
footer and the About modal, and must never be stripped.

## Key Features
1. **Regions** — search any of 566 LGAs: times burnt, total area, largest single fire,
   most recent burn, and a per-decade strip. The "has my area burnt" answer.
2. **The correction** — a first-class view showing naive vs deduped totals side by side,
   the 23-copy WA fire as the worked example, and the Black Summer rebuild checked
   against published figures.
3. **Fire-scar map** — real polygons for the largest fires, season slider, type filter.
4. **Seasons** — 124 years of burnt area binned July–June, stacked by state, with the
   NT data gap drawn explicitly rather than left to be misread as "the NT doesn't burn".
5. **Size distribution** — log-scale histogram showing fire sizes span six orders of
   magnitude, which is why every quantile-binned map of this data lies.
6. **Causes** — cause × type × state, with a permanent coverage strip stating that
   94% of fires have no recorded cause.
7. **Burning now** — live client-side feed, with the counter broken out by type so it
   can never read "511 fires burning".
8. **Coverage & integrity** — records per state normalised by land area, exposing that
   WA's 53% share of all records is partly reporting intensity, not fire reality.

## Style Direction
**Tone:** calm/authoritative, closer to a Bureau of Meteorology product than a news
dashboard. Bushfires killed 33 people directly in 2019-20 and destroyed over 3,000 homes.
**No gamified microcopy, no "leaderboard of destruction", no playful loading text.**

**Colour palette:** warm off-white base (`#fbf9f7`) with deep charcoal text; a controlled
ember accent (`#c2410c`) used for fire quantities, and a distinct amber for prescribed
burns so deliberate burning never reads as wildfire. Sequential ochre→ember ramp for
burn frequency — **never** a quantile scale (fire sizes span six orders of magnitude and
quantile bins would make a 1 ha grass fire the same colour as a 200,000 ha megafire).

**UI density:** balanced. Data-dense where the audience is expert (Correction, Coverage),
spacious and plain-language where it is not (Regions, Overview).

**Dark/light theme:** light. The audience is the general public in daylight, often on a
phone; a dark "monitoring console" aesthetic would misrepresent a historical archive.

**Reference sites for tone:** bom.gov.au warnings pages; the ABC's fire coverage graphics.

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite 6 (no React — this is one page with view switching,
  not a component tree)
- **Data strategy:** **pipeline** (quarterly cron) **+ client-side realtime for one view**.
  The historical archive is harvested by `pipeline/collect.mjs` and committed as JSON.
  The "Burning now" view polls public CORS-open feeds **in the browser** — there is no
  scheduled Action polling live data and no server-side archiving of it, per the
  realtime rule. Cron cadence: **quarterly**, matching the source's irregular ~annual
  republication (staggered to day 9, off-hour).
- **Key libraries:** `leaflet@^1.9` (npm, never CDN). No chart library — SVG is
  hand-rolled; treemap/tooltip/zoom/network come from `patterns/`.

## Layout
Sticky header (brand + word-only tabs + `?` About). Main content max-width 1680px.
Sticky footer via `#app { min-height:100vh; display:flex; flex-direction:column }`.
Below 768px: tabs scroll horizontally, stat grids collapse to one column
(`minmax(0,1fr)`), tables and charts scroll inside their own `overflow-x:auto`.
Drill-downs are a right-hand drawer that is **detached from the DOM when closed**.

## Pages/Views
Single page, hash-routed (`#view=regions&lga=blue-mountains`), eight views.

## Visualization Strategy

| View | Question it answers | Why this form | Insight the others can't give |
|---|---|---|---|
| **Overview** | What am I looking at, and what's surprising? | Stat row + finding cards | Entry point; carries the 2012-beat-Black-Summer finding |
| **Regions** | *Has my area burnt, how often, when last?* | Searchable table + per-LGA drawer + choropleth | The only view that is personal. Drives repeat visits each summer |
| **Map** | Where are the scars? | Leaflet + real polygons | Shape and location — no table conveys that the same ridge burns repeatedly |
| **Seasons** | How does burnt area vary across 124 years? | Stacked time-series, July–June bins | Trend and the NT gap; reveals rangeland years dominate |
| **Sizes** | How big is a typical fire? | Log-scale histogram, faceted | Distribution — shows the six-order-of-magnitude spread that breaks naive colour scales |
| **Causes** | What starts fires, and how much do we actually know? | Matrix heatmap + coverage strip | Cross-tab; lightning is rarer than arson but burns 20× the area |
| **Correction** | Can I trust the headline number? | Naive-vs-deduped comparison + worked example | Methodological transparency as a feature, not a footnote |
| **Burning now** | What is on fire right now? | Live map + typed counters | Currency — the only view that changes between visits |

**Colour is consistent across every view:** each state keeps one colour everywhere;
bushfire is always ember, prescribed burn always amber, unknown always slate.

## Data Correctness Gates (CI, not comments)
1. **Dedupe key** = `(state, fire_id, ignition_date, area_ha, perim_km)`; rows with a
   null or `'0'` fire_id are **never** merged (measured difference: 46 ha — the
   conservative choice is free).
2. **Anchor gate:** deduped 2019-20 NSW must be 5.40–5.60 Mha against the published
   ~5.5 Mha, and the ACT's Orroral Rocks Wildfire must be ~87,926 ha against the
   published ~87,000 ha. External, falsifiable, and fails loudly.
3. **Overcount gate:** naive 2019-20 national total must exceed deduped by >1.9×,
   proving the dedupe is still doing its job after any parser change.
4. **No-overlap gate:** no stitched record may have `ignition_date >= 2020-07-01` and
   come from the historic layer.
5. Layout tests assert positions (no overlap, in bounds, no NaN), not just areas.
