// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Turns the archive's biggest weakness into a legible view. WA holds over half
// of every record in the file, and the honest reading of that is partly "WA
// maps more thoroughly", not purely "WA burns more" — a distinction that is
// invisible unless someone draws it.

import type { FireData } from '../types';
import { STATE_COLOR, TYPE_COLOR } from '../colors';
import { TYPE_LABEL, ha, num, pct, season as fmtSeason, esc } from '../format';
import { g } from '../glossary';
import { card, statRow, viewHead, legend } from './ui';
import { barChart } from './charts';
import { reportingIntensity } from '../analysis';
import { openDrawer } from '../drawer';

export function mount(el: HTMLElement, data: FireData): void {
  const states = [...data.states].filter((s) => s.fires > 0);
  const total = data.core.totals.fires;
  const wa = data.states.find((s) => s.code === 'WA');
  const nt = data.states.find((s) => s.code === 'NT');
  const intensity = reportingIntensity(data.states);

  el.innerHTML = `
    ${viewHead({
    title: 'Who maps the fires',
    question: 'Is Western Australia really half of Australia’s fire — or half of Australia’s fire mapping?',
    blurb: 'Both, partly. This archive is compiled from eight separate agencies with different mandates, budgets and starting dates, and that shows up in the data as clearly as the fires do.',
  })}

    ${statRow([
    { value: wa ? pct(wa.fires, total, 0) : '—', label: 'of all records are Western Australian', sub: wa ? `${num(wa.fires)} of ${num(total)} fires` : '', tone: 'warn' },
    { value: nt?.firstSeason ? fmtSeason(nt.firstSeason) : '—', label: 'First Northern Territory record', sub: 'nothing at all before that', tone: 'bad' },
    { value: String(states.length), label: 'States and territories represented', sub: 'out of eight', tone: 'dom' },
    { value: fmtSeason(data.core.totals.firstSeason), label: 'Earliest mapped fire', sub: 'coverage is thin for decades after', tone: 'dom' },
  ])}

    <div class="note-band">
      <strong>Read this view before drawing conclusions from the others.</strong>
      A state with more records is not necessarily a state with more fire. It may simply have mapped for longer, mapped smaller fires,
      or counted every prescribed burn. The Northern Territory's ${g('nrt', 'total absence')} before ${esc(fmtSeason(nt?.firstSeason ?? 2020))}
      is the starkest example: it is not that the NT did not burn, it is that nobody added it to this file.
    </div>

    ${card('Records per state',
    'Raw count of distinct fires. Click a state for its full profile.',
    '<div id="cv-records"></div>')}

    ${card('Records per 10,000 km² of land',
    'The same counts normalised by how much land each state has. This is the closest thing to a fair comparison of mapping intensity, and it reorders the list completely.',
    '<div id="cv-intensity"></div>')}

    ${card('When each state starts',
    'The first and last season on record. A short bar is a short archive, not a fire-free state.',
    '<div id="cv-span"></div>')}

    ${card('What each state records',
    'The mix of bushfire against prescribed burn varies enormously — some agencies map every hazard-reduction burn, others map almost none.',
    '<div id="cv-mix"></div><div id="cv-mix-legend"></div>')}
  `;

  const openState = (code: string) => {
    const s = data.states.find((x) => x.code === code);
    if (!s) return;
    const per = intensity.find((i) => i.code === code);
    openDrawer(s.name, `
      <h3>Records</h3>
      <dl class="kv">
        <dt>Distinct fires</dt><dd>${esc(num(s.fires))}</dd>
        <dt>Share of the archive</dt><dd>${esc(pct(s.fires, total))}</dd>
        <dt>Cumulative area</dt><dd>${esc(ha(s.area))}</dd>
        <dt>Land area</dt><dd>${esc(num(s.landKm2))} km²</dd>
        <dt>Records per 10,000 km²</dt><dd>${esc(per ? per.per.toFixed(1) : '—')}</dd>
      </dl>
      <h3>Coverage</h3>
      <dl class="kv">
        <dt>First season</dt><dd>${esc(fmtSeason(s.firstSeason))}</dd>
        <dt>Last season</dt><dd>${esc(fmtSeason(s.lastSeason))}</dd>
        <dt>Seasons spanned</dt><dd>${esc(s.firstSeason != null && s.lastSeason != null ? String(s.lastSeason - s.firstSeason + 1) : '—')}</dd>
      </dl>
      <h3>What gets recorded</h3>
      <ul class="variant-list">
        ${(['bushfire', 'prescribed', 'unknown'] as const).map((t) => `<li><span>${esc(TYPE_LABEL[t])}</span><span>${esc(num(s.byType[t] ?? 0))} (${esc(pct(s.byType[t] ?? 0, s.fires))})</span></li>`).join('')}
      </ul>
    `);
  };

  const wire = (sel: string) => {
    el.querySelectorAll<HTMLElement>(`${sel} .bar-click`).forEach((b) => {
      const open = () => openState(b.dataset.row!);
      b.addEventListener('click', open);
      b.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); open(); }
      });
    });
  };

  el.querySelector('#cv-records')!.innerHTML = barChart(
    [...states].sort((a, b) => b.fires - a.fires).map((s) => ({
      key: s.code,
      label: s.name,
      value: s.fires,
      color: STATE_COLOR[s.code],
      sub: pct(s.fires, total),
      tip: `${s.name}\n${num(s.fires)} fires (${pct(s.fires, total)} of the archive)\n${ha(s.area)} cumulative`,
    })), { format: num, clickable: true },
  );
  wire('#cv-records');

  el.querySelector('#cv-intensity')!.innerHTML = barChart(
    intensity.map((i) => {
      const s = data.states.find((x) => x.code === i.code)!;
      return {
        key: i.code,
        label: s.name,
        value: i.per,
        color: STATE_COLOR[s.code],
        sub: `${num(s.fires)} fires`,
        tip: `${s.name}\n${i.per.toFixed(1)} records per 10,000 km²\n${num(s.fires)} fires over ${num(s.landKm2)} km²`,
      };
    }), { format: (n) => n.toFixed(1), clickable: true },
  );
  wire('#cv-intensity');

  // Coverage span — a Gantt-style strip per state.
  const first = Math.min(...states.map((s) => s.firstSeason ?? 9999));
  const last = Math.max(...states.map((s) => s.lastSeason ?? 0));
  const span = Math.max(1, last - first);
  el.querySelector('#cv-span')!.innerHTML = `<div class="gantt">${[...states]
    .sort((a, b) => (a.firstSeason ?? 0) - (b.firstSeason ?? 0))
    .map((s) => {
      const a = ((s.firstSeason ?? first) - first) / span;
      const b = ((s.lastSeason ?? last) - first) / span;
      return `<div class="gantt-row">
        <span class="gantt-lab">${esc(s.code)}</span>
        <span class="gantt-track">
          <span class="gantt-bar" style="left:${(a * 100).toFixed(2)}%;width:${Math.max(0.8, (b - a) * 100).toFixed(2)}%;background:${STATE_COLOR[s.code]}"
            data-tip="${esc(s.name)}&#10;${esc(fmtSeason(s.firstSeason))} to ${esc(fmtSeason(s.lastSeason))}&#10;${esc(num(s.fires))} fires"></span>
        </span>
        <span class="gantt-val">${esc(fmtSeason(s.firstSeason))}</span>
      </div>`;
    }).join('')}
    <div class="gantt-axis"><span>${esc(fmtSeason(first))}</span><span>${esc(fmtSeason(last))}</span></div>
  </div>`;

  const types = ['bushfire', 'prescribed', 'unknown'] as const;
  el.querySelector('#cv-mix')!.innerHTML = `<div class="stack-rows">${[...states]
    .sort((a, b) => b.fires - a.fires).map((s) => {
      const tot = s.fires || 1;
      return `<div class="stack-row">
        <span class="stack-lab">${esc(s.code)}</span>
        <span class="stack-track">${types.map((t) => {
        const v = s.byType[t] ?? 0;
        if (!v) return '';
        return `<span class="stack-seg" style="width:${((v / tot) * 100).toFixed(2)}%;background:${TYPE_COLOR[t]}" data-tip="${esc(s.name)}&#10;${esc(TYPE_LABEL[t])}: ${esc(num(v))} (${esc(pct(v, tot))})"></span>`;
      }).join('')}</span>
        <span class="stack-val">${esc(num(s.fires))}</span>
      </div>`;
    }).join('')}</div>`;
  el.querySelector('#cv-mix-legend')!.innerHTML = legend(
    types.map((t) => ({ color: TYPE_COLOR[t], label: TYPE_LABEL[t] })),
  );
}
