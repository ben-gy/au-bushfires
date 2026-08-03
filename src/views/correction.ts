// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The view that justifies every other number on the site.

import type { FireData } from '../types';
import { STATE_COLOR } from '../colors';
import { ha, km2, num, season as fmtSeason, esc } from '../format';
import { g } from '../glossary';
import { card, statRow, viewHead } from './ui';
import { barChart } from './charts';

export function mount(el: HTMLElement, data: FireData): void {
  const c = data.correction;
  const bs = c.blackSummer;
  const ratio = bs.corrected ? bs.naive / bs.corrected : 0;

  el.innerHTML = `
    ${viewHead({
    title: 'Why most published totals are too big',
    question: 'If you add up this dataset the obvious way, how wrong is the answer?',
    blurb: `Nearly double. This is not a rounding argument — it is a structural feature of how ${g('multipart', 'multi-part fires')} are stored, and it catches almost everyone who uses the file.`,
  })}

    ${statRow([
    { value: ha(bs.naive), label: 'Black Summer, summed naively', sub: 'the wrong answer', tone: 'bad' },
    { value: ha(bs.corrected), label: 'Black Summer, corrected', sub: 'one row per fire', tone: 'good' },
    { value: `${ratio.toFixed(2)}×`, label: 'Overstatement', sub: `${ha(bs.naive - bs.corrected)} of phantom fire`, tone: 'warn' },
    { value: num(data.core.totals.rawRows), label: 'Rows in the source', sub: `for ${num(data.core.totals.fires)} actual fires`, tone: 'dom' },
  ])}

    <section class="card">
      <div class="card-head">
        <h2>The fire that is stored twenty-three times</h2>
        <p>A worked example, checked against the source service.</p>
      </div>
      <div class="explain">
        <p>Western Australia's <strong>BF 2019 ESP 013</strong> burnt <strong>162,367 hectares</strong> near Esperance in the 2019–20 season. It did not burn one continuous shape — it left twenty-three separate patches of burnt ground.</p>
        <p>The dataset stores one row per patch. Each of those twenty-three rows carries a different polygon, but <strong>every one of them repeats the same <code>area_ha</code> value of 162,367</strong> and the same perimeter. Add the column up and this single fire contributes <strong>3.7 million hectares</strong> instead of 162,367.</p>
        <p>You can verify the polygons really are parts of one fire rather than separate fires: their individual geometries differ by up to 42× in size, and their true areas <em>sum</em> to about 162,000 ha — exactly the figure each row claims on its own.</p>
        <p class="explain-rule">The fix is to keep one row per fire, grouping on state, fire ID, ignition date, area and perimeter together. The fire ID alone is not enough: thousands of records carry no ID at all, and placeholder values like <code>999</code> are reused across unrelated fires.</p>
      </div>
    </section>

    ${card('The twelve worst offenders',
    'Fires whose repeated rows inflate the national total the most. Bar length is the phantom area each one adds.',
    '<div id="cx-worst"></div>')}

    <section class="card">
      <div class="card-head">
        <h2>Black Summer, rebuilt from the source</h2>
        <p>The 2019–20 season by state, naive against corrected. The corrected NSW figure is what makes this checkable.</p>
      </div>
      <div class="tbl-wrap"><table class="data">
        <thead><tr>
          <th scope="col">State</th><th scope="col" class="num">Rows</th><th scope="col" class="num">Fires</th>
          <th scope="col" class="num">Naive total</th><th scope="col" class="num">Corrected</th><th scope="col" class="num">Overstated by</th>
        </tr></thead>
        <tbody>${bs.table.map((r) => {
    const over = r.corrected ? r.naive / r.corrected : 1;
    return `<tr>
            <td><span class="pill" style="background:${STATE_COLOR[r.state]}1f;color:${STATE_COLOR[r.state]}">${esc(r.state)}</span> ${esc(r.name)}</td>
            <td class="num">${esc(num(r.rows))}</td>
            <td class="num">${esc(num(r.fires))}</td>
            <td class="num naive">${esc(ha(r.naive))}</td>
            <td class="num">${esc(ha(r.corrected))}</td>
            <td class="num"><strong class="${over > 1.5 ? 'bad' : over > 1.05 ? 'warn' : 'ok'}">${over > 1.005 ? esc(`${over.toFixed(2)}×`) : '—'}</strong></td>
          </tr>`;
  }).join('')}
        <tr class="total-row">
          <td><strong>Australia</strong></td><td class="num">—</td><td class="num">—</td>
          <td class="num naive">${esc(ha(bs.naive))}</td><td class="num"><strong>${esc(ha(bs.corrected))}</strong></td>
          <td class="num"><strong class="bad">${esc(`${ratio.toFixed(2)}×`)}</strong></td>
        </tr>
        </tbody></table></div>
      <div class="note-band">
        <strong>Two external checks.</strong>
        New South Wales in 2019–20 comes out at <strong>${esc(ha(bs.table.find((r) => r.state === 'NSW')?.corrected ?? 0))}</strong>, against the widely published figure of about 5.5 million hectares.
        ${bs.orroral ? `The largest fire in the ACT that season is <strong>${esc(bs.orroral.name)}</strong> at <strong>${esc(num(bs.orroral.area))} ha</strong>, against the Orroral Valley fire's published ~87,000 ha.` : ''}
        Both are asserted in this project's build: if a change to the parser breaks the correction, the build fails rather than quietly publishing doubled numbers.
      </div>
    </section>

    ${card('Two other traps in the same data',
    'Both silently change the answer rather than producing an error.',
    `<div class="findings">
        <article class="finding finding-warn">
          <h3>Three services that overlap by three seasons</h3>
          <p>The historical layer runs to October 2023 and the 2020–25 layer starts July 2020, and they contain the same fires — Victoria's 2021–22 season appears as 2,046 rows in one and 2,066 in the other. Combining them adds three seasons twice. This site cuts over at 1 July 2020 and asserts that no historical record crosses that line.</p>
        </article>
        <article class="finding finding-warn">
          <h3>The boundaries come back in the wrong projection</h3>
          <p>The council boundaries used for the regional view are served in Web Mercator, not the latitude/longitude the fire service expects. Passing them straight through returns a count of zero for every council — not an error, just an empty answer that looks like "nothing ever burnt here".</p>
        </article>
      </div>`)}

    ${card('What "cumulative area" does not mean',
    'The most common misreading of a long fire record.',
    `<p class="explain-p">This site's headline total is <strong>${esc(ha(data.core.totals.correctedArea))}</strong> across ${esc(String(data.seasons.length))} seasons. Australia is about 769 million hectares in total, so that figure is a large fraction of the continent — and it does <em>not</em> mean that much of Australia has burnt. It is ${g('cumulative', 'cumulative')}: the same country burns repeatedly, and every burn counts again. Some rangeland in the north has burnt more than a dozen times since 1899. There is no way to derive distinct land area from this data without intersecting all ${esc(num(data.core.totals.fires))} polygons against each other, which the source does not do and neither does this site.</p>`)}
  `;

  el.querySelector('#cx-worst')!.innerHTML = barChart(c.worst.map((w, i) => ({
    key: String(i),
    label: `${w.name ?? `Fire ${w.fireId}`} (${w.state ?? '—'})`,
    value: w.inflation,
    color: w.state ? STATE_COLOR[w.state] : '#8b8178',
    sub: `${w.copies} copies · ${fmtSeason(w.season)}`,
    tip: `${w.name ?? `Fire ${w.fireId}`}\nID ${w.fireId} · ${w.state ?? 'unknown state'} · ${fmtSeason(w.season)}\nActual size: ${ha(w.area)} (${km2(w.area)})\nStored ${w.copies} times → adds ${ha(w.inflation)} of phantom area`,
  })), { format: ha });
}
