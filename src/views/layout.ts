// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Pure geometry for the hand-rolled charts, separated from the SVG string
// building so it can be tested by POSITION rather than by eye.
//
// This split exists because area-only assertions pass on visually broken
// layouts: an implementation that stacks every segment at the same origin
// conserves total area perfectly and still renders as garbage. The tests
// alongside this file assert bounds, pairwise overlap and flushness.

export interface Rect { x: number; y: number; w: number; h: number }

export interface StackCell extends Rect {
  rowIndex: number;
  seriesKey: string;
  value: number;
}

export interface StackGeometry {
  cells: StackCell[];
  /** Plot area, excluding axes. */
  plot: Rect;
  /** Column pitch, including any gap. */
  bandWidth: number;
  max: number;
}

export interface StackInput {
  rows: { values: Record<string, number> }[];
  seriesKeys: string[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
}

const DEFAULT_MARGIN = { top: 14, right: 12, bottom: 40, left: 62 };

/**
 * Lay out a stacked column chart.
 *
 * Segments within a column are flush: each one starts exactly where the
 * previous ended, so their heights sum to the column height and no gap or
 * overlap can creep in from independent rounding.
 */
export function stackLayout(input: StackInput): StackGeometry {
  const m = input.margin ?? DEFAULT_MARGIN;
  const plot: Rect = {
    x: m.left,
    y: m.top,
    w: Math.max(0, input.width - m.left - m.right),
    h: Math.max(0, input.height - m.top - m.bottom),
  };

  const totals = input.rows.map((r) => input.seriesKeys
    .reduce((a, k) => a + Math.max(0, r.values[k] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const bandWidth = plot.w / Math.max(1, input.rows.length);
  const gap = bandWidth > 6 ? Math.min(2, bandWidth * 0.12) : 0;
  const barW = Math.max(0.6, bandWidth - gap);

  const cells: StackCell[] = [];
  input.rows.forEach((row, i) => {
    const x = plot.x + i * bandWidth + gap / 2;
    // `acc` walks up the column in DATA units and each segment's edges are
    // derived from it, so consecutive segments share an exact edge.
    let acc = 0;
    for (const key of input.seriesKeys) {
      const v = Math.max(0, row.values[key] ?? 0);
      if (v <= 0) continue;
      const yTop = plot.y + plot.h - ((acc + v) / max) * plot.h;
      const yBottom = plot.y + plot.h - (acc / max) * plot.h;
      cells.push({
        x, y: yTop, w: barW, h: yBottom - yTop, rowIndex: i, seriesKey: key, value: v,
      });
      acc += v;
    }
  });

  return { cells, plot, bandWidth, max };
}

export interface HistoBar extends Rect { index: number; count: number }

/**
 * Log-height histogram bars. Counts span orders of magnitude, so a linear
 * height axis would render every bucket but the largest as a flat line.
 */
export function histogramLayout(
  counts: number[],
  width: number,
  height: number,
  margin = { top: 16, right: 16, bottom: 46, left: 62 },
): { bars: HistoBar[]; plot: Rect; maxLog: number } {
  const plot: Rect = {
    x: margin.left,
    y: margin.top,
    w: Math.max(0, width - margin.left - margin.right),
    h: Math.max(0, height - margin.top - margin.bottom),
  };
  const maxLog = Math.log10(Math.max(10, ...counts) + 1);
  const band = plot.w / Math.max(1, counts.length);
  const bars = counts.map((c, i) => {
    const h = c > 0 ? (Math.log10(c + 1) / maxLog) * plot.h : 0;
    return {
      index: i,
      count: c,
      x: plot.x + i * band + band * 0.14,
      y: plot.y + plot.h - h,
      w: band * 0.72,
      h,
    };
  });
  return { bars, plot, maxLog };
}

/** Proportional segment widths for a 100%-stacked row, in percent. */
export function proportionLayout(values: number[]): number[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 0);
  return values.map((v) => (Math.max(0, v) / total) * 100);
}
