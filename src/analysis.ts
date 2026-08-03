// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Pure functions that turn the aggregates into findings. Kept free of DOM so
// they can be unit-tested, and free of hard-coded numbers so a data refresh
// changes the conclusions rather than leaving stale prose behind.

import type { FireData, Region, Season, StateRow } from './types';

export type Severity = 'info' | 'warn' | 'alert';

export interface Finding {
  severity: Severity;
  title: string;
  body: string;
  /** Optional view to jump to. */
  view?: string;
  cta?: string;
}

export function seasonRank(seasons: Season[]): Season[] {
  return [...seasons].sort((a, b) => b.total - a.total);
}

/** Where a given season sits in the all-time ranking (1 = largest). */
export function rankOf(seasons: Season[], year: number): number {
  return seasonRank(seasons).findIndex((s) => s.season === year) + 1;
}

/** Median of a numeric list; returns 0 for an empty list. */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Records per million hectares of land. The Coverage view exists because WA
 * holds over half of all records, and the honest reading of that is partly
 * "WA maps more thoroughly", not purely "WA burns more".
 */
export function reportingIntensity(states: StateRow[]): { code: string; per: number }[] {
  return states
    .filter((s) => s.fires > 0)
    .map((s) => ({ code: s.code, per: s.fires / (s.landKm2 / 1e4) }))
    .sort((a, b) => b.per - a.per);
}

export function findings(data: FireData): Finding[] {
  const out: Finding[] = [];
  const { core, seasons, states, causes, correction } = data;
  const ranked = seasonRank(seasons);
  const bsRank = rankOf(seasons, 2019);
  const top = ranked[0];
  const bs = seasons.find((s) => s.season === 2019);

  // 1 — The correction. Always first: it qualifies every other number.
  const ratio = correction.blackSummer.corrected
    ? correction.blackSummer.naive / correction.blackSummer.corrected
    : 0;
  out.push({
    severity: 'alert',
    title: 'Adding up this dataset naively nearly doubles it',
    body: `Large fires are stored as one row per burnt patch, and every row repeats the whole fire's area. Summing the column for 2019–20 gives ${fmtM(correction.blackSummer.naive)} million hectares; the correct figure is ${fmtM(correction.blackSummer.corrected)} million — an overstatement of ${ratio.toFixed(2)}×. Every number on this site is corrected.`,
    view: 'correction',
    cta: 'See how',
  });

  // 2 — The counter-intuitive ranking.
  //
  // Deliberately says "in this dataset", never "on record". The archive holds no
  // Northern Territory data before 2020 and renders 1974-75 — the largest season
  // in Australian history at roughly 117 million hectares — as 2.3 million. A
  // ranking across it is a ranking of what has been MAPPED, not of what burnt.
  if (bs && top && bsRank > 1) {
    out.push({
      severity: 'info',
      title: `Black Summer is not the biggest season in this data — it ranks ${ordinal(bsRank)}`,
      body: `${labelSeason(top.season)} burnt ${fmtM(top.total)} million hectares against 2019–20's ${fmtM(bs.total)} million. The difference is where: the largest seasons are dominated by remote rangeland and savanna fires that destroy almost no homes, so they leave little public memory. Area burnt and impact are not the same measurement. This ranks what has been mapped, not all Australian fire — see Coverage for what is missing.`,
      view: 'seasons',
      cta: 'See every season',
    });
  }

  // 3 — Cause coverage, stated before any cause chart is read.
  const knownPct = core.totals.fires ? (core.totals.causeKnown / core.totals.fires) * 100 : 0;
  out.push({
    severity: 'warn',
    title: `Nearly ${Math.round(100 - knownPct)}% of fires have no recorded cause`,
    body: `Only ${core.totals.causeKnown.toLocaleString('en-AU')} of ${core.totals.fires.toLocaleString('en-AU')} fires (${knownPct.toFixed(1)}%) carry an ignition cause. Every cause figure here describes that minority, and it is not a random sample — investigated fires skew towards the ones that threatened people.`,
    view: 'causes',
    cta: 'See causes',
  });

  // 4 — Lightning vs deliberate, the genuinely surprising cross-tab.
  const light = causes.find((c) => c.cause === 'lightning');
  const delib = causes.find((c) => c.cause === 'deliberate');
  if (light && delib && light.meanArea > 0 && delib.meanArea > 0) {
    const mult = light.meanArea / delib.meanArea;
    if (mult > 1.5) {
      out.push({
        severity: 'info',
        title: `Deliberate fires are more common; lightning fires are ${mult.toFixed(0)}× bigger`,
        body: `Of fires with a known cause, ${delib.fires.toLocaleString('en-AU')} were lit deliberately and ${light.fires.toLocaleString('en-AU')} by lightning. But the average deliberate fire burns ${delib.meanArea.toLocaleString('en-AU')} ha against lightning's ${light.meanArea.toLocaleString('en-AU')} ha — lightning strikes remote country where fires run for weeks before anyone reaches them.`,
        view: 'causes',
        cta: 'Compare causes',
      });
    }
  }

  // 5 — The NT hole. A national total is materially wrong without this.
  const nt = states.find((s) => s.code === 'NT');
  if (nt && (nt.firstSeason ?? 0) > 2000) {
    out.push({
      severity: 'warn',
      title: `The Northern Territory only appears from ${labelSeason(nt.firstSeason!)}`,
      body: `The national historical layer contains no NT records at all across 124 years. The only NT data that exists starts in ${labelSeason(nt.firstSeason!)} — and in that short window it already contributes ${fmtM(nt.area)} million hectares. Any "total area burnt in Australia" before then is missing an entire territory, and the charts here show that gap rather than hiding it.`,
      view: 'coverage',
      cta: 'See coverage',
    });
  }

  // 6 — Prescribed burning: half the records, a fraction of the ground.
  const pres = core.types.find((t) => t.type === 'prescribed');
  if (pres && core.totals.fires) {
    const recShare = (pres.fires / core.totals.fires) * 100;
    const areaShare = core.totals.correctedArea ? (pres.area / core.totals.correctedArea) * 100 : 0;
    if (recShare - areaShare > 10) {
      out.push({
        severity: 'info',
        title: 'Half of all mapped fires were lit on purpose',
        body: `Prescribed burns are ${recShare.toFixed(0)}% of every record in the archive but only ${areaShare.toFixed(0)}% of the ground burnt — deliberate burning is frequent and small, bushfire is rarer and vastly larger. Counting the two together, as a raw record count does, badly misrepresents both.`,
        view: 'sizes',
        cta: 'See the split',
      });
    }
  }

  return out;
}

/** Regions ranked for the leaderboard, with a per-region burn frequency. */
export function rankRegions(
  regions: Region[],
  metric: 'fires' | 'area' | 'bushfires',
): Region[] {
  return [...regions].sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0));
}

/** How many distinct seasons a region has recorded at least one fire in. */
export function seasonsBurnt(r: Region): number {
  return Object.keys(r.seasons ?? {}).length;
}

/**
 * Years since a region last recorded a fire, given the dataset's own last
 * season rather than today's date — the archive lags reality by design.
 */
export function seasonsSince(r: Region, lastSeason: number): number | null {
  return r.lastSeason == null ? null : lastSeason - r.lastSeason;
}

function fmtM(n: number): string {
  return (n / 1e6).toFixed(1);
}

function labelSeason(y: number): string {
  return `${y}–${String((y + 1) % 100).padStart(2, '0')}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
