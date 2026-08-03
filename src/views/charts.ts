// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Hand-rolled SVG chart primitives. No chart library: every chart here needs
// custom hover targets, semantic colour and click-to-filter, which is most of
// what a library would have provided anyway.

import { esc, tipAttr } from '../format';
import { linear, ticks, svgOpen } from './ui';
import { stackLayout, histogramLayout } from './layout';

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

export interface StackRow {
  /** Category label along the x axis. */
  label: string;
  /** Machine key used for click handlers. */
  key: string;
  values: Record<string, number>;
  /** Tooltip lines appended after the per-series breakdown. */
  note?: string;
}

export interface StackOpts {
  rows: StackRow[];
  series: StackSeries[];
  width?: number;
  height?: number;
  yLabel: string;
  format: (n: number) => string;
  /** Draw a vertical band behind these row keys, e.g. a data gap. */
  bands?: { from: string; to: string; label: string }[];
  /** Annotate specific rows with a callout label. */
  marks?: { key: string; label: string }[];
  clickable?: boolean;
}

/**
 * Stacked column chart. Used for the 124-season timeline, so it has to cope
 * with ~127 columns on a phone: the bars stay flush (no per-bar gap below a
 * threshold) rather than degenerating into invisible slivers.
 */
export function stackedColumns(o: StackOpts): string {
  const W = o.width ?? 1000;
  const H = o.height ?? 380;
  const M = { top: 14, right: 12, bottom: 40, left: 62 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const totals = o.rows.map((r) => o.series.reduce((a, s) => a + (r.values[s.key] ?? 0), 0));

  // Geometry comes from the tested pure layout, so what the positional tests
  // assert is exactly what renders here.
  const geo = stackLayout({
    rows: o.rows,
    seriesKeys: o.series.map((s) => s.key),
    width: W,
    height: H,
    margin: M,
  });
  const max = geo.max;
  const y = linear(0, max, ih, 0);
  const bw = geo.bandWidth;
  const cellsByRow = new Map<number, typeof geo.cells>();
  for (const c of geo.cells) {
    if (!cellsByRow.has(c.rowIndex)) cellsByRow.set(c.rowIndex, []);
    cellsByRow.get(c.rowIndex)!.push(c);
  }
  const colorOf = new Map(o.series.map((s) => [s.key, s.color]));

  const parts: string[] = [];
  parts.push(svgOpen(W, H, o.yLabel, 'chart-svg'));

  // Bands sit behind everything — they mark absent data, not a value.
  for (const b of o.bands ?? []) {
    const i0 = o.rows.findIndex((r) => r.key === b.from);
    const i1 = o.rows.findIndex((r) => r.key === b.to);
    if (i0 < 0 || i1 < 0) continue;
    const x0 = M.left + i0 * bw;
    const w = (i1 - i0 + 1) * bw;
    parts.push(`<rect x="${x0.toFixed(1)}" y="${M.top}" width="${w.toFixed(1)}" height="${ih}" class="band" data-tip="${tipAttr(b.label)}"></rect>`);
  }

  for (const t of ticks(0, max, 5)) {
    const yy = M.top + y(t);
    parts.push(`<line x1="${M.left}" y1="${yy.toFixed(1)}" x2="${W - M.right}" y2="${yy.toFixed(1)}" class="ax-grid"></line>`);
    parts.push(`<text x="${M.left - 8}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" class="ax-txt">${esc(o.format(t))}</text>`);
  }

  o.rows.forEach((r, i) => {
    const lines = o.series
      .filter((s) => (r.values[s.key] ?? 0) > 0)
      .map((s) => `${s.label}: ${o.format(r.values[s.key] ?? 0)}`);
    const tip = [`${r.label}`, `Total: ${o.format(totals[i])}`, ...lines, r.note ?? '']
      .filter(Boolean).join('\n');
    for (const c of cellsByRow.get(i) ?? []) {
      parts.push(`<rect x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" width="${c.w.toFixed(1)}" height="${Math.max(0.5, c.h).toFixed(1)}" fill="${colorOf.get(c.seriesKey) ?? '#999'}" class="mark${o.clickable ? ' mark-click' : ''}"${o.clickable ? ` data-row="${esc(r.key)}"` : ''}></rect>`);
    }
    // One transparent hit target per column: hovering a 0.6px slice is
    // impossible, and the reader wants the whole column's breakdown anyway.
    parts.push(`<rect x="${(M.left + i * bw).toFixed(1)}" y="${M.top}" width="${bw.toFixed(1)}" height="${ih}" fill="transparent" class="hit${o.clickable ? ' mark-click' : ''}"${o.clickable ? ` data-row="${esc(r.key)}"` : ''} data-tip="${tipAttr(tip)}" aria-label="${esc(`${r.label}: ${o.format(totals[i])}`)}"></rect>`);
  });

  // x labels — thinned so they never collide.
  const every = Math.max(1, Math.ceil(o.rows.length / (iw / 46)));
  o.rows.forEach((r, i) => {
    if (i % every) return;
    const x = M.left + i * bw + bw / 2;
    parts.push(`<text x="${x.toFixed(1)}" y="${(M.top + ih + 15).toFixed(1)}" text-anchor="middle" class="ax-txt">${esc(r.label)}</text>`);
  });

  for (const m of o.marks ?? []) {
    const i = o.rows.findIndex((r) => r.key === m.key);
    if (i < 0) continue;
    const x = M.left + i * bw + bw / 2;
    const yy = M.top + y(totals[i]);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${(yy - 5).toFixed(1)}" x2="${x.toFixed(1)}" y2="${Math.max(M.top, yy - 22).toFixed(1)}" class="callout-line"></line>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${Math.max(M.top + 8, yy - 26).toFixed(1)}" text-anchor="middle" class="callout-txt">${esc(m.label)}</text>`);
  }

  parts.push(`<line x1="${M.left}" y1="${M.top + ih}" x2="${W - M.right}" y2="${M.top + ih}" class="ax-line"></line>`);
  parts.push(`<text x="6" y="${(M.top + ih / 2).toFixed(1)}" class="ax-title" transform="rotate(-90 6 ${(M.top + ih / 2).toFixed(1)})" text-anchor="middle">${esc(o.yLabel)}</text>`);
  parts.push('</svg>');
  return parts.join('');
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  color?: string;
  sub?: string;
  tip?: string;
}

/** Horizontal ranked bars. */
export function barChart(rows: BarRow[], opts: {
  format: (n: number) => string;
  clickable?: boolean;
  maxOverride?: number;
}): string {
  if (!rows.length) return '<p class="empty">No data.</p>';
  const max = Math.max(1, opts.maxOverride ?? Math.max(...rows.map((r) => r.value)));
  return `<div class="bars">${rows.map((r) => `
    <div class="bar-row${opts.clickable ? ' bar-click' : ''}"${opts.clickable ? ` data-row="${esc(r.key)}" tabindex="0" role="button"` : ''} data-tip="${tipAttr(r.tip ?? `${r.label}\n${opts.format(r.value)}`)}">
      <span class="bar-lab">${esc(r.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${((r.value / max) * 100).toFixed(2)}%;background:${r.color ?? 'var(--accent)'}"></span></span>
      <span class="bar-val">${esc(opts.format(r.value))}</span>
      ${r.sub ? `<span class="bar-sub">${esc(r.sub)}</span>` : ''}
    </div>`).join('')}</div>`;
}

export interface MatrixOpts {
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  value: (rowKey: string, colKey: string) => number;
  format: (n: number) => string;
  color: (v: number, max: number) => string;
  rowTotal?: (rowKey: string) => string;
  clickable?: boolean;
}

/** Cross-reference heatmap. Every cell carries a tooltip and an aria-label. */
export function matrix(o: MatrixOpts): string {
  let max = 0;
  for (const r of o.rows) for (const c of o.cols) max = Math.max(max, o.value(r.key, c.key));

  const head = `<tr><th scope="col" class="mx-corner"></th>${o.cols
    .map((c) => `<th scope="col"><span>${esc(c.label)}</span></th>`).join('')}${o.rowTotal ? '<th scope="col" class="mx-total">Total</th>' : ''}</tr>`;

  const body = o.rows.map((r) => `<tr>
    <th scope="row">${esc(r.label)}</th>
    ${o.cols.map((c) => {
    const v = o.value(r.key, c.key);
    const tip = `${r.label} × ${c.label}\n${o.format(v)}`;
    return `<td class="mx-cell${o.clickable && v > 0 ? ' mark-click' : ''}" style="background:${v > 0 ? o.color(v, max) : 'var(--bg-surface)'}"${o.clickable && v > 0 ? ` data-row="${esc(r.key)}" data-col="${esc(c.key)}" tabindex="0"` : ''} data-tip="${tipAttr(tip)}" aria-label="${esc(tip.replace(/\n/g, ', '))}"><span>${v > 0 ? esc(o.format(v)) : '·'}</span></td>`;
  }).join('')}
    ${o.rowTotal ? `<td class="mx-total num">${esc(o.rowTotal(r.key))}</td>` : ''}
  </tr>`).join('');

  return `<div class="mx-wrap"><table class="mx"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/**
 * Log-scale histogram for fire size. Linear bins would put 99% of fires in the
 * first bar; the bins themselves are log-spaced and the bar heights are drawn
 * on a log axis because the counts also span orders of magnitude.
 */
export function logHistogram(rows: { label: string; count: number; area: number }[], opts: {
  width?: number; height?: number; countFormat: (n: number) => string; areaFormat: (n: number) => string;
}): string {
  const W = opts.width ?? 940;
  const H = opts.height ?? 340;
  const M = { top: 16, right: 16, bottom: 46, left: 62 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const geo = histogramLayout(rows.map((r) => r.count), W, H, M);
  const { maxLog } = geo;
  const bw = iw / Math.max(1, rows.length);

  const parts = [svgOpen(W, H, 'Fire size distribution', 'chart-svg')];
  for (let p = 0; p <= Math.ceil(maxLog); p += 1) {
    const yy = M.top + ih - (p / maxLog) * ih;
    parts.push(`<line x1="${M.left}" y1="${yy.toFixed(1)}" x2="${W - M.right}" y2="${yy.toFixed(1)}" class="ax-grid"></line>`);
    parts.push(`<text x="${M.left - 8}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" class="ax-txt">${(10 ** p).toLocaleString('en-AU')}</text>`);
  }
  rows.forEach((r, i) => {
    const b = geo.bars[i];
    const tip = `${r.label}\n${opts.countFormat(r.count)} fires\n${opts.areaFormat(r.area)} burnt in total`;
    parts.push(`<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${Math.max(0, b.h).toFixed(1)}" fill="var(--accent)" class="mark" data-tip="${tipAttr(tip)}" aria-label="${esc(tip.replace(/\n/g, ', '))}"></rect>`);
    parts.push(`<text x="${(b.x + b.w / 2).toFixed(1)}" y="${(b.y - 5).toFixed(1)}" text-anchor="middle" class="bar-cap">${esc(opts.countFormat(r.count))}</text>`);
    parts.push(`<text x="${(M.left + i * bw + bw / 2).toFixed(1)}" y="${(M.top + ih + 16).toFixed(1)}" text-anchor="middle" class="ax-txt">${esc(r.label)}</text>`);
  });
  parts.push(`<line x1="${M.left}" y1="${M.top + ih}" x2="${W - M.right}" y2="${M.top + ih}" class="ax-line"></line>`);
  parts.push(`<text x="6" y="${(M.top + ih / 2).toFixed(1)}" class="ax-title" transform="rotate(-90 6 ${(M.top + ih / 2).toFixed(1)})" text-anchor="middle">Number of fires (log scale)</text>`);
  parts.push('</svg>');
  return parts.join('');
}
