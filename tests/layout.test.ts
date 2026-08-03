// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Position-asserting tests for the hand-rolled chart layouts.
//
// WHY POSITIONS AND NOT AREAS: an area-only test passes on visually broken
// layouts. A stacked chart that draws every segment at the same origin
// conserves total area perfectly and renders as garbage — au-gov shipped
// exactly that with green CI. Bounds, pairwise overlap and flushness are what
// catch it, so those are what is asserted here.

import { describe, expect, it } from 'vitest';
import {
  stackLayout, histogramLayout, proportionLayout, type Rect,
} from '../src/views/layout';

const EPS = 1e-6;

function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

/** Deterministic pseudo-random — never Math.random() in a test. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SERIES = ['NSW', 'VIC', 'QLD', 'WA'];

function makeRows(n: number, seed = 42) {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () => ({
    values: Object.fromEntries(SERIES.map((k) => [k, Math.floor(rnd() * 10000)])),
  }));
}

describe('stackLayout', () => {
  const W = 1000;
  const H = 380;

  it('keeps every cell inside the plot area', () => {
    const { cells, plot } = stackLayout({ rows: makeRows(40), seriesKeys: SERIES, width: W, height: H });
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(plot.x - EPS);
      expect(c.x + c.w).toBeLessThanOrEqual(plot.x + plot.w + EPS);
      expect(c.y).toBeGreaterThanOrEqual(plot.y - EPS);
      expect(c.y + c.h).toBeLessThanOrEqual(plot.y + plot.h + EPS);
    }
  });

  it('produces no NaN or negative geometry', () => {
    const { cells } = stackLayout({ rows: makeRows(60, 7), seriesKeys: SERIES, width: W, height: H });
    for (const c of cells) {
      for (const v of [c.x, c.y, c.w, c.h]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(c.w).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThanOrEqual(0);
    }
  });

  it('never overlaps two cells', () => {
    // The failure this exists to catch: segments stacked at a common origin.
    const { cells } = stackLayout({ rows: makeRows(25, 9), seriesKeys: SERIES, width: W, height: H });
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        expect(overlapArea(cells[i], cells[j])).toBeLessThan(0.5);
      }
    }
  });

  it('stacks segments flush — each starts where the last ended', () => {
    const rows = makeRows(12, 3);
    const { cells } = stackLayout({ rows, seriesKeys: SERIES, width: W, height: H });
    for (let i = 0; i < rows.length; i += 1) {
      const col = cells.filter((c) => c.rowIndex === i).sort((a, b) => b.y - a.y);
      for (let k = 1; k < col.length; k += 1) {
        // Sorted bottom-up: this segment's top must equal the next one's bottom.
        expect(Math.abs(col[k].y + col[k].h - col[k - 1].y)).toBeLessThan(0.01);
      }
    }
  });

  it('gives each column a height proportional to its total', () => {
    const rows = [
      { values: { NSW: 100, VIC: 0, QLD: 0, WA: 0 } },
      { values: { NSW: 50, VIC: 0, QLD: 0, WA: 0 } },
      { values: { NSW: 200, VIC: 0, QLD: 0, WA: 0 } },
    ];
    const { cells, plot } = stackLayout({ rows, seriesKeys: SERIES, width: W, height: H });
    const h = (i: number) => cells.filter((c) => c.rowIndex === i).reduce((a, c) => a + c.h, 0);
    expect(h(2)).toBeCloseTo(plot.h, 5);
    expect(h(0) / h(2)).toBeCloseTo(0.5, 5);
    expect(h(1) / h(2)).toBeCloseTo(0.25, 5);
  });

  it('lays columns out left to right in row order', () => {
    const { cells } = stackLayout({ rows: makeRows(20, 11), seriesKeys: SERIES, width: W, height: H });
    const firstX = new Map<number, number>();
    for (const c of cells) if (!firstX.has(c.rowIndex)) firstX.set(c.rowIndex, c.x);
    const xs = [...firstX.entries()].sort((a, b) => a[0] - b[0]).map(([, x]) => x);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it('survives 127 columns without collapsing bar width', () => {
    // The real season chart has one column per year since 1899.
    const { cells } = stackLayout({ rows: makeRows(127, 5), seriesKeys: SERIES, width: 360, height: H });
    for (const c of cells) expect(c.w).toBeGreaterThanOrEqual(0.6);
  });

  it('handles degenerate inputs', () => {
    expect(stackLayout({ rows: [], seriesKeys: SERIES, width: W, height: H }).cells).toHaveLength(0);
    const zero = stackLayout({
      rows: [{ values: { NSW: 0, VIC: 0, QLD: 0, WA: 0 } }], seriesKeys: SERIES, width: W, height: H,
    });
    expect(zero.cells).toHaveLength(0);
    const one = stackLayout({ rows: [{ values: { NSW: 5 } }], seriesKeys: ['NSW'], width: W, height: H });
    expect(one.cells).toHaveLength(1);
    expect(one.cells[0].h).toBeCloseTo(one.plot.h, 5);
  });

  it('ignores negative values rather than drawing upside-down bars', () => {
    const { cells } = stackLayout({
      rows: [{ values: { NSW: -50, VIC: 100 } }], seriesKeys: ['NSW', 'VIC'], width: W, height: H,
    });
    expect(cells).toHaveLength(1);
    expect(cells[0].seriesKey).toBe('VIC');
    expect(cells[0].h).toBeGreaterThan(0);
  });
});

describe('histogramLayout', () => {
  const W = 940;
  const H = 340;

  it('keeps bars in bounds with no NaN', () => {
    const { bars, plot } = histogramLayout([13820, 40166, 63808, 47977, 17664, 3715, 535], W, H);
    for (const b of bars) {
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      expect(Number.isFinite(b.w) && Number.isFinite(b.h)).toBe(true);
      expect(b.x).toBeGreaterThanOrEqual(plot.x - EPS);
      expect(b.x + b.w).toBeLessThanOrEqual(plot.x + plot.w + EPS);
      expect(b.y).toBeGreaterThanOrEqual(plot.y - EPS);
      expect(b.y + b.h).toBeLessThanOrEqual(plot.y + plot.h + EPS);
    }
  });

  it('never overlaps adjacent bars', () => {
    const { bars } = histogramLayout([1, 20, 300, 4000, 50000], W, H);
    for (let i = 1; i < bars.length; i += 1) {
      expect(bars[i].x).toBeGreaterThanOrEqual(bars[i - 1].x + bars[i - 1].w - EPS);
      expect(overlapArea(bars[i], bars[i - 1])).toBeLessThan(0.5);
    }
  });

  it('orders bar heights the same way as the counts', () => {
    // A log axis must still be monotonic — a taller bar always means more.
    const counts = [535, 3715, 17664, 63808];
    const { bars } = histogramLayout(counts, W, H);
    for (let i = 1; i < bars.length; i += 1) {
      expect(bars[i].h).toBeGreaterThan(bars[i - 1].h);
    }
  });

  it('gives a zero count zero height, not a negative one', () => {
    const { bars } = histogramLayout([0, 100], W, H);
    expect(bars[0].h).toBe(0);
    expect(bars[1].h).toBeGreaterThan(0);
  });

  it('handles an empty input', () => {
    const { bars } = histogramLayout([], W, H);
    expect(bars).toHaveLength(0);
  });
});

describe('proportionLayout', () => {
  it('sums to 100 percent', () => {
    const p = proportionLayout([54564, 83621, 49500]);
    expect(p.reduce((a, v) => a + v, 0)).toBeCloseTo(100, 6);
  });

  it('returns all zeroes rather than NaN for an all-zero row', () => {
    const p = proportionLayout([0, 0, 0]);
    expect(p).toEqual([0, 0, 0]);
    for (const v of p) expect(Number.isNaN(v)).toBe(false);
  });

  it('clamps negatives to zero', () => {
    const p = proportionLayout([-10, 100]);
    expect(p[0]).toBe(0);
    expect(p[1]).toBeCloseTo(100, 6);
  });
});
