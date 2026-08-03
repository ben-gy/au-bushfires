// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { FireData, StateCode } from '../types';
import { TYPE_COLOR, rampColor } from '../colors';
import { STATES, TYPE_LABEL, ha, km2, num, pct, esc } from '../format';
import { g } from '../glossary';
import { card, statRow, viewHead, legend } from './ui';
import { barChart, logHistogram, matrix } from './charts';

export function mount(el: HTMLElement, data: FireData): void {
  const sizes = data.sizes;
  const total = data.core.totals.fires;
  const totalArea = data.core.totals.correctedArea;
  const big = sizes[sizes.length - 1];
  const small = sizes.slice(0, 3).reduce((a, s) => a + s.fires, 0);
  const bigShare = big ? big.area / totalArea : 0;

  el.innerHTML = `
    ${viewHead({
    title: 'How big is a typical fire?',
    question: 'Do a few enormous fires do most of the burning, or many small ones?',
    blurb: `A few. Fire size spans six orders of magnitude, which is also why any map of this data using ${g('cumulative', 'equal-count colour bins')} misleads.`,
  })}

    ${statRow([
    { value: num(small), label: 'Fires under 100 ha', sub: `${pct(small, total)} of all fires`, tone: 'dom' },
    { value: big ? num(big.fires) : '—', label: 'Fires over 100,000 ha', sub: big ? `just ${pct(big.fires, total, 2)} of fires` : '', tone: 'bad' },
    { value: `${(bigShare * 100).toFixed(0)}%`, label: 'of all burnt area', sub: 'came from those largest fires', tone: 'warn' },
    { value: ha(totalArea / (total || 1)), label: 'Mean fire size', sub: 'badly unrepresentative — see below', tone: 'warn' },
  ])}

    <section class="card">
      <div class="card-head">
        <h2>Every fire by size</h2>
        <p>Log-spaced buckets, and a log height axis — on a linear chart the first bar would be the only thing you could see.</p>
      </div>
      <div class="chart chart-wide" id="sz-hist"></div>
      <p class="ctl-note">This shape is why the average is a poor summary. Most fires are small; almost all the burnt ground comes from the handful that are not.</p>
    </section>

    ${card('Where the ground actually burns',
    'The same buckets, but measuring area instead of counts. The two charts point in opposite directions.',
    `<div id="sz-area"></div>`)}

    <section class="card">
      <div class="card-head">
        <h2>Size profile by state</h2>
        <p>Number of fires in each size bucket. Colour is a log scale within the whole grid.</p>
      </div>
      <div id="sz-matrix"></div>
      <p class="ctl-note">Western Australia and the Northern Territory carry nearly all the very largest fires — rangeland and savanna country where a fire can run unopposed for weeks.</p>
    </section>

    ${card('Bushfire against prescribed burn',
    'Deliberate burns are kept deliberately small. That difference is the whole point of prescribed burning, and it is visible directly in the size profile.',
    `<div id="sz-type"></div><div id="sz-type-legend"></div>`)}
  `;

  el.querySelector('#sz-hist')!.innerHTML = logHistogram(
    sizes.map((s) => ({ label: s.label, count: s.fires, area: s.area })),
    { countFormat: num, areaFormat: ha },
  );

  el.querySelector('#sz-area')!.innerHTML = barChart(sizes.map((s) => ({
    key: s.label,
    label: s.label,
    value: s.area,
    color: rampColor(s.area, Math.max(...sizes.map((x) => x.area))),
    sub: `${num(s.fires)} fires`,
    tip: `${s.label}\n${num(s.fires)} fires (${pct(s.fires, total)} of all fires)\n${ha(s.area)} burnt (${pct(s.area, totalArea)} of all area)\n${km2(s.area)}`,
  })), { format: ha });

  el.querySelector('#sz-matrix')!.innerHTML = matrix({
    rows: sizes.map((s) => ({ key: s.label, label: s.label })),
    cols: STATES.map((s) => ({ key: s, label: s })),
    value: (rk, ck) => sizes.find((s) => s.label === rk)?.byState[ck as StateCode] ?? 0,
    format: num,
    color: rampColor,
    rowTotal: (rk) => num(sizes.find((s) => s.label === rk)?.fires ?? 0),
  });

  const types = ['bushfire', 'prescribed', 'unknown'] as const;
  el.querySelector('#sz-type')!.innerHTML = `<div class="stack-rows">${sizes.map((s) => {
    const tot = types.reduce((a, t) => a + (s.byType[t] ?? 0), 0) || 1;
    return `<div class="stack-row">
      <span class="stack-lab">${esc(s.label)}</span>
      <span class="stack-track">${types.map((t) => {
      const v = s.byType[t] ?? 0;
      if (!v) return '';
      return `<span class="stack-seg" style="width:${((v / tot) * 100).toFixed(2)}%;background:${TYPE_COLOR[t]}" data-tip="${esc(s.label)}&#10;${esc(TYPE_LABEL[t])}: ${esc(num(v))} fires (${esc(pct(v, tot))})"></span>`;
    }).join('')}</span>
      <span class="stack-val">${esc(num(tot))}</span>
    </div>`;
  }).join('')}</div>`;

  el.querySelector('#sz-type-legend')!.innerHTML = legend(
    types.map((t) => ({ color: TYPE_COLOR[t], label: TYPE_LABEL[t] })),
  );
}
