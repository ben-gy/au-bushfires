// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Gates on the SHIPPED data files, not on the collector.
//
// The collector asserts its own anchors at harvest time, but the files in
// public/data are what the site actually serves and they are committed to the
// repo. If a bad harvest were ever committed, or a file truncated, only a test
// that reads the artefacts would catch it. These run on every CI build.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const core = read('core.json');
const seasons = read('seasons.json');
const states = read('states.json');
const causes = read('causes.json');
const sizes = read('sizes.json');
const correction = read('correction.json');
const regions = read('regions.json');

describe('published anchors', () => {
  it('reproduces NSW 2019-20 at the published ~5.5 million hectares', () => {
    // The single most important number on the site. If the dedupe regresses,
    // this roughly doubles and the test fails loudly instead of the headline
    // quietly becoming wrong.
    const nsw = correction.blackSummer.table.find((r: { state: string }) => r.state === 'NSW');
    expect(nsw).toBeDefined();
    expect(nsw.corrected).toBeGreaterThan(5.30e6);
    expect(nsw.corrected).toBeLessThan(5.65e6);
  });

  it('reproduces the ACT\'s Orroral Valley fire at the published ~87,000 ha', () => {
    expect(correction.blackSummer.orroral).toBeTruthy();
    expect(correction.blackSummer.orroral.area).toBeGreaterThan(84_000);
    expect(correction.blackSummer.orroral.area).toBeLessThan(92_000);
  });

  it('still shows the naive sum overstating the season by at least 1.9x', () => {
    const { naive, corrected } = correction.blackSummer;
    expect(naive / corrected).toBeGreaterThan(1.9);
  });
});

describe('core totals', () => {
  it('is internally consistent', () => {
    const t = core.totals;
    expect(t.fires).toBeGreaterThan(150_000);
    expect(t.rawRows).toBeGreaterThan(t.fires);
    expect(t.correctedArea).toBeLessThan(t.naiveArea);
    expect(t.overcount).toBeCloseTo(t.naiveArea / t.correctedArea, 5);
    expect(t.causeKnown).toBeLessThanOrEqual(t.fires);
  });

  it('covers the full span of the archive', () => {
    expect(core.totals.firstSeason).toBeLessThanOrEqual(1900);
    expect(core.totals.lastSeason).toBeGreaterThanOrEqual(2024);
  });

  it('reports a cause for only a small minority of fires', () => {
    // Every cause chart is captioned on this being true. If a future release
    // improves coverage dramatically, the copy needs revisiting — so assert it.
    const share = core.totals.causeKnown / core.totals.fires;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.35);
  });

  it('never presents a cumulative total larger than is physically explicable', () => {
    // Cumulative area legitimately exceeds Australia's 769 Mha because ground
    // burns repeatedly, but more than ~3x the continent would mean the dedupe
    // has failed somewhere upstream.
    expect(core.totals.correctedArea).toBeLessThan(769e6 * 3);
  });
});

describe('seasons', () => {
  it('is sorted, unique and free of impossible years', () => {
    const years = seasons.map((s: { season: number }) => s.season);
    expect(new Set(years).size).toBe(years.length);
    expect([...years].sort((a: number, b: number) => a - b)).toEqual(years);
    for (const y of years) {
      expect(y).toBeGreaterThanOrEqual(1899);
      expect(y).toBeLessThanOrEqual(2030);
    }
  });

  it('has no NaN or negative areas', () => {
    for (const s of seasons) {
      expect(Number.isFinite(s.total)).toBe(true);
      expect(s.total).toBeGreaterThanOrEqual(0);
      expect(s.fires).toBeGreaterThan(0);
    }
  });

  it('keeps Black Summer in one season rather than splitting it', () => {
    const bs = seasons.find((s: { season: number }) => s.season === 2019);
    expect(bs).toBeDefined();
    expect(bs.total).toBeGreaterThan(15e6);
    expect(bs.byState.NSW).toBeGreaterThan(5e6);
  });

  it('has at least one season larger than Black Summer', () => {
    // The site's headline finding. If this ever stops being true the Overview
    // copy is wrong, and the finding is generated from the data so it would
    // silently disappear — assert the claim itself.
    const bs = seasons.find((s: { season: number }) => s.season === 2019).total;
    const bigger = seasons.filter((s: { total: number }) => s.total > bs);
    expect(bigger.length).toBeGreaterThan(0);
  });
});

describe('states', () => {
  it('covers all eight and nothing else', () => {
    expect(states).toHaveLength(8);
    expect(states.map((s: { code: string }) => s.code).sort())
      .toEqual(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']);
  });

  it('records the Northern Territory gap rather than hiding it', () => {
    // The NT is absent from the national historical layer for its whole run.
    // The site draws that as an explicit band; if the data ever gains earlier
    // NT records the copy must change, so pin the current state of the world.
    const nt = states.find((s: { code: string }) => s.code === 'NT');
    expect(nt.firstSeason).toBeGreaterThan(2000);
  });

  it('has type counts that sum to the state total', () => {
    for (const s of states) {
      const sum = s.byType.bushfire + s.byType.prescribed + s.byType.unknown;
      expect(sum).toBe(s.fires);
    }
  });
});

describe('causes and sizes', () => {
  it('has cause counts that never exceed the national fire count', () => {
    const total = causes.reduce((a: number, c: { fires: number }) => a + c.fires, 0);
    expect(total).toBe(core.totals.fires);
  });

  it('keeps mean area consistent with total and count', () => {
    for (const c of causes) {
      if (!c.fires) continue;
      expect(c.meanArea).toBe(Math.round(c.area / c.fires));
    }
  });

  it('carries real per-state area, not a figure derived from a national mean', () => {
    for (const c of causes) {
      expect(c.areaByState).toBeDefined();
      const sum = Object.values(c.areaByState as Record<string, number>)
        .reduce((a: number, v: number) => a + v, 0);
      // Rounding per state means the sum can drift a few hectares from the
      // national figure, but never more than one unit per state.
      expect(Math.abs(sum - c.area)).toBeLessThanOrEqual(8);
    }
  });

  it('has size buckets that partition every fire exactly once', () => {
    const total = sizes.reduce((a: number, s: { fires: number }) => a + s.fires, 0);
    expect(total).toBe(core.totals.fires);
  });

  it('shows the largest fires carrying most of the burnt area', () => {
    const biggest = sizes[sizes.length - 1];
    expect(biggest.fires / core.totals.fires).toBeLessThan(0.02);
    expect(biggest.area / core.totals.correctedArea).toBeGreaterThan(0.25);
  });
});

describe('regions', () => {
  it('covers every Australian council area with unique slugs', () => {
    expect(regions.length).toBeGreaterThan(500);
    const slugs = regions.map((r: { slug: string }) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('resolves a known council to its known megafire', () => {
    // An external sanity check: the Blue Mountains' largest fire really was
    // Gospers Mountain in 2019-20.
    const bm = regions.find((r: { slug: string }) => r.slug === 'blue-mountains');
    expect(bm).toBeDefined();
    expect(bm.biggest.name).toMatch(/Gospers/i);
    expect(bm.biggest.season).toBe(2019);
    expect(bm.state).toBe('NSW');
  });

  it('never claims more bushfires plus prescribed burns than fires', () => {
    for (const r of regions) {
      expect(r.bushfires + r.prescribed).toBeLessThanOrEqual(r.fires);
      expect(r.fires).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(r.area)).toBe(true);
    }
  });

  it('has seasons maps consistent with the recorded first and last season', () => {
    for (const r of regions) {
      const yrs = Object.keys(r.seasons).map(Number);
      if (!yrs.length) {
        expect(r.fires).toBe(0);
        continue;
      }
      expect(Math.min(...yrs)).toBe(r.firstSeason);
      expect(Math.max(...yrs)).toBe(r.lastSeason);
    }
  });
});

describe('correction detail', () => {
  it('lists duplicates whose copies genuinely inflate the total', () => {
    expect(correction.worst.length).toBeGreaterThan(0);
    for (const w of correction.worst) {
      expect(w.copies).toBeGreaterThan(1);
      expect(w.inflation).toBe(Math.round((w.copies - 1) * w.area));
    }
  });

  it('has a Black Summer table where corrected never exceeds naive', () => {
    for (const r of correction.blackSummer.table) {
      expect(r.corrected).toBeLessThanOrEqual(r.naive + 1);
      expect(r.fires).toBeLessThanOrEqual(r.rows);
    }
  });
});
