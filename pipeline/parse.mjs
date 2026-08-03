// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Pure, dependency-free transforms shared by the collector and the test suite.
//
// This file must never import anything outside node: builtins — the Vitest run
// on CI imports it directly, and a stray dependency here is the classic way a
// pipeline passes locally and fails only on the runner.

/** The eight ASGS state/territory codes, in the order the site displays them. */
export const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

export const STATE_LABEL = {
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  WA: 'Western Australia',
  SA: 'South Australia',
  TAS: 'Tasmania',
  ACT: 'Australian Capital Territory',
  NT: 'Northern Territory',
};

/** Land area in km², ABS. Used to normalise record counts in the Coverage view. */
export const STATE_AREA_KM2 = {
  NSW: 800642, VIC: 227416, QLD: 1729742, WA: 2526786,
  SA: 983482, TAS: 68401, ACT: 2358, NT: 1347791,
};

/**
 * The two source layers spell states differently: the historical layer uses
 * "NSW (New South Wales)", the near-real-time layer uses a bare "NSW". Join
 * them without normalising and the live overlay silently matches nothing.
 */
export function cleanState(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const head = s.split('(')[0].trim().toUpperCase();
  if (STATES.includes(head)) return head;
  const byName = Object.entries(STATE_LABEL)
    .find(([, name]) => name.toUpperCase() === s.toUpperCase());
  return byName ? byName[0] : null;
}

/**
 * Fire type collapses to three buckets. The distinction matters more than it
 * looks: prescribed burns are half of all records but a seventh of the area,
 * and colouring a deliberate hazard-reduction burn as a wildfire would be a
 * factual error, not a styling choice.
 */
export function cleanType(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('prescribed') || s.includes('planned') || s.includes('hazard')) return 'prescribed';
  if (s.includes('bushfire') || s.includes('wildfire') || s.includes('burnt area')) return 'bushfire';
  return 'unknown';
}

export const TYPE_LABEL = {
  bushfire: 'Bushfire',
  prescribed: 'Prescribed burn',
  unknown: 'Unclassified',
};

/**
 * Ignition cause is free text across seven agencies and 124 years, so
 * "Undetermined", "NOT DETERMINED", "Unknown" and "OTHER" all mean the same
 * thing. Raw values stay available in the glossary; only the buckets are
 * charted. Anything not recognised becomes `unknown`, never a new category —
 * 94% of records have no cause at all and a long tail of one-off spellings
 * would swamp the chart.
 */
export function cleanCause(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === 'null' || s === 'n/a') return 'unknown';
  // Specific causes are tested BEFORE the catch-all. The unknown test used to
  // run first, which meant a future compound value like "Other - powerline"
  // would be silently binned as "not recorded" instead of powerline.
  if (/lightning|natural/.test(s)) return 'lightning';
  if (/deliberate|arson|incendiar|malicious|suspicious/.test(s)) return 'deliberate';
  if (/accident|escape|burning off|campfire|cigarett|rubbish|debris|spark/.test(s)) return 'accidental';
  if (/prescribed|planned|hazard reduction|fuel reduction/.test(s)) return 'prescribed';
  if (/machin|equipment|vehicle|exhaust|grind|weld/.test(s)) return 'machinery';
  if (/powerline|electric|transmission|asset/.test(s)) return 'powerline';
  if (/railway|train/.test(s)) return 'railway';
  if (/re-?ignit|reburn|spot/.test(s)) return 'reignition';
  if (/undetermined|not determined|unknown|other|misc/.test(s)) return 'unknown';
  return 'unknown';
}

export const CAUSE_LABEL = {
  lightning: 'Lightning',
  deliberate: 'Deliberate',
  accidental: 'Accidental',
  prescribed: 'Prescribed burning',
  machinery: 'Machinery / equipment',
  powerline: 'Powerline',
  railway: 'Railway',
  reignition: 'Re-ignition',
  unknown: 'Not recorded',
};

/** Causes shown in the matrix, in a fixed order so colours never shift. */
export const CAUSE_ORDER = [
  'lightning', 'deliberate', 'accidental', 'prescribed',
  'machinery', 'powerline', 'railway', 'reignition', 'unknown',
];

/**
 * Southern Australia's fire season straddles the new year — Black Summer ran
 * from September 2019 into February 2020. Binning by calendar year splits it
 * in half and destroys the single most important event in the record, so
 * July–June is the default everywhere.
 *
 * Returns the starting calendar year: 2019 means the 2019-20 season.
 */
export function seasonOf(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (!Number.isFinite(y)) return null;
  return d.getUTCMonth() >= 6 ? y : y - 1;
}

export function seasonLabel(y) {
  return `${y}–${String((y + 1) % 100).padStart(2, '0')}`;
}

/**
 * The dedupe key, and the single most important function in this repo.
 *
 * A fire made of several disjoint polygons is stored as one ROW PER POLYGON,
 * and every one of those rows repeats the parent fire's full `area_ha` and
 * `perim_km`. Summing the column therefore multiplies large fires by their
 * part count: WA's `BF 2019 ESP 013` (162,367 ha) appears 23 times and inflates
 * the national total by 3.57 Mha on its own. Naive 2019-20 = 31.8 Mha;
 * corrected = 16.5 Mha.
 *
 * `fire_id` alone is NOT a key — there are nulls, literal '0's, and one SA
 * value covering thousands of rows across unrelated fires.
 *
 * Rows with no usable fire_id are never merged: we cannot prove two anonymous
 * rows are the same fire, and the measured cost of keeping them apart across
 * the 2019-20 season is 46 ha. Under-merging is a rounding error; over-merging
 * would delete real fires.
 *
 * `index` must be unique per row within a harvest (the collector passes the
 * running row ordinal).
 */
export function dedupeKey(row, index) {
  const fid = row.fire_id == null ? '' : String(row.fire_id).trim();
  const area = Number(row.area_ha) || 0;
  const base = [row.state ?? '', row.ignition_date ?? '', area, row.perim_km ?? ''];

  if (fid && fid !== '0') return ['id', fid, ...base].join('|');

  // Rows with no usable fire_id STILL have to be de-duplicated on the rest of
  // the tuple. Refusing to merge them at all was a real bug that shipped: six
  // South Australian rows (OBJECTID 310689-310694) are byte-identical on state,
  // ignition date, area (5,763,897 ha) and perimeter (7,118 km), and keeping all
  // six contributed 34.6 Mha of phantom area - 93.6% of what this site briefly
  // reported as the largest fire season on record.
  //
  // The original rule was validated only against the 2019-20 season, where it
  // cost 46 ha. That season has almost no id-less duplicates, so the test was
  // simply not representative of the archive.
  //
  // Two distinct fires sharing an identical area to the hectare AND an identical
  // perimeter AND an identical ignition date is not credible; the same multi-part
  // record is. This applies only where there is an area to double-count:
  // zero-area rows stay unmerged, because collapsing every 0 ha record in one
  // state on one date would destroy fire COUNTS while changing no area at all.
  if (area > 0) return ['anon', ...base].join('|');
  return `#${index}`;
}


/**
 * Collapse raw rows to one record per distinct fire.
 * Returns { fires, rawRows, rawArea, dedupedArea } so callers can show the
 * correction rather than quietly applying it.
 */
export function dedupe(rows) {
  const seen = new Set();
  const fires = [];
  let rawArea = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    rawArea += Number(r.area_ha) || 0;
    const k = dedupeKey(r, i);
    if (seen.has(k)) continue;
    seen.add(k);
    fires.push(r);
  }
  return {
    fires,
    rawRows: rows.length,
    rawArea,
    dedupedArea: fires.reduce((a, r) => a + (Number(r.area_ha) || 0), 0),
  };
}

/**
 * The historic layer runs to 2023-10-15 and the 2020-25 layer starts
 * 2020-07-01, so they overlap for three whole seasons and contain the SAME
 * fires (VIC 2021-22: 2,046 rows in one, 2,066 in the other). Unioning them
 * double-counts. The cutover is the 2020-21 season boundary: the historic
 * layer supplies everything before it, the newer layer everything after.
 */
export const STITCH_CUTOVER_MS = Date.UTC(2020, 6, 1);

export function belongsToHistoric(ms) {
  return ms != null && Number.isFinite(ms) && ms < STITCH_CUTOVER_MS;
}

/**
 * Log-spaced size buckets. Fire area spans from under a hectare to over
 * 200,000 ha; linear bins put 99% of fires in the first bar and a quantile
 * scale would paint a 1 ha grass fire the same colour as a megafire.
 */
export const SIZE_BINS = [
  { min: 0, max: 1, label: '<1 ha' },
  { min: 1, max: 10, label: '1–10 ha' },
  { min: 10, max: 100, label: '10–100 ha' },
  { min: 100, max: 1e3, label: '100–1k ha' },
  { min: 1e3, max: 1e4, label: '1k–10k ha' },
  { min: 1e4, max: 1e5, label: '10k–100k ha' },
  { min: 1e5, max: Infinity, label: '100k+ ha' },
];

export function sizeBin(ha) {
  const v = Number(ha) || 0;
  for (let i = 0; i < SIZE_BINS.length; i += 1) {
    if (v >= SIZE_BINS[i].min && v < SIZE_BINS[i].max) return i;
  }
  return SIZE_BINS.length - 1;
}

/** URL-safe slug that survives a location hash. */
export function slug(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Title-case a shouty agency or fire name without mangling acronyms. */
export function titleCase(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Nsw|Act|Nt|Wa|Sa|Qld|Vic|Tas|Rfs|Cfa|Dbca|Pws)\b/g, (m) => m.toUpperCase());
}

/**
 * A fire name, or null when there isn't one.
 *
 * The source uses whitespace-only strings as well as nulls for unnamed fires.
 * A " " is TRUTHY, so it sails past every `name ? name : '—'` fallback and
 * renders as an empty table cell that looks like a rendering bug rather than
 * missing data. Normalise it away here, once, at the source.
 */
export function cleanName(s) {
  const t = String(s ?? '').trim();
  return t ? titleCase(t) : null;
}

/**
 * The published anchors this build is checked against. If a parser change
 * breaks the dedupe, these fail loudly instead of the headline number
 * silently doubling.
 */
export const ANCHORS = {
  // NSW 2019-20 ("Black Summer"). Published figure ~5.5 million hectares.
  nswBlackSummerHa: { min: 5.30e6, max: 5.65e6, published: 5.5e6 },
  // The ACT's Orroral Valley fire, published at ~87,000 ha.
  orroralHa: { min: 84e3, max: 92e3, published: 87e3 },
  // The naive sum must still be at least this many times the corrected one.
  minOvercountRatio: 1.9,
};
