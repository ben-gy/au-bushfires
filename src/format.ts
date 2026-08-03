// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { FireType, StateCode } from './types';

export const STATES: StateCode[] = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

export const STATE_LABEL: Record<StateCode, string> = {
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  WA: 'Western Australia',
  SA: 'South Australia',
  TAS: 'Tasmania',
  ACT: 'Australian Capital Territory',
  NT: 'Northern Territory',
};

export const TYPE_LABEL: Record<FireType, string> = {
  bushfire: 'Bushfire',
  prescribed: 'Prescribed burn',
  unknown: 'Unclassified',
};

export const CAUSE_LABEL: Record<string, string> = {
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

const nf = new Intl.NumberFormat('en-AU');

export function num(n: number): string {
  return Number.isFinite(n) ? nf.format(Math.round(n)) : '—';
}

export function compact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Hectares are the source unit but meaningless to most readers at scale, so
 * anything over ten thousand is expressed in millions and anything over a
 * million also carries a "roughly the size of…" comparison elsewhere.
 */
export function ha(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M ha`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k ha`;
  if (n >= 1) return `${nf.format(Math.round(n))} ha`;
  return '<1 ha';
}

/** Hectares → km², the unit people actually picture. 1 km² = 100 ha. */
export function km2(n: number): string {
  return `${nf.format(Math.round(n / 100))} km²`;
}

export function pct(n: number, d: number, dp = 1): string {
  if (!d) return '—';
  return `${((n / d) * 100).toFixed(dp)}%`;
}

/** 2019 → "2019–20". The fire season, never the calendar year. */
export function season(y: number | null | undefined): string {
  if (y == null || !Number.isFinite(y)) return '—';
  return `${y}–${String((y + 1) % 100).padStart(2, '0')}`;
}

export function isoDate(s: string | number | null): string {
  if (s == null) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function relTime(ms: number | null): string {
  if (ms == null) return '—';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Escape for interpolation into innerHTML. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Tooltip text needs one of two different escapes and they are not
 * interchangeable: `setAttribute` takes a RAW newline, but a `data-tip="…"`
 * baked into an innerHTML string needs `&#10;` or the reader sees a literal
 * "&#10;" in the popover.
 */
export function tipAttr(s: string): string {
  return esc(s).replace(/\n/g, '&#10;');
}

export function slug(s: string): string {
  return String(s ?? '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/**
 * A display name, or null. The source uses whitespace-only strings as well as
 * nulls for unnamed fires, and `" "` is truthy — so it slips past every
 * `name ? name : '—'` fallback and renders as an empty cell that reads as a
 * bug. The pipeline normalises this too; this is the second line of defence.
 */
export function name(s: string | null | undefined): string | null {
  const t = String(s ?? '').trim();
  return t || null;
}
