// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { FireData, StateCode } from '../types';
import { STATE_COLOR, TYPE_COLOR } from '../colors';
import { STATES, STATE_LABEL, TYPE_LABEL, ha, km2, num, season as fmtSeason, esc } from '../format';
import { g } from '../glossary';
import { card, onSeg, seg, statRow, viewHead, legend } from './ui';
import { stackedColumns } from './charts';
import { openDrawer } from '../drawer';
import { seasonRank, rankOf } from '../analysis';

type Mode = 'state' | 'type';

export function mount(el: HTMLElement, data: FireData, _go: (v: string) => void, params: URLSearchParams): void {
  let mode: Mode = 'state';
  const ranked = seasonRank(data.seasons);
  const bs = data.seasons.find((s) => s.season === 2019);
  const bsRank = rankOf(data.seasons, 2019);

  // The NT is absent from the national historical layer for its entire 124-year
  // run. Drawn as a band so the reader sees a hole in the data rather than
  // reading "the NT does not burn".
  const nt = data.states.find((s) => s.code === 'NT');
  const ntFrom = data.seasons[0]?.season ?? 1899;
  const ntTo = (nt?.firstSeason ?? 2020) - 1;

  el.innerHTML = `
    ${viewHead({
    title: 'Every fire season since 1899',
    question: 'Which years actually burnt the most — and why don’t we remember them?',
    blurb: `Binned July to June, because southern Australia’s ${g('fire_season', 'fire season')} straddles the new year. Every figure is corrected for ${g('multipart', 'multi-part fires')}.`,
  })}

    ${statRow([
    { value: fmtSeason(ranked[0]?.season ?? 0), label: 'Largest season on record', sub: ha(ranked[0]?.total ?? 0), tone: 'bad' },
    { value: bs ? `${ordinal(bsRank)}` : '—', label: 'Where Black Summer ranks', sub: bs ? `${ha(bs.total)} in 2019–20` : '', tone: 'warn' },
    { value: num(data.seasons.length), label: 'Seasons with mapped fire', sub: `${fmtSeason(data.core.totals.firstSeason)} onward`, tone: 'dom' },
    { value: ha(median(data.seasons.slice(-30).map((s) => s.total))), label: 'Median season, last 30 years', sub: 'half of seasons burn less', tone: 'dom' },
  ])}

    <section class="card">
      <div class="card-head">
        <h2>Area burnt by season</h2>
        <p>Each column is one July–June season, stacked by ${mode === 'state' ? 'state' : 'fire type'}. Hover for the full breakdown; click a column to open that season.</p>
      </div>
      <div class="ctl-row">
        ${seg('mode', [{ id: 'state', label: 'By state' }, { id: 'type', label: 'By fire type' }], 'state', 'Stack by')}
        <span class="ctl-note">Shaded band = no Northern Territory data exists before ${esc(fmtSeason(nt?.firstSeason ?? 2020))}.</span>
      </div>
      <div class="chart chart-xwide" id="se-chart"></div>
      <div id="se-legend"></div>
    </section>

    ${card('The ten largest seasons',
    'Ranked by corrected area burnt. Click any row for the state-by-state breakdown.',
    '<div id="se-top"></div>')}
  `;

  const paint = () => {
    const rows = data.seasons.map((s) => ({
      key: String(s.season),
      label: String(s.season),
      values: mode === 'state'
        ? Object.fromEntries(STATES.map((c) => [c, s.byState[c] ?? 0]))
        : { bushfire: s.byType.bushfire ?? 0, prescribed: s.byType.prescribed ?? 0, unknown: s.byType.unknown ?? 0 },
      note: `${num(s.fires)} fires`,
    }));
    const series = mode === 'state'
      ? STATES.map((c) => ({ key: c, label: STATE_LABEL[c], color: STATE_COLOR[c] }))
      : (['bushfire', 'prescribed', 'unknown'] as const).map((t) => ({ key: t, label: TYPE_LABEL[t], color: TYPE_COLOR[t] }));

    el.querySelector('#se-chart')!.innerHTML = stackedColumns({
      rows,
      series,
      yLabel: 'Hectares burnt',
      format: ha,
      clickable: true,
      bands: ntTo > ntFrom ? [{ from: String(ntFrom), to: String(ntTo), label: `No Northern Territory data\nexists for these seasons` }] : [],
      marks: [
        { key: String(ranked[0]?.season ?? 0), label: fmtSeason(ranked[0]?.season ?? 0) },
        { key: '2019', label: 'Black Summer' },
      ],
    });
    el.querySelector('#se-legend')!.innerHTML = legend(series.map((s) => ({ color: s.color, label: s.label })));
    el.querySelectorAll<HTMLElement>('#se-chart .mark-click').forEach((r) => {
      r.addEventListener('click', () => openSeason(Number(r.dataset.row)));
    });
  };

  const openSeason = (year: number) => {
    const s = data.seasons.find((x) => x.season === year);
    if (!s) return;
    const rank = rankOf(data.seasons, year);
    const byState = STATES
      .map((c) => ({ c, v: s.byState[c] ?? 0 }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
    openDrawer(`${fmtSeason(year)} fire season`, `
      <h3>Totals</h3>
      <dl class="kv">
        <dt>Area burnt</dt><dd>${esc(ha(s.total))}</dd>
        <dt>Equivalent</dt><dd>${esc(km2(s.total))}</dd>
        <dt>Fires mapped</dt><dd>${esc(num(s.fires))}</dd>
        <dt>All-time rank</dt><dd>${esc(ordinal(rank))} of ${esc(String(data.seasons.length))}</dd>
      </dl>
      <h3>By state</h3>
      <ul class="variant-list">
        ${byState.map((x) => `<li><span>${esc(STATE_LABEL[x.c as StateCode])}</span><span>${esc(ha(x.v))}</span></li>`).join('')
      || '<li><span>No state breakdown recorded</span><span>—</span></li>'}
      </ul>
      <h3>By fire type</h3>
      <ul class="variant-list">
        ${(['bushfire', 'prescribed', 'unknown'] as const)
        .filter((t) => (s.byType[t] ?? 0) > 0)
        .map((t) => `<li><span>${esc(TYPE_LABEL[t])}</span><span>${esc(ha(s.byType[t] ?? 0))}</span></li>`).join('')}
      </ul>
      <p class="drawer-note">Season runs 1 July ${esc(String(year))} to 30 June ${esc(String(year + 1))}.</p>
    `);
  };

  paint();
  onSeg(el, 'mode', (v) => { mode = v as Mode; paint(); });

  // Top ten table ───────────────────────────────────────────────────────────
  const top = ranked.slice(0, 10);
  el.querySelector('#se-top')!.innerHTML = `<div class="tbl-wrap"><table class="data">
    <thead><tr><th scope="col">Rank</th><th scope="col">Season</th><th scope="col" class="num">Area burnt</th><th scope="col" class="num">km²</th><th scope="col" class="num">Fires</th><th scope="col">Largest state share</th></tr></thead>
    <tbody>${top.map((s, i) => {
    const lead = STATES.map((c) => ({ c, v: s.byState[c] ?? 0 })).sort((a, b) => b.v - a.v)[0];
    return `<tr class="clickable" data-row="${s.season}" tabindex="0">
        <td class="num">${i + 1}</td>
        <td>${esc(fmtSeason(s.season))}</td>
        <td class="num">${esc(ha(s.total))}</td>
        <td class="num">${esc(km2(s.total))}</td>
        <td class="num">${esc(num(s.fires))}</td>
        <td><span class="pill" style="background:${lead && lead.v ? `${STATE_COLOR[lead.c]}22` : 'var(--bg-elevated)'};color:${lead && lead.v ? STATE_COLOR[lead.c] : 'var(--text-secondary)'}">${lead && lead.v ? esc(`${lead.c} ${Math.round((lead.v / s.total) * 100)}%`) : '—'}</span></td>
      </tr>`;
  }).join('')}</tbody></table></div>`;

  el.querySelectorAll<HTMLElement>('#se-top tr[data-row]').forEach((tr) => {
    const open = () => openSeason(Number(tr.dataset.row));
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); open(); }
    });
  });

  const deep = params.get('season');
  if (deep) openSeason(Number(deep));
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function ordinal(n: number): string {
  const suf = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suf[(v - 20) % 10] ?? suf[v] ?? suf[0]);
}
