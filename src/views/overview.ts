// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { FireData } from '../types';
import { findings, seasonRank } from '../analysis';
import { TYPE_COLOR, STATE_COLOR } from '../colors';
import { ha, km2, num, pct, season as fmtSeason, esc } from '../format';
import { g } from '../glossary';
import { card, statRow, viewHead } from './ui';
import { barChart } from './charts';

export function mount(el: HTMLElement, data: FireData, go: (view: string) => void): void {
  const t = data.core.totals;
  const ranked = seasonRank(data.seasons);
  const worst = ranked[0];
  const found = findings(data);

  el.innerHTML = `
    ${viewHead({
    title: 'Every mapped bushfire in Australia',
    question: 'What has actually burnt, where, and how much of it was on purpose?',
    blurb: `Australia's fire agencies have mapped ${num(t.fires)} separate fires since ${fmtSeason(t.firstSeason)}. This site publishes the whole record — corrected for a ${g('double_counting', 'double-counting')} problem that inflates most published totals by nearly half.`,
  })}

    ${statRow([
    { value: num(t.fires), label: 'Fires mapped', sub: `${fmtSeason(t.firstSeason)} to ${fmtSeason(t.lastSeason)}`, tone: 'dom', tip: `Distinct fires after collapsing multi-part records.\nThe raw file has ${num(t.rawRows)} rows.` },
    { value: ha(t.correctedArea), label: 'Cumulative area burnt', sub: 'counting repeat burns each time', tone: 'warn', tip: 'This is NOT the amount of distinct land burnt — the same country burns over and over. Adding 124 years of fire approaches the size of the continent.' },
    { value: `${t.overcount.toFixed(2)}×`, label: 'Naive totals overstate by', sub: `${ha(t.naiveArea)} if summed raw`, tone: 'bad', tip: 'Sum the area column without collapsing multi-part fires and you get this much too much.' },
    { value: pct(t.causeKnown, t.fires, 0), label: 'Fires with a known cause', sub: `${num(t.causeKnown)} of ${num(t.fires)}`, tone: 'bad', tip: 'Everything on the Causes view describes this minority only.' },
  ])}

    <section class="card">
      <div class="card-head">
        <h2>What this data shows — and what it does not</h2>
        <p>Six findings that change how every other number here should be read.</p>
      </div>
      <div class="findings">
        ${found.map((f) => `
          <article class="finding finding-${f.severity}">
            <h3>${esc(f.title)}</h3>
            <p>${esc(f.body)}</p>
            ${f.view ? `<a href="#view=${esc(f.view)}" data-go="${esc(f.view)}">${esc(f.cta ?? 'Explore')} →</a>` : ''}
          </article>`).join('')}
      </div>
    </section>

    ${card('The five largest fire seasons on record',
    'Area burnt, July–June, after correction. Hover any bar for the breakdown; click to open that season.',
    `<div id="ov-seasons"></div>
       <p class="ctl-note">The seasons that burnt the most ground are not the seasons Australians remember. ${esc(fmtSeason(worst?.season ?? 0))} burnt ${esc(ha(worst?.total ?? 0))} — mostly remote rangeland, where fire destroys almost no buildings.</p>`)}

    ${card('What kind of fire is it?',
    'Prescribed burns are lit deliberately to reduce fuel. Counting them together with bushfires misrepresents both.',
    `<div id="ov-types"></div>`)}

    ${card('The single biggest fires ever mapped',
    'Individual fires, after correction. Almost all of them are in the rangelands of Western Australia, Queensland and the Northern Territory.',
    `<div id="ov-biggest"></div>`)}
  `;

  // Top seasons ─────────────────────────────────────────────────────────────
  const topSeasons = ranked.slice(0, 5);
  el.querySelector('#ov-seasons')!.innerHTML = barChart(topSeasons.map((s) => ({
    key: String(s.season),
    label: fmtSeason(s.season),
    value: s.total,
    color: '#c2410c',
    sub: `${num(s.fires)} fires`,
    tip: `${fmtSeason(s.season)}\n${ha(s.total)} (${km2(s.total)})\n${num(s.fires)} fires`,
  })), { format: ha, clickable: true });

  el.querySelectorAll<HTMLElement>('#ov-seasons .bar-click').forEach((b) => {
    const open = () => go(`seasons&season=${b.dataset.row}`);
    b.addEventListener('click', open);
    b.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); open(); }
    });
  });

  // Types ───────────────────────────────────────────────────────────────────
  el.querySelector('#ov-types')!.innerHTML = barChart(data.core.types.map((x) => ({
    key: x.type,
    label: x.type === 'bushfire' ? 'Bushfire' : x.type === 'prescribed' ? 'Prescribed burn' : 'Unclassified',
    value: x.area,
    color: TYPE_COLOR[x.type],
    sub: `${num(x.fires)} fires`,
    tip: `${x.type === 'bushfire' ? 'Bushfire' : x.type === 'prescribed' ? 'Prescribed burn' : 'Unclassified'}\n${num(x.fires)} fires (${pct(x.fires, t.fires)} of records)\n${ha(x.area)} burnt (${pct(x.area, t.correctedArea)} of area)`,
  })), { format: ha });

  // Biggest individual fires ────────────────────────────────────────────────
  el.querySelector('#ov-biggest')!.innerHTML = barChart(
    data.core.biggest.slice(0, 10).map((f, i) => ({
      key: String(i),
      label: f.name ? `${f.name}` : `Unnamed fire (${f.state ?? '—'})`,
      value: f.area,
      color: f.state ? STATE_COLOR[f.state] : '#8b8178',
      sub: `${f.state ?? '—'} · ${fmtSeason(f.season)}`,
      tip: `${f.name ?? 'Unnamed fire'}\n${f.state ?? 'Unknown state'} · ${fmtSeason(f.season)}\n${ha(f.area)} (${km2(f.area)})`,
    })),
    { format: ha },
  );

  el.querySelectorAll<HTMLElement>('[data-go]').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.go!); });
  });
}
