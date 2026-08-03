// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Shared view chrome and SVG primitives. Hand-rolled rather than pulled from a
// chart library: every chart here needs custom hover targets and semantic
// colour, which is most of what a chart library would have supplied.

import { esc, tipAttr } from '../format';

export interface ViewHeadOpts {
  title: string;
  question: string;
  blurb: string;
}

export function viewHead(o: ViewHeadOpts): string {
  return `<header class="view-head">
    <h1>${o.title}</h1>
    <p class="view-q">${o.question}</p>
    <p class="view-blurb">${o.blurb}</p>
  </header>`;
}

export interface StatOpts {
  value: string;
  label: string;
  sub?: string;
  tone?: 'dom' | 'for' | 'good' | 'warn' | 'bad';
  tip?: string;
}

export function stat(o: StatOpts): string {
  const tip = o.tip ? ` data-tip="${tipAttr(o.tip)}"` : '';
  return `<div class="stat${o.tone ? ` stat-${o.tone}` : ''}"${tip}>
    <span class="stat-v">${esc(o.value)}</span>
    <span class="stat-l">${o.label}</span>
    ${o.sub ? `<span class="stat-s">${o.sub}</span>` : ''}
  </div>`;
}

export function statRow(stats: StatOpts[]): string {
  return `<div class="stat-row">${stats.map(stat).join('')}</div>`;
}

export function card(title: string, sub: string, body: string, extraClass = ''): string {
  return `<section class="card ${extraClass}">
    <div class="card-head"><h2>${title}</h2><p>${sub}</p></div>
    ${body}
  </section>`;
}

export function legend(items: { color: string; label: string; tip?: string }[]): string {
  return `<div class="legend">${items.map((i) => `
    <span class="legend-item"${i.tip ? ` data-tip="${tipAttr(i.tip)}"` : ''}>
      <span class="swatch" style="background:${i.color}"></span>${i.label}
    </span>`).join('')}</div>`;
}

/** Segmented control. Returns markup; wire clicks with `onSeg`. */
export function seg(name: string, options: { id: string; label: string }[], active: string, label?: string): string {
  // role="group" with aria-pressed, NOT role="tablist"/"tab". These filter the
  // view in place; they do not switch between tabpanels, and claiming the tab
  // pattern promises a screen reader an aria-controls target and arrow-key
  // navigation that do not exist.
  return `<div class="seg" role="group" aria-label="${esc(label ?? name)}" data-seg="${esc(name)}">${options.map((o) => `
    <button type="button" aria-pressed="${o.id === active}" data-val="${esc(o.id)}" class="${o.id === active ? 'active' : ''}">${o.label}</button>`).join('')}</div>`;
}

export function onSeg(root: HTMLElement, name: string, cb: (val: string) => void): void {
  root.querySelector(`[data-seg="${name}"]`)?.addEventListener('click', (e) => {
    const b = (e.target as Element).closest('button') as HTMLElement | null;
    if (!b || !b.dataset.val) return;
    const wrap = b.parentElement!;
    wrap.querySelectorAll('button').forEach((x) => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-pressed', String(on));
    });
    cb(b.dataset.val);
  });
}

// ── SVG helpers ──────────────────────────────────────────────────────────────

export const SVG_NS = 'http://www.w3.org/2000/svg';

export interface Scale { (v: number): number }

export function linear(d0: number, d1: number, r0: number, r1: number): Scale {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Nice round tick values across a domain. */
export function ticks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function svgOpen(w: number, h: number, label: string, cls = ''): string {
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" class="${cls}" preserveAspectRatio="xMidYMid meet">`;
}

/** A polyline path from [x, y] pairs. */
export function pathFrom(points: [number, number][]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
}

/** A closed area path between a top line and a flat baseline. */
export function areaFrom(points: [number, number][], baseY: number): string {
  if (!points.length) return '';
  return `${pathFrom(points)} L${points[points.length - 1][0].toFixed(1)} ${baseY.toFixed(1)} L${points[0][0].toFixed(1)} ${baseY.toFixed(1)} Z`;
}

// ── Sortable table ───────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  label: string;
  num?: boolean;
  wide?: boolean;
  /** Sort value; omit to make the column unsortable. */
  sort?: (row: T) => number | string;
  render: (row: T, index: number) => string;
}

export interface TableOpts<T> {
  rows: T[];
  columns: Column<T>[];
  initialSort?: string;
  desc?: boolean;
  rowKey?: (row: T) => string;
  clickable?: boolean;
  empty?: string;
  /** Called when a row is clicked or activated by keyboard. Rebound on every sort. */
  onRowActivate?: (key: string) => void;
}

/**
 * Renders a sortable table into `host` and returns a re-render function so the
 * caller can swap the row set (search, filter) without rebuilding the header.
 */
export function sortableTable<T>(host: HTMLElement, opts: TableOpts<T>): (rows: T[]) => void {
  let sortKey = opts.initialSort ?? opts.columns[0].key;
  let desc = opts.desc ?? true;
  let rows = opts.rows;

  // The sort control is a real <button> inside the <th>, not a click handler on
  // the <th> itself: a bare th is not focusable, so click-only sorting is
  // unreachable from the keyboard. aria-sort stays on the th, which is what
  // carries the implicit columnheader role it belongs to.
  const head = () => `<tr>${opts.columns.map((c) => {
    const sortable = !!c.sort;
    const isSorted = sortable && c.key === sortKey;
    const arrow = isSorted ? (desc ? ' ▾' : ' ▴') : '';
    const inner = sortable
      ? `<button type="button" class="th-sort" data-col="${esc(c.key)}">${c.label}${arrow}</button>`
      : c.label;
    return `<th class="${c.num ? 'num ' : ''}${sortable ? 'sortable' : ''}"${isSorted ? ` aria-sort="${desc ? 'descending' : 'ascending'}"` : ''} scope="col">${inner}</th>`;
  }).join('')}</tr>`;

  const body = () => {
    const col = opts.columns.find((c) => c.key === sortKey);
    const sorted = col?.sort
      ? [...rows].sort((a, b) => {
        const av = col.sort!(a);
        const bv = col.sort!(b);
        const cmp = typeof av === 'string' || typeof bv === 'string'
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
        return desc ? -cmp : cmp;
      })
      : rows;
    if (!sorted.length) return `<tr><td colspan="${opts.columns.length}" class="wide">${opts.empty ?? 'No matching rows.'}</td></tr>`;
    return sorted.map((r, i) => `<tr class="${opts.clickable ? 'clickable' : ''}"${opts.rowKey ? ` data-row="${esc(opts.rowKey(r))}"` : ''}${opts.clickable ? ' tabindex="0"' : ''}>${
      opts.columns.map((c) => `<td class="${c.num ? 'num' : ''}${c.wide ? ' wide' : ''}">${c.render(r, i)}</td>`).join('')
    }</tr>`).join('');
  };

  const paint = () => {
    host.innerHTML = `<div class="tbl-wrap"><table class="data"><thead>${head()}</thead><tbody>${body()}</tbody></table></div>`;
    host.querySelectorAll('.th-sort').forEach((btn) => btn.addEventListener('click', () => {
      const k = (btn as HTMLElement).dataset.col!;
      if (k === sortKey) desc = !desc;
      else { sortKey = k; desc = true; }
      paint();
    }));
    // Row activation is bound HERE, inside paint(), because every sort rebuilds
    // the tbody. Binding it once from the caller left every row dead the moment
    // the reader sorted a column.
    if (opts.onRowActivate) {
      host.querySelectorAll<HTMLElement>('tr[data-row]').forEach((tr) => {
        const go = () => opts.onRowActivate!(tr.dataset.row!);
        tr.addEventListener('click', go);
        tr.addEventListener('keydown', (e) => {
          if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); go(); }
        });
      });
    }
  };

  paint();
  return (next: T[]) => { rows = next; paint(); };
}

// ── Modal ────────────────────────────────────────────────────────────────────

export function openModal(title: string, html: string): void {
  document.querySelector('.modal-host')?.remove();
  const host = document.createElement('div');
  host.className = 'modal-host';
  host.innerHTML = `<div class="modal-scrim"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <button type="button" class="modal-close" aria-label="Close">×</button>
      ${html}
    </div>`;
  document.body.appendChild(host);
  const close = () => { host.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

  // Four independent exits, all required — a reader who opens an overlay must
  // always be able to get out of it.
  //
  // `pointerdown`, not `click`: it covers mouse, touch and pen in one handler
  // and fires in cases where a synthetic click never arrives. Only ONE event
  // family is bound per control — pairing `touchstart` with `click` makes a
  // single tap fire twice, which closes and instantly reopens the overlay and
  // reads to the user as "the close button does nothing".
  host.querySelector('.modal-scrim')?.addEventListener('pointerdown', close);
  host.querySelector('.modal-close')?.addEventListener('pointerdown', close);
  // Belt and braces for assistive tech, which activates a button via `click`
  // without ever dispatching a pointer event. Closing twice is harmless
  // because `remove()` on a detached node is a no-op.
  host.querySelector('.modal-close')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  trapFocus(host.querySelector('.modal') as HTMLElement);
  (host.querySelector('.modal-close') as HTMLElement).focus();
}

export function trapFocus(el: HTMLElement): void {
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/** Cross-link button to another view. */
export function jump(view: string, label: string): string {
  return `<a class="btn btn-quiet" href="#view=${esc(view)}">${label} →</a>`;
}
