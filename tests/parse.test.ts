// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The pipeline's transforms are imported straight from pipeline/parse.mjs so
// the thing under test is the thing that actually runs. That file is
// deliberately dependency-free — importing a module with a stray dependency
// here is the classic way a suite passes locally and fails on CI.

import { describe, expect, it } from 'vitest';
import {
  cleanState, cleanType, cleanCause, seasonOf, seasonLabel, dedupeKey, dedupe,
  belongsToHistoric, STITCH_CUTOVER_MS, sizeBin, SIZE_BINS, slug, titleCase,
  STATE_AREA_KM2, STATES, ANCHORS,
  // @ts-expect-error — plain .mjs with no type declarations, intentionally.
} from '../pipeline/parse.mjs';

describe('cleanState', () => {
  it('accepts the historical layer\'s verbose form', () => {
    expect(cleanState('NSW (New South Wales)')).toBe('NSW');
    expect(cleanState('WA (Western Australia)')).toBe('WA');
  });

  it('accepts the near-real-time layer\'s bare code', () => {
    // The two feeds spell states differently. If this ever regresses the live
    // overlay silently stops matching the historical colours.
    expect(cleanState('NSW')).toBe('NSW');
    expect(cleanState('nsw')).toBe('NSW');
  });

  it('accepts a full state name', () => {
    expect(cleanState('Victoria')).toBe('VIC');
    expect(cleanState('Northern Territory')).toBe('NT');
  });

  it('returns null rather than inventing a state', () => {
    expect(cleanState(null)).toBeNull();
    expect(cleanState('')).toBeNull();
    expect(cleanState('Neverland')).toBeNull();
  });
});

describe('cleanType', () => {
  it('separates prescribed burning from bushfire', () => {
    expect(cleanType('Prescribed Burn')).toBe('prescribed');
    expect(cleanType('Hazard Reduction')).toBe('prescribed');
    expect(cleanType('Planned burn')).toBe('prescribed');
    expect(cleanType('Bushfire')).toBe('bushfire');
    expect(cleanType('Wildfire')).toBe('bushfire');
  });

  it('treats Victoria\'s "Current Burnt Area" as bushfire ground', () => {
    expect(cleanType('Current Burnt Area')).toBe('bushfire');
  });

  it('falls back to unknown, never to a new category', () => {
    expect(cleanType(null)).toBe('unknown');
    expect(cleanType('')).toBe('unknown');
    expect(cleanType('something else entirely')).toBe('unknown');
  });
});

describe('cleanCause', () => {
  it('collapses the many spellings of "we do not know"', () => {
    for (const v of ['Undetermined', 'NOT DETERMINED', 'Unknown', 'OTHER', '', null]) {
      expect(cleanCause(v)).toBe('unknown');
    }
  });

  it('buckets the causes that matter', () => {
    expect(cleanCause('Lightning')).toBe('lightning');
    expect(cleanCause('Deliberate - arson')).toBe('deliberate');
    expect(cleanCause('Suspicious')).toBe('deliberate');
    expect(cleanCause('Escaped burning off')).toBe('accidental');
    expect(cleanCause('Powerline failure')).toBe('powerline');
  });
});

describe('seasonOf', () => {
  it('bins July to June, so Black Summer stays in one season', () => {
    // September 2019 and January 2020 are the same fire season. Calendar-year
    // binning would split the most important event in the record in half.
    expect(seasonOf(Date.UTC(2019, 8, 15))).toBe(2019);
    expect(seasonOf(Date.UTC(2020, 0, 4))).toBe(2019);
    expect(seasonOf(Date.UTC(2020, 5, 30))).toBe(2019);
  });

  it('rolls over on 1 July', () => {
    expect(seasonOf(Date.UTC(2020, 5, 30))).toBe(2019);
    expect(seasonOf(Date.UTC(2020, 6, 1))).toBe(2020);
  });

  it('returns null for missing dates', () => {
    expect(seasonOf(null)).toBeNull();
    expect(seasonOf(undefined)).toBeNull();
    expect(seasonOf(Number.NaN)).toBeNull();
  });

  it('labels a season across the year boundary', () => {
    expect(seasonLabel(2019)).toBe('2019–20');
    expect(seasonLabel(1999)).toBe('1999–00');
    expect(seasonLabel(2009)).toBe('2009–10');
  });
});

describe('dedupeKey', () => {
  const row = {
    state: 'WA', fire_id: 'BF 2019 ESP 013', ignition_date: 1_570_000_000_000,
    area_ha: 162367, perim_km: 1290,
  };

  it('gives every part of one multi-part fire the same key', () => {
    expect(dedupeKey(row, 0)).toBe(dedupeKey({ ...row }, 7));
  });

  it('separates fires that differ in any component', () => {
    expect(dedupeKey(row, 0)).not.toBe(dedupeKey({ ...row, area_ha: 162368 }, 1));
    expect(dedupeKey(row, 0)).not.toBe(dedupeKey({ ...row, state: 'SA' }, 1));
    expect(dedupeKey(row, 0)).not.toBe(dedupeKey({ ...row, ignition_date: 1 }, 1));
  });

  it('DOES merge id-less rows that are identical on everything else', () => {
    // This test previously asserted the opposite, and that was a real shipped
    // bug. Six South Australian rows carrying fire_id '0', the same date, the
    // same 5,763,897 ha and the same 7,118 km perimeter were kept as six
    // separate fires — 34.6 Mha of phantom area, which manufactured a "largest
    // season on record" that never happened.
    //
    // Two distinct fires sharing an area to the hectare AND a perimeter AND a
    // date is not credible. The same multi-part record is.
    const anon = { ...row, fire_id: null };
    expect(dedupeKey(anon, 0)).toBe(dedupeKey(anon, 1));
    const zero = { ...row, fire_id: '0' };
    expect(dedupeKey(zero, 0)).toBe(dedupeKey(zero, 1));
  });

  it('reproduces the South Australian case that caused the bug', () => {
    const sa = {
      state: 'SA', fire_id: '0', ignition_date: 347068800000,
      area_ha: 5763897, perim_km: 7118,
    };
    const keys = new Set([0, 1, 2, 3, 4, 5].map((i) => dedupeKey(sa, i)));
    expect(keys.size).toBe(1);
  });

  it('still refuses to merge id-less rows with no area', () => {
    // Zero-area rows cannot double-count area, and collapsing every 0 ha record
    // in one state on one date would destroy fire COUNTS for no benefit.
    const empty = { ...row, fire_id: null, area_ha: 0 };
    expect(dedupeKey(empty, 0)).not.toBe(dedupeKey(empty, 1));
  });

  it('keeps id-less rows apart when their area or perimeter differs', () => {
    const a = { ...row, fire_id: null };
    expect(dedupeKey(a, 0)).not.toBe(dedupeKey({ ...a, area_ha: 162368 }, 1));
    expect(dedupeKey(a, 0)).not.toBe(dedupeKey({ ...a, perim_km: 1291 }, 1));
    expect(dedupeKey(a, 0)).not.toBe(dedupeKey({ ...a, state: 'SA' }, 1));
  });
});

describe('dedupe', () => {
  it('collapses a 23-part fire to one and stops multiplying its area', () => {
    const parts = Array.from({ length: 23 }, () => ({
      state: 'WA', fire_id: 'BF 2019 ESP 013', ignition_date: 1_570_000_000_000,
      area_ha: 162367, perim_km: 1290,
    }));
    const r = dedupe(parts);
    expect(r.fires).toHaveLength(1);
    expect(r.rawRows).toBe(23);
    expect(r.rawArea).toBe(162367 * 23);
    expect(r.dedupedArea).toBe(162367);
    // The phantom area a naive sum would add.
    expect(r.rawArea - r.dedupedArea).toBe(162367 * 22);
  });

  it('keeps genuinely distinct fires', () => {
    const rows = [
      { state: 'NSW', fire_id: 'A', ignition_date: 1, area_ha: 10, perim_km: 2 },
      { state: 'NSW', fire_id: 'B', ignition_date: 1, area_ha: 20, perim_km: 3 },
      { state: 'VIC', fire_id: 'A', ignition_date: 1, area_ha: 10, perim_km: 2 },
    ];
    const r = dedupe(rows);
    expect(r.fires).toHaveLength(3);
    expect(r.dedupedArea).toBe(40);
  });

  it('handles an empty input', () => {
    const r = dedupe([]);
    expect(r.fires).toHaveLength(0);
    expect(r.rawArea).toBe(0);
    expect(r.dedupedArea).toBe(0);
  });

  it('treats a missing area as zero rather than NaN', () => {
    const r = dedupe([{ state: 'SA', fire_id: 'X', ignition_date: 1, area_ha: null, perim_km: null }]);
    expect(r.dedupedArea).toBe(0);
    expect(Number.isNaN(r.dedupedArea)).toBe(false);
  });

  it('never returns more fires than rows', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      state: 'QLD', fire_id: i % 5 === 0 ? null : `F${i % 7}`,
      ignition_date: 1000 + (i % 7), area_ha: (i % 7) * 11, perim_km: i % 3,
    }));
    const r = dedupe(rows);
    expect(r.fires.length).toBeLessThanOrEqual(r.rawRows);
    expect(r.dedupedArea).toBeLessThanOrEqual(r.rawArea);
  });
});

describe('layer stitching', () => {
  it('cuts over at the 2020-21 season boundary', () => {
    // The historic layer runs to Oct 2023 and the 2020-25 layer starts Jul
    // 2020: they hold the SAME fires for three seasons. Unioning them
    // double-counts, so everything at or after the cutover must come from the
    // newer layer only.
    expect(STITCH_CUTOVER_MS).toBe(Date.UTC(2020, 6, 1));
    expect(belongsToHistoric(Date.UTC(2020, 5, 30))).toBe(true);
    expect(belongsToHistoric(Date.UTC(2020, 6, 1))).toBe(false);
    expect(belongsToHistoric(Date.UTC(2022, 0, 1))).toBe(false);
  });

  it('excludes undated rows from the historic side', () => {
    expect(belongsToHistoric(null)).toBe(false);
    expect(belongsToHistoric(Number.NaN)).toBe(false);
  });
});

describe('sizeBin', () => {
  it('places values in the expected log bucket', () => {
    expect(SIZE_BINS[sizeBin(0.4)].label).toBe('<1 ha');
    expect(SIZE_BINS[sizeBin(1)].label).toBe('1–10 ha');
    expect(SIZE_BINS[sizeBin(9.9)].label).toBe('1–10 ha');
    expect(SIZE_BINS[sizeBin(150)].label).toBe('100–1k ha');
    expect(SIZE_BINS[sizeBin(162367)].label).toBe('100k+ ha');
  });

  it('is total — every value lands in exactly one bin', () => {
    for (const v of [0, 0.001, 1, 10, 100, 1e3, 1e4, 1e5, 1e9]) {
      const i = sizeBin(v);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(SIZE_BINS.length);
    }
    expect(sizeBin(null)).toBe(0);
    expect(sizeBin(Number.NaN)).toBe(0);
  });
});

describe('slug and titleCase', () => {
  it('makes a hash-safe slug', () => {
    expect(slug('Blue Mountains')).toBe('blue-mountains');
    expect(slug('Anangu Pitjantjatjara Yankunytjatjara')).toBe('anangu-pitjantjatjara-yankunytjatjara');
    expect(slug('Wyndham-East Kimberley')).toBe('wyndham-east-kimberley');
    expect(slug(null)).toBe('');
  });

  it('title-cases without mangling state acronyms', () => {
    expect(titleCase('GOSPERS MOUNTAIN')).toBe('Gospers Mountain');
    expect(titleCase('nsw rfs burn')).toBe('NSW RFS Burn');
  });
});

describe('reference tables', () => {
  it('has a land area for every state', () => {
    for (const s of STATES) {
      expect(STATE_AREA_KM2[s]).toBeGreaterThan(0);
    }
    // Sums to roughly Australia's 7.69 million km².
    const total = STATES.reduce((a: number, s: string) => a + STATE_AREA_KM2[s], 0);
    expect(total).toBeGreaterThan(7.6e6);
    expect(total).toBeLessThan(7.8e6);
  });

  it('states the published anchors the build is held to', () => {
    expect(ANCHORS.nswBlackSummerHa.min).toBeLessThan(5.5e6);
    expect(ANCHORS.nswBlackSummerHa.max).toBeGreaterThan(5.5e6);
    expect(ANCHORS.minOvercountRatio).toBeGreaterThan(1);
  });
});
