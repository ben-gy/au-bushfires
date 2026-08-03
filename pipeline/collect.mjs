// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Harvest the Digital Atlas bushfire archive and write every JSON the site serves.
//
// Five passes, in order:
//   1. attributes  — all ~358k rows from three stitched layers (no geometry)
//   2. aggregate   — dedupe, then season / cause / size / state rollups
//   3. geometry    — simplified polygons for the largest fires only
//   4. regions     — server-side spatial intersection against 566 ABS LGAs
//   5. anchors     — assert the result against published figures, then write
//
// Pass 5 is not a formality. The dedupe in pass 2 is the difference between
// 31.8 Mha and 16.5 Mha for a single season, and a silent regression there
// would be invisible in every chart while making all of them wrong.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  STATES, STATE_LABEL, STATE_AREA_KM2, cleanState, cleanType, cleanCause,
  CAUSE_ORDER, seasonOf, dedupe, belongsToHistoric, sizeBin, SIZE_BINS,
  slug, titleCase, cleanName, dedupeKey, ANCHORS,
} from './parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'data');

const HISTORIC = 'https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/Bushfire_Boundaries_Historic_Dec_view/FeatureServer/0';
// The service path contains a literal U+2013 EN DASH. Percent-encoded here on
// purpose: an unencoded en-dash resolves locally on macOS and 404s on CI.
const EXT_BASE = 'https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/Historical_Bushfire_Extents_2020%E2%80%9325_View/FeatureServer';
const EXT_NT = `${EXT_BASE}/0`;
const EXT_OTHER = `${EXT_BASE}/3`;
const LGA = 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/LGA/MapServer/0';

const FIELDS = 'fire_id,fire_name,ignition_date,fire_type,ignition_cause,area_ha,perim_km,state,agency';
const PAGE = 2000;

const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

async function getJson(url, params, { attempt = 0, post = false } = {}) {
  const body = new URLSearchParams({ f: 'json', ...params });
  const target = post ? url : `${url}?${body}`;
  try {
    const res = await fetch(target, post
      ? { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }
      : {});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    // ArcGIS reports failures with HTTP 200 and an `error` body. Treating that
    // as success is how a harvest silently returns zero rows.
    if (j.error) throw new Error(`ArcGIS ${j.error.code}: ${j.error.message}`);
    return j;
  } catch (err) {
    if (attempt >= 4) throw new Error(`${url} — ${err.message}`);
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    return getJson(url, params, { attempt: attempt + 1, post });
  }
}

/**
 * Page through a layer's attributes.
 *
 * The page size is whatever the SERVER decides to give us, not what we asked
 * for: the historic layer honours 2000, the 2020-25 layers cap at 1000. Breaking
 * on `feats.length < PAGE` therefore stopped after a single page and silently
 * lost 45,000 of the newest records. Advance by the count actually returned and
 * trust `exceededTransferLimit`, which is the only authoritative "there is more"
 * signal ArcGIS gives.
 */
async function harvest(layer, label, where = '1=1') {
  const rows = [];
  let offset = 0;
  for (;;) {
    const j = await getJson(`${layer}/query`, {
      where,
      outFields: FIELDS,
      returnGeometry: 'false',
      orderByFields: 'objectid',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
    });
    const feats = j.features ?? [];
    for (const f of feats) rows.push(f.attributes);
    const more = j.exceededTransferLimit === true || j.properties?.exceededTransferLimit === true;
    if (!feats.length || !more) break;
    offset += feats.length;
    if (rows.length % 50000 < feats.length) log(`   …${label} ${rows.length}`);
  }
  log(`  ${label}: ${rows.length} rows`);
  return rows;
}

// ── Pass 1 — attributes ─────────────────────────────────────────────────────

async function collectRows() {
  log('Pass 1 — attributes');
  // The historic layer is truncated at the stitch boundary rather than filtered
  // afterwards, so the overlapping 2020-2023 rows never enter the pipeline at all.
  const historic = await harvest(HISTORIC, 'historic 1899→2020-06', "ignition_date < DATE '2020-07-01'");
  const other = await harvest(EXT_OTHER, '2020-25 other states');
  const nt = await harvest(EXT_NT, '2020-25 northern territory');

  const rows = [];
  const push = (src, source) => {
    for (const a of src) {
      const st = cleanState(a.state);
      const ms = a.ignition_date ?? null;
      rows.push({
        fire_id: a.fire_id, fire_name: a.fire_name, ignition_date: ms,
        area_ha: Number(a.area_ha) || 0, perim_km: Number(a.perim_km) || 0,
        state: st, type: cleanType(a.fire_type), cause: cleanCause(a.ignition_cause),
        raw_cause: a.ignition_cause ?? null, agency: a.agency ?? null, source,
      });
    }
  };
  push(historic, 'historic');
  push(other, 'ext');
  push(nt, 'ext-nt');

  // Gate 4 — nothing from the historic layer may cross the cutover.
  const leak = rows.filter((r) => r.source === 'historic' && r.ignition_date != null
    && !belongsToHistoric(r.ignition_date));
  if (leak.length) throw new Error(`stitch leak: ${leak.length} historic rows at/after 2020-07-01`);

  log(`  stitched: ${rows.length} rows\n`);
  return rows;
}

// ── Pass 2 — aggregate ──────────────────────────────────────────────────────

function medianOf(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

function aggregate(rows) {
  log('Pass 2 — dedupe + aggregate');
  const { fires, rawRows, rawArea, dedupedArea } = dedupe(rows);
  log(`  ${rawRows} rows → ${fires.length} fires`);
  log(`  naive ${(rawArea / 1e6).toFixed(1)} Mha → corrected ${(dedupedArea / 1e6).toFixed(1)} Mha`);

  const dated = fires.filter((f) => f.ignition_date != null && seasonOf(f.ignition_date) != null);

  // Seasons ────────────────────────────────────────────────────────────────
  const seasonMap = new Map();
  for (const f of dated) {
    const s = seasonOf(f.ignition_date);
    if (s < 1899 || s > 2030) continue;
    if (!seasonMap.has(s)) {
      seasonMap.set(s, { season: s, total: 0, fires: 0, byState: {}, byType: {} });
    }
    const e = seasonMap.get(s);
    e.total += f.area_ha; e.fires += 1;
    if (f.state) e.byState[f.state] = (e.byState[f.state] ?? 0) + f.area_ha;
    e.byType[f.type] = (e.byType[f.type] ?? 0) + f.area_ha;
  }
  const seasons = [...seasonMap.values()].sort((a, b) => a.season - b.season)
    .map((e) => ({
      season: e.season,
      total: Math.round(e.total),
      fires: e.fires,
      byState: Object.fromEntries(Object.entries(e.byState).map(([k, v]) => [k, Math.round(v)])),
      byType: Object.fromEntries(Object.entries(e.byType).map(([k, v]) => [k, Math.round(v)])),
    }));

  // States ─────────────────────────────────────────────────────────────────
  const states = STATES.map((code) => {
    const sf = fires.filter((f) => f.state === code);
    const dates = sf.map((f) => f.ignition_date).filter((d) => d != null);
    return {
      code,
      name: STATE_LABEL[code],
      landKm2: STATE_AREA_KM2[code],
      fires: sf.length,
      area: Math.round(sf.reduce((a, f) => a + f.area_ha, 0)),
      firstSeason: dates.length ? seasonOf(Math.min(...dates)) : null,
      lastSeason: dates.length ? seasonOf(Math.max(...dates)) : null,
      byType: Object.fromEntries(['bushfire', 'prescribed', 'unknown'].map((t) => [
        t, sf.filter((f) => f.type === t).length,
      ])),
    };
  });

  // Causes ─────────────────────────────────────────────────────────────────
  const causes = CAUSE_ORDER.map((c) => {
    const cf = fires.filter((f) => f.cause === c);
    const area = cf.reduce((a, f) => a + f.area_ha, 0);
    return {
      cause: c,
      fires: cf.length,
      area: Math.round(area),
      meanArea: cf.length ? Math.round(area / cf.length) : 0,
      // The mean is hostage to single outliers — one 1.74 Mha WA fire drives
      // much of the "deliberate" average — and to the 31% of deliberate records
      // with area_ha = 0. The median says the same thing far more robustly.
      medianArea: medianOf(cf.map((f) => f.area_ha)),
      zeroArea: cf.filter((f) => !(f.area_ha > 0)).length,
      byState: Object.fromEntries(STATES.map((s) => [s, cf.filter((f) => f.state === s).length])),
      // Real area per state, not the state count scaled by a national mean.
      // The estimate looked plausible in a heatmap and would have been wrong
      // wherever a state's fires are atypically sized — which is most of them.
      areaByState: Object.fromEntries(STATES.map((s) => [
        s, Math.round(cf.filter((f) => f.state === s).reduce((x, f) => x + f.area_ha, 0)),
      ])),
      byType: Object.fromEntries(['bushfire', 'prescribed', 'unknown'].map((t) => [
        t, cf.filter((f) => f.type === t).length,
      ])),
    };
  });

  // Sizes ──────────────────────────────────────────────────────────────────
  const sizes = SIZE_BINS.map((b, i) => {
    const bf = fires.filter((f) => sizeBin(f.area_ha) === i);
    return {
      label: b.label,
      fires: bf.length,
      area: Math.round(bf.reduce((a, f) => a + f.area_ha, 0)),
      byState: Object.fromEntries(STATES.map((s) => [s, bf.filter((f) => f.state === s).length])),
      byType: Object.fromEntries(['bushfire', 'prescribed', 'unknown'].map((t) => [
        t, bf.filter((f) => f.type === t).length,
      ])),
    };
  });

  // Types ──────────────────────────────────────────────────────────────────
  const types = ['bushfire', 'prescribed', 'unknown'].map((t) => {
    const tf = fires.filter((f) => f.type === t);
    return { type: t, fires: tf.length, area: Math.round(tf.reduce((a, f) => a + f.area_ha, 0)) };
  });

  // Biggest individual fires ───────────────────────────────────────────────
  const biggest = [...fires].sort((a, b) => b.area_ha - a.area_ha).slice(0, 200).map((f) => ({
    name: cleanName(f.fire_name),
    state: f.state,
    season: f.ignition_date != null ? seasonOf(f.ignition_date) : null,
    date: f.ignition_date,
    area: Math.round(f.area_ha),
    type: f.type,
    cause: f.cause,
  }));

  return { fires, rawRows, rawArea, dedupedArea, seasons, states, causes, sizes, types, biggest };
}

/** The Correction view's worked example: the fire stored 23 times. */
function correction(rows) {
  const naiveBySeason = new Map();
  for (const r of rows) {
    const s = seasonOf(r.ignition_date);
    if (s == null) continue;
    naiveBySeason.set(s, (naiveBySeason.get(s) ?? 0) + r.area_ha);
  }
  // Worst offender across the whole archive, measured not assumed, and grouped
  // by the SAME key the dedupe uses so this table cannot omit a duplication the
  // pipeline actually corrected. Skipping id-less rows here was how the single
  // largest duplication in the file — six South Australian rows of 5,763,897 ha
  // each — stayed invisible on the one view whose whole purpose is exposing
  // duplication, while that view told readers every number had been corrected.
  const groups = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (!(r.area_ha > 0)) continue;
    const k = dedupeKey(r, i);
    if (k.startsWith('#')) continue;
    if (!groups.has(k)) groups.set(k, { row: r, copies: 0 });
    groups.get(k).copies += 1;
  }
  const worst = [...groups.values()]
    .map((g) => ({ ...g, inflation: (g.copies - 1) * g.row.area_ha }))
    .sort((a, b) => b.inflation - a.inflation)
    .slice(0, 12)
    .map((g) => ({
      fireId: (() => {
        const f = g.row.fire_id == null ? '' : String(g.row.fire_id).trim();
        return f && f !== '0' ? f : null;
      })(),
      name: cleanName(g.row.fire_name),
      state: g.row.state,
      season: seasonOf(g.row.ignition_date),
      area: Math.round(g.row.area_ha),
      copies: g.copies,
      inflation: Math.round(g.inflation),
    }));

  return { naiveBySeason, worst };
}

/** Per-state Black Summer table, naive vs corrected — the anchor view. */
function blackSummer(rows) {
  const inSeason = rows.filter((r) => seasonOf(r.ignition_date) === 2019);
  const byState = {};
  for (const r of inSeason) {
    if (!r.state) continue;
    byState[r.state] ??= { naive: 0, rows: 0 };
    byState[r.state].naive += r.area_ha;
    byState[r.state].rows += 1;
  }
  const { fires } = dedupe(inSeason);
  for (const f of fires) {
    if (!f.state) continue;
    byState[f.state] ??= { naive: 0, rows: 0 };
    byState[f.state].corrected = (byState[f.state].corrected ?? 0) + f.area_ha;
    byState[f.state].fires = (byState[f.state].fires ?? 0) + 1;
  }
  const table = Object.entries(byState).map(([code, v]) => ({
    state: code,
    name: STATE_LABEL[code],
    naive: Math.round(v.naive),
    corrected: Math.round(v.corrected ?? 0),
    rows: v.rows,
    fires: v.fires ?? 0,
  })).sort((a, b) => b.corrected - a.corrected);

  const orroral = fires
    .filter((f) => f.state === 'ACT')
    .sort((a, b) => b.area_ha - a.area_ha)[0] ?? null;

  return {
    table,
    naive: Math.round(table.reduce((a, r) => a + r.naive, 0)),
    corrected: Math.round(table.reduce((a, r) => a + r.corrected, 0)),
    orroral: orroral ? {
      name: cleanName(orroral.fire_name) ?? 'Unnamed fire',
      area: Math.round(orroral.area_ha),
    } : null,
  };
}

// ── Pass 3 — geometry ───────────────────────────────────────────────────────

/**
 * Full-fidelity geometry is ~6.5 MB per 1,000 features — two gigabytes for the
 * archive, which can never be a browser fetch. Only fires above a size floor
 * get polygons, simplified server-side with maxAllowableOffset.
 */
async function collectGeometry(minHa) {
  log('Pass 3 — geometry for large fires');
  const feats = [];
  const seen = new Set();

  async function pull(layer, label, extraWhere) {
    let n = 0;
    let offset = 0;
    for (;;) {
      const j = await getJson(`${layer}/query`, {
        where: `area_ha >= ${minHa}${extraWhere ? ` AND ${extraWhere}` : ''}`,
        outFields: 'fire_id,fire_name,ignition_date,fire_type,area_ha,state',
        returnGeometry: 'true',
        maxAllowableOffset: '0.01',
        geometryPrecision: '4',
        outSR: '4326',
        orderByFields: 'objectid',
        resultOffset: String(offset),
        resultRecordCount: '500',
      });
      const fs_ = j.features ?? [];
      for (const f of fs_) {
        const a = f.attributes;
        const st = cleanState(a.state);
        const fid = a.fire_id == null ? '' : String(a.fire_id).trim();
        // Multi-part fires arrive as separate rows here too. Keep the first
        // polygon per fire so the map shows one shape per fire, and never
        // re-sum area_ha off these features.
        const key = fid && fid !== '0'
          ? `${st}|${fid}|${a.ignition_date}|${a.area_ha}`
          : `oid|${label}|${offset}|${feats.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!f.geometry?.rings?.length) continue;
        feats.push({
          type: 'Feature',
          properties: {
            n: cleanName(a.fire_name),
            s: st,
            y: seasonOf(a.ignition_date),
            a: Math.round(Number(a.area_ha) || 0),
            t: cleanType(a.fire_type),
          },
          geometry: { type: 'Polygon', coordinates: f.geometry.rings },
        });
        n += 1;
      }
      const more = j.exceededTransferLimit === true || j.properties?.exceededTransferLimit === true;
      if (!fs_.length || !more) break;
      offset += fs_.length;
    }
    log(`  ${label}: ${n} polygons`);
  }

  await pull(HISTORIC, 'historic', "ignition_date < DATE '2020-07-01'");
  await pull(EXT_OTHER, '2020-25 other');
  await pull(EXT_NT, '2020-25 NT');

  return { type: 'FeatureCollection', features: feats };
}

// ── Pass 4 — regions ────────────────────────────────────────────────────────

/**
 * "Has my area burnt?" needs administrative geography, which the fire data does
 * not carry. Rather than approximate by centroid — which would attribute a
 * 200,000 ha fire wholly to whichever LGA happened to contain its middle — each
 * LGA polygon is posted back to the fire service as a spatial filter, so the
 * intersection is computed by the authoritative service.
 */
async function collectRegions() {
  log('Pass 4 — LGA intersection');
  const lgas = [];
  let lgaOffset = 0;
  for (;;) {
    const j = await getJson(`${LGA}/query`, {
      where: '1=1',
      outFields: 'LGA_CODE_2021,LGA_NAME_2021,STATE_NAME_2021',
      returnGeometry: 'true',
      // The ABS service defaults to Web Mercator. Requesting 4283 explicitly is
      // essential: metres sent as degrees match nothing and return a silent
      // zero rather than an error.
      outSR: '4283',
      maxAllowableOffset: '0.002',
      geometryPrecision: '4',
      orderByFields: 'LGA_CODE_2021',
      resultOffset: String(lgaOffset),
      resultRecordCount: '200',
    });
    const fs_ = j.features ?? [];
    for (const f of fs_) if (f.geometry?.rings?.length) lgas.push(f);
    const more = j.exceededTransferLimit === true || j.properties?.exceededTransferLimit === true;
    if (!fs_.length || !more) break;
    lgaOffset += fs_.length;
  }
  log(`  ${lgas.length} LGA polygons`);

  const out = [];
  let done = 0;
  for (const lgaF of lgas) {
    const a = lgaF.attributes;
    const name = a.LGA_NAME_2021 ?? a.lga_name_2021;
    const code = a.LGA_CODE_2021 ?? a.lga_code_2021;
    const stateName = a.STATE_NAME_2021 ?? a.state_name_2021;
    const geometry = JSON.stringify({
      rings: lgaF.geometry.rings, spatialReference: { wkid: 4283 },
    });

    const rows = [];
    for (const [layer, where] of [
      [HISTORIC, "ignition_date < DATE '2020-07-01'"],
      [EXT_OTHER, '1=1'],
      [EXT_NT, '1=1'],
    ]) {
      let offset = 0;
      for (;;) {
        const j = await getJson(`${layer}/query`, {
          geometry,
          geometryType: 'esriGeometryPolygon',
          spatialRel: 'esriSpatialRelIntersects',
          inSR: '4283',
          where,
          outFields: FIELDS,
          returnGeometry: 'false',
          orderByFields: 'objectid',
          resultOffset: String(offset),
          resultRecordCount: String(PAGE),
        }, { post: true });
        const fs_ = j.features ?? [];
        for (const f of fs_) {
          const x = f.attributes;
          rows.push({
            fire_id: x.fire_id, fire_name: x.fire_name, ignition_date: x.ignition_date,
            area_ha: Number(x.area_ha) || 0, perim_km: Number(x.perim_km) || 0,
            state: cleanState(x.state), type: cleanType(x.fire_type),
          });
        }
        const more = j.exceededTransferLimit === true || j.properties?.exceededTransferLimit === true;
        if (!fs_.length || !more) break;
        offset += fs_.length;
      }
    }

    const { fires } = dedupe(rows);
    const dates = fires.map((f) => f.ignition_date).filter((d) => d != null);
    const seasons = {};
    for (const f of fires) {
      const s = seasonOf(f.ignition_date);
      if (s != null) seasons[s] = (seasons[s] ?? 0) + 1;
    }
    const biggest = [...fires].sort((x, y) => y.area_ha - x.area_ha)[0] ?? null;
    out.push({
      code: String(code),
      name,
      slug: slug(name),
      state: cleanState(stateName),
      fires: fires.length,
      bushfires: fires.filter((f) => f.type === 'bushfire').length,
      prescribed: fires.filter((f) => f.type === 'prescribed').length,
      area: Math.round(fires.reduce((s, f) => s + f.area_ha, 0)),
      lastSeason: dates.length ? seasonOf(Math.max(...dates)) : null,
      firstSeason: dates.length ? seasonOf(Math.min(...dates)) : null,
      biggest: biggest ? {
        name: cleanName(biggest.fire_name),
        area: Math.round(biggest.area_ha),
        season: seasonOf(biggest.ignition_date),
      } : null,
      seasons,
    });

    done += 1;
    if (done % 50 === 0) log(`   …${done}/${lgas.length} LGAs`);
  }
  log(`  ${out.length} LGAs joined`);
  return out;
}

// ── Pass 5 — anchors + write ────────────────────────────────────────────────

function assertAnchors(bs, agg) {
  log('Pass 5 — anchor gates');
  const nsw = bs.table.find((r) => r.state === 'NSW');
  if (!nsw) throw new Error('anchor: no NSW row in the 2019-20 season');
  const a = ANCHORS.nswBlackSummerHa;
  if (nsw.corrected < a.min || nsw.corrected > a.max) {
    throw new Error(`anchor: NSW 2019-20 = ${nsw.corrected} ha, outside ${a.min}–${a.max} (published ~${a.published})`);
  }
  log(`  ✓ NSW 2019-20 = ${(nsw.corrected / 1e6).toFixed(2)} Mha (published ~5.5 Mha)`);

  if (!bs.orroral) throw new Error('anchor: no ACT fire in 2019-20');
  const o = ANCHORS.orroralHa;
  if (bs.orroral.area < o.min || bs.orroral.area > o.max) {
    throw new Error(`anchor: largest ACT fire = ${bs.orroral.area} ha, outside ${o.min}–${o.max}`);
  }
  log(`  ✓ ${bs.orroral.name} = ${bs.orroral.area.toLocaleString()} ha (published ~87,000 ha)`);

  const ratio = bs.naive / bs.corrected;
  if (!(ratio >= ANCHORS.minOvercountRatio)) {
    throw new Error(`anchor: 2019-20 overcount ratio ${ratio.toFixed(2)} < ${ANCHORS.minOvercountRatio} — dedupe may have stopped working`);
  }
  log(`  ✓ overcount ratio ${ratio.toFixed(2)}× (naive ${(bs.naive / 1e6).toFixed(1)} vs corrected ${(bs.corrected / 1e6).toFixed(1)} Mha)`);

  // Two separate completeness checks. The first guards the HARVEST (raw rows
  // pulled off the three layers); the second guards the DEDUPE output. Testing
  // deduped fires against a raw-row expectation conflates them and fails a
  // perfectly good run — the archive's 317k rows are only ~188k real fires.
  if (agg.rawRows < 300000) throw new Error(`anchor: only ${agg.rawRows} raw rows — harvest looks truncated`);
  if (agg.fires.length < 150000) throw new Error(`anchor: only ${agg.fires.length} fires after dedupe — over-merging?`);
  if (agg.fires.length > agg.rawRows) throw new Error('anchor: more fires than rows — dedupe is broken');

  // THE INVARIANT THE DEDUPE EXISTS TO ENFORCE, asserted directly rather than
  // inferred from a season total. After de-duplication no two surviving records
  // may still be identical on (state, ignition date, area, perimeter) with a
  // non-zero area — that combination is what a repeated multi-part row looks
  // like, and leaving them in is exactly how six identical South Australian
  // rows once contributed 34.6 Mha of phantom area and manufactured a
  // "largest season on record" that never happened.
  //
  // Scoped to fires of 1,000 ha and up. Below that, area_ha is rounded coarsely
  // enough that genuine collisions happen: 89 separate one-hectare WA fires
  // share a date and a zero perimeter, and they are almost certainly 89 real
  // fires rather than one stored 89 times. At 1,000 ha and above a byte-exact
  // match on area AND perimeter AND date is not a coincidence.
  const DUP_FLOOR_HA = 1000;
  const dupSeen = new Map();
  for (const f of agg.fires) {
    if (!(f.area_ha >= DUP_FLOOR_HA)) continue;
    const k = [f.state, f.ignition_date, f.area_ha, f.perim_km].join('|');
    dupSeen.set(k, (dupSeen.get(k) ?? 0) + 1);
  }
  // Judged on IMPACT, not on count. The source does sometimes give two genuinely
  // distinct fires the same size on the same day under different fire_ids, and
  // merging those would be overreach — so a small residue is tolerated, but the
  // phantom area it could contribute is measured and capped at 0.1% of the
  // national total. Anything systematic blows straight through that.
  const survivors = [...dupSeen.entries()].filter(([, n]) => n > 1);
  const phantom = survivors.reduce((a, [k, n]) => a + (n - 1) * Number(k.split('|')[2]), 0);
  const cap = agg.dedupedArea * 0.001;
  if (phantom > cap) {
    const worst = survivors.sort((a, b) => b[1] - a[1])[0];
    throw new Error(`anchor: duplicate tuples surviving dedupe imply ${Math.round(phantom).toLocaleString()} ha of phantom area, over the ${Math.round(cap).toLocaleString()} ha cap (worst: ${worst[1]} copies of ${worst[0]})`);
  }
  // Never silent: say what was tolerated, even when it passes.
  log(`  ✓ ${survivors.length} same-size duplicate group(s) above ${DUP_FLOOR_HA} ha tolerated, implying ${Math.round(phantom).toLocaleString()} ha (cap ${Math.round(cap).toLocaleString()} ha)`);
  // No single fire may dominate its own season. Before the dedupe fix, one South
  // Australian record accounted for 97.4% of the season it sat in — an impossible
  // share that no amount of staring at a bar chart reveals, but which one
  // assertion catches instantly.
  const bySeason = new Map();
  for (const f of agg.fires) {
    const y = seasonOf(f.ignition_date);
    if (y == null) continue;
    if (!bySeason.has(y)) bySeason.set(y, { total: 0, max: 0 });
    const e = bySeason.get(y);
    e.total += f.area_ha;
    if (f.area_ha > e.max) e.max = f.area_ha;
  }
  for (const [y, e] of bySeason) {
    if (e.total < 1e5) continue; // too small for a share to mean anything
    const share = e.max / e.total;
    if (share > 0.85) {
      throw new Error(`anchor: one fire is ${(share * 100).toFixed(1)}% of the ${y}-${String((y + 1) % 100).padStart(2, '0')} season (${Math.round(e.max).toLocaleString()} of ${Math.round(e.total).toLocaleString()} ha) — likely undetected duplication`);
    }
  }
  log('  ✓ no single fire exceeds 85% of its own season');
  log(`  ✓ ${agg.rawRows.toLocaleString()} rows → ${agg.fires.length.toLocaleString()} distinct fires`);
}

/**
 * Server-side `maxAllowableOffset` alone still leaves 1.9M vertices across
 * 7,260 polygons — 38 MB, which no phone on a rural connection is going to
 * fetch during a fire season. mapshaper takes that to ~3.5 MB raw / ~800 KB
 * over the wire while keeping every fire and its recognisable shape.
 *
 * Done here rather than by hand so CI reproduces the shipped file exactly.
 * Note the pipeline installs with `npm install`, never `npm ci` — mapshaper's
 * optional native deps make `ci` fail on a clean runner.
 */
function simplifyFires() {
  const raw = path.join(OUT, 'fires.raw.geojson');
  const out = path.join(OUT, 'fires.geojson');
  log('  simplifying geometry with mapshaper…');
  execFileSync('npx', [
    '--yes', 'mapshaper', raw,
    '-simplify', '8%', 'keep-shapes',
    '-o', 'precision=0.001', out,
  ], { stdio: ['ignore', 'ignore', 'inherit'], cwd: HERE });
  fs.unlinkSync(raw);
  const kb = fs.statSync(out).size / 1024;
  log(`  wrote fires.geojson (${kb.toFixed(0)} KB)`);
  if (kb > 8000) throw new Error(`fires.geojson is ${kb.toFixed(0)} KB — too heavy to ship`);
}

function write(name, data) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(data));
  log(`  wrote ${name} (${(fs.statSync(p).size / 1024).toFixed(0)} KB)`);
}

async function main() {
  const started = Date.now();
  const skipRegions = process.argv.includes('--no-regions');
  const skipGeom = process.argv.includes('--no-geometry');

  const rows = await collectRows();
  const agg = aggregate(rows);
  const corr = correction(rows);
  const bs = blackSummer(rows);
  assertAnchors(bs, agg);

  const naiveTotal = Math.round(agg.rawArea);
  const correctedTotal = Math.round(agg.dedupedArea);

  log('\nWriting');
  write('core.json', {
    generated: new Date().toISOString(),
    sourceUrl: 'https://digital.atlas.gov.au/',
    licence: 'CC BY 4.0',
    totals: {
      rawRows: agg.rawRows,
      fires: agg.fires.length,
      naiveArea: naiveTotal,
      correctedArea: correctedTotal,
      overcount: correctedTotal ? naiveTotal / correctedTotal : 0,
      firstSeason: agg.seasons.length ? agg.seasons[0].season : null,
      lastSeason: agg.seasons.length ? agg.seasons[agg.seasons.length - 1].season : null,
      causeKnown: agg.fires.filter((f) => f.cause !== 'unknown').length,
    },
    types: agg.types,
    biggest: agg.biggest,
  });
  write('seasons.json', agg.seasons);
  write('states.json', agg.states);
  write('causes.json', agg.causes);
  write('sizes.json', agg.sizes);
  write('correction.json', {
    worst: corr.worst,
    blackSummer: bs,
    naiveArea: naiveTotal,
    correctedArea: correctedTotal,
  });

  if (!skipGeom) {
    const geo = await collectGeometry(5000);
    write('fires.raw.geojson', geo);
    simplifyFires();
  }
  if (!skipRegions) {
    const regions = await collectRegions();
    write('regions.json', regions);
  }

  log(`\nDone in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min`);
}

main().catch((err) => {
  process.stderr.write(`\nFAILED: ${err.message}\n`);
  process.exit(1);
});
