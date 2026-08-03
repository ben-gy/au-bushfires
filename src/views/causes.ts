// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { FireData, StateCode } from '../types';
import { CAUSE_COLOR, rampColor, RAMP } from '../colors';
import { STATES, STATE_LABEL, CAUSE_LABEL, TYPE_LABEL, ha, num, pct, esc } from '../format';
import { g } from '../glossary';
import { card, onSeg, seg, statRow, viewHead } from './ui';
import { barChart, matrix } from './charts';
import { openDrawer } from '../drawer';

type Measure = 'fires' | 'area';

export function mount(el: HTMLElement, data: FireData): void {
  let measure: Measure = 'fires';

  const known = data.causes.filter((c) => c.cause !== 'unknown');
  const knownFires = known.reduce((a, c) => a + c.fires, 0);
  const unknown = data.causes.find((c) => c.cause === 'unknown');
  const total = data.core.totals.fires;
  const light = data.causes.find((c) => c.cause === 'lightning');
  const delib = data.causes.find((c) => c.cause === 'deliberate');
  const present = known.filter((c) => c.fires > 0);

  // Prescribed burns are lit deliberately by definition, yet essentially none
  // carry a recorded cause — the single clearest demonstration that the cause
  // field describes what agencies investigate, not what happens.
  const prescribedFires = data.core.types.find((t) => t.type === 'prescribed')?.fires ?? 0;
  const prescribedNoCause = data.causes.find((c) => c.cause === 'unknown')?.byType.prescribed ?? 0;

  el.innerHTML = `
    ${viewHead({
    title: 'What starts Australian bushfires',
    question: 'Which causes light the most fires — and which burn the most ground?',
    blurb: `They are not the same answer. But read the coverage warning first: this describes the ${g('ignition_cause', 'small minority')} of fires anyone recorded a cause for.`,
  })}

    <div class="coverage-strip" data-tip="${esc(num(knownFires))} of ${esc(num(total))} fires carry a recorded ignition cause.">
      <div class="coverage-bar">
        <span class="coverage-known" style="width:${((knownFires / total) * 100).toFixed(2)}%"></span>
      </div>
      <p><strong>${esc(pct(knownFires, total))}</strong> of the ${esc(num(total))} fires in this archive have a recorded cause —
      ${esc(num(unknown?.fires ?? 0))} do not. Everything below describes that ${esc(pct(knownFires, total))}, and it is not a random
      sample: investigated fires skew towards the ones that threatened people or property.</p>
    </div>

    ${statRow([
    { value: delib ? num(delib.fires) : '—', label: 'Deliberately lit', sub: delib ? `${pct(delib.fires, knownFires)} of known causes` : '', tone: 'bad' },
    { value: light ? num(light.fires) : '—', label: 'Started by lightning', sub: light ? `${pct(light.fires, knownFires)} of known causes` : '', tone: 'dom' },
    {
      value: light && delib && delib.medianArea ? `${(light.medianArea / delib.medianArea).toFixed(0)}×` : '—',
      label: 'Lightning fires are bigger',
      sub: light && delib ? `median ${num(light.medianArea)} ha vs ${num(delib.medianArea)} ha` : '',
      tone: 'warn',
      tip: light && delib
        ? `Typical (median) sizes: lightning ${num(light.medianArea)} ha, deliberate ${num(delib.medianArea)} ha.\nBy mean it is ${(light.meanArea / delib.meanArea).toFixed(1)}× — but the mean is distorted by a handful of enormous fires and by the ${num(delib.zeroArea)} deliberate records with no area recorded at all.\nThe median says the same thing without being hostage to either.`
        : undefined,
    },
  ])}

    <section class="card">
      <div class="card-head">
        <h2>Cause by state</h2>
        <p>Rows are causes, columns are states. Colour is the value on a log scale. Click any cell for the detail.</p>
      </div>
      <div class="ctl-row">
        ${seg('measure', [{ id: 'fires', label: 'Number of fires' }, { id: 'area', label: 'Area burnt' }], 'fires', 'Measure')}
        <span class="legend"><span class="ramp">${RAMP.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
        <span class="legend-item">lower</span><span class="legend-item">higher</span></span>
      </div>
      <div id="cz-matrix"></div>
    </section>

    ${card('Common versus destructive',
    'The clearest finding in this data: the causes that light the most fires are not the causes that burn the most ground.',
    `<div class="split2">
        <div><h3 class="sub-h">Number of fires</h3><div id="cz-count"></div></div>
        <div><h3 class="sub-h">Typical size (median)</h3><div id="cz-median"></div></div>
      </div>
      <p class="ctl-note">Lightning strikes remote country where a fire can run for weeks before anyone reaches it. Deliberately lit fires start where people are, which is also where they get put out.</p>
      <p class="ctl-note"><strong>Median, not mean.</strong> The average is badly distorted here: a single 1.7 million hectare fire dominates one category, and thousands of records carry no area at all. The median is the size of the middle fire, and it makes the same point far more robustly.</p>`)}

    ${card('Cause by fire type',
    'Prescribed burns are the clearest case of missing cause data: they are lit deliberately by definition, yet essentially none carry a recorded ignition cause at all.',
    `<div id="cz-type"></div>
      <p class="ctl-note">Of the ${esc(num(prescribedFires))} fires typed as prescribed burns, ${esc(num(prescribedNoCause))} have no recorded cause — the agencies simply do not fill the field in for planned burning. This is why the cause figures above cannot be read as describing Australian fire in general.</p>`)}
  `;

  const paintMatrix = () => {
    el.querySelector('#cz-matrix')!.innerHTML = matrix({
      rows: present.map((c) => ({ key: c.cause, label: CAUSE_LABEL[c.cause] ?? c.cause })),
      cols: STATES.map((s) => ({ key: s, label: s })),
      value: (rk, ck) => {
        const c = data.causes.find((x) => x.cause === rk);
        if (!c) return 0;
        return measure === 'fires'
          ? (c.byState[ck as StateCode] ?? 0)
          : (c.areaByState?.[ck as StateCode] ?? 0);
      },
      format: measure === 'fires' ? num : ha,
      color: rampColor,
      rowTotal: (rk) => {
        const c = data.causes.find((x) => x.cause === rk);
        return c ? (measure === 'fires' ? num(c.fires) : ha(c.area)) : '—';
      },
      clickable: true,
    });

    el.querySelectorAll<HTMLElement>('#cz-matrix .mark-click').forEach((cell) => {
      const open = () => {
        const c = data.causes.find((x) => x.cause === cell.dataset.row);
        const st = cell.dataset.col as StateCode;
        if (!c) return;
        openDrawer(`${CAUSE_LABEL[c.cause] ?? c.cause} in ${STATE_LABEL[st]}`, `
          <h3>In ${esc(STATE_LABEL[st])}</h3>
          <dl class="kv">
            <dt>Fires with this cause</dt><dd>${esc(num(c.byState[st] ?? 0))}</dd>
            <dt>Area burnt in this state</dt><dd>${esc(ha(c.areaByState?.[st] ?? 0))}</dd>
            <dt>Share of the state's known causes</dt><dd>${esc(pct(c.byState[st] ?? 0, sumStateKnown(data, st)))}</dd>
          </dl>
          <h3>Nationally</h3>
          <dl class="kv">
            <dt>Fires</dt><dd>${esc(num(c.fires))}</dd>
            <dt>Total area</dt><dd>${esc(ha(c.area))}</dd>
            <dt>Average size</dt><dd>${esc(num(c.meanArea))} ha</dd>
          </dl>
          <h3>By fire type</h3>
          <ul class="variant-list">
            ${(['bushfire', 'prescribed', 'unknown'] as const).filter((t) => (c.byType[t] ?? 0) > 0)
    .map((t) => `<li><span>${esc(TYPE_LABEL[t])}</span><span>${esc(num(c.byType[t] ?? 0))}</span></li>`).join('')}
          </ul>
          <p class="drawer-note">Counts and areas are for fires whose cause was actually recorded — a minority of all fires, and not a random one.</p>
        `);
      };
      cell.addEventListener('click', open);
      cell.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); open(); }
      });
    });
  };

  paintMatrix();
  onSeg(el, 'measure', (v) => { measure = v as Measure; paintMatrix(); });

  el.querySelector('#cz-count')!.innerHTML = barChart(
    [...present].sort((a, b) => b.fires - a.fires).map((c) => ({
      key: c.cause,
      label: CAUSE_LABEL[c.cause] ?? c.cause,
      value: c.fires,
      color: CAUSE_COLOR[c.cause],
      tip: `${CAUSE_LABEL[c.cause]}\n${num(c.fires)} fires (${pct(c.fires, knownFires)} of known causes)`,
    })), { format: num },
  );

  el.querySelector('#cz-median')!.innerHTML = barChart(
    [...present].sort((a, b) => b.medianArea - a.medianArea).map((c) => ({
      key: c.cause,
      label: CAUSE_LABEL[c.cause] ?? c.cause,
      value: c.medianArea,
      color: CAUSE_COLOR[c.cause],
      tip: `${CAUSE_LABEL[c.cause]}\nMedian ${num(c.medianArea)} ha per fire\nMean ${num(c.meanArea)} ha (distorted by outliers)\n${num(c.zeroArea)} of ${num(c.fires)} records have no area recorded\n${ha(c.area)} burnt in total`,
    })), { format: (n) => `${num(n)} ha` },
  );

  el.querySelector('#cz-type')!.innerHTML = matrix({
    rows: present.map((c) => ({ key: c.cause, label: CAUSE_LABEL[c.cause] ?? c.cause })),
    cols: (['bushfire', 'prescribed', 'unknown'] as const).map((t) => ({ key: t, label: TYPE_LABEL[t] })),
    value: (rk, ck) => data.causes.find((x) => x.cause === rk)?.byType[ck as 'bushfire'] ?? 0,
    format: num,
    color: rampColor,
  });
}

function sumStateKnown(data: FireData, st: StateCode): number {
  return data.causes.filter((c) => c.cause !== 'unknown').reduce((a, c) => a + (c.byState[st] ?? 0), 0);
}
