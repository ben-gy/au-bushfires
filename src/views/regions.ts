// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// "Has my area burnt?" — the only view on this site that is personal.
//
// A note on the numbers, because it is easy to publish a wrong one here. A fire
// counts for a council if any part of it intersects the boundary, and the size
// shown is the WHOLE fire. Blue Mountains therefore records ~1.0 M ha of fire
// against a council of ~143,000 ha, because Gospers Mountain alone was 479,514
// ha and most of it burnt elsewhere. Ranking councils by that number would be
// meaningless, so the default ranking is seasons-with-fire, and every place the
// area appears it is labelled "combined size of those fires".

import type { FireData, Region } from '../types';
import { STATE_COLOR, rampColor, RAMP } from '../colors';
import { STATE_LABEL, ha, num, season as fmtSeason, esc, slug as mkSlug, name as cleanName } from '../format';
import { g } from '../glossary';
import { card, onSeg, seg, statRow, viewHead } from './ui';
import { openDrawer } from '../drawer';
import { seasonsBurnt } from '../analysis';

type Metric = 'seasons' | 'fires' | 'area';

export function mount(el: HTMLElement, data: FireData, _go: (v: string) => void, params: URLSearchParams): void {
  let metric: Metric = 'seasons';
  let query = '';
  let stateFilter = '';

  const regions = data.regions.filter((r) => r.fires > 0);
  const withFire = regions.length;
  const noFire = data.regions.length - withFire;
  const lastSeason = data.core.totals.lastSeason;

  const val = (r: Region): number => (
    metric === 'seasons' ? seasonsBurnt(r) : metric === 'fires' ? r.fires : r.area
  );

  const mostSeasons = [...regions].sort((a, b) => seasonsBurnt(b) - seasonsBurnt(a))[0];
  const recent = regions.filter((r) => r.lastSeason === lastSeason).length;

  el.innerHTML = `
    ${viewHead({
    title: 'Has your area burnt?',
    question: 'Which fires have reached your council area, how often, and when was the last one?',
    blurb: `Every mapped fire intersected against all ${num(data.regions.length)} Australian ${g('lga', 'council areas')}. Search for yours.`,
  })}

    ${statRow([
    { value: num(withFire), label: 'Councils with mapped fire', sub: `${num(noFire)} have none on record`, tone: 'dom' },
    { value: mostSeasons ? String(seasonsBurnt(mostSeasons)) : '—', label: 'Most seasons with fire', sub: mostSeasons ? mostSeasons.name : '', tone: 'bad' },
    { value: num(recent), label: `Councils with fire in ${fmtSeason(lastSeason)}`, sub: 'the most recent season on record', tone: 'warn' },
  ])}

    <section class="card">
      <div class="card-head">
        <h2>Find your council</h2>
        <p>Type a council, suburb-region or shire name. Click any row for its full fire history.</p>
      </div>
      <div class="ctl-row">
        <input type="search" id="rg-q" placeholder="Search 547 council areas…" aria-label="Search council areas" autocomplete="off" />
        <label class="sel-lab">State
          <select id="rg-state" aria-label="Filter by state">
            <option value="">All</option>
            ${Object.entries(STATE_LABEL).map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('')}
          </select>
        </label>
        ${seg('metric', [
    { id: 'seasons', label: 'Seasons' },
    { id: 'fires', label: 'Fires' },
    { id: 'area', label: 'Fire size' },
  ], 'seasons', 'Rank by')}
      </div>
      <p class="ctl-note" id="rg-caveat"></p>
      <div id="rg-table"></div>
    </section>

    ${card('The ramp', 'Colour shows the ranked metric on a log scale — never a quantile scale, which would make a single grass fire look like a megafire.',
    `<div class="legend"><span class="ramp">${RAMP.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
       <span class="legend-item">fewer</span><span class="legend-item">more</span></div>`)}
  `;

  const caveat = el.querySelector('#rg-caveat')!;
  const host = el.querySelector('#rg-table') as HTMLElement;

  const openRegion = (s: string) => {
    const r = data.regions.find((x) => x.slug === s);
    if (!r) return;
    const yrs = Object.keys(r.seasons).map(Number).sort((a, b) => a - b);
    const maxYr = Math.max(1, ...Object.values(r.seasons));
    const gap = r.lastSeason == null ? null : lastSeason - r.lastSeason;

    openDrawer(r.name, `
      <h3>Fire history</h3>
      <dl class="kv">
        <dt>State</dt><dd>${esc(r.state ? STATE_LABEL[r.state] : 'Not recorded')}</dd>
        <dt>Seasons with fire</dt><dd>${esc(String(seasonsBurnt(r)))}</dd>
        <dt>Fires that reached it</dt><dd>${esc(num(r.fires))}</dd>
        <dt>— bushfires</dt><dd>${esc(num(r.bushfires))}</dd>
        <dt>— prescribed burns</dt><dd>${esc(num(r.prescribed))}</dd>
        <dt>First on record</dt><dd>${esc(fmtSeason(r.firstSeason))}</dd>
        <dt>Most recent</dt><dd>${esc(fmtSeason(r.lastSeason))}${gap != null && gap > 0 ? esc(` (${gap} season${gap === 1 ? '' : 's'} ago)`) : ''}</dd>
      </dl>

      ${r.biggest ? `<h3>Largest fire to reach here</h3>
        <p><strong>${esc(cleanName(r.biggest.name) ?? 'Unnamed fire')}</strong> — ${esc(ha(r.biggest.area))}, ${esc(fmtSeason(r.biggest.season))}.</p>
        <p class="drawer-note">That is the fire's total size. Only part of it may have burnt inside ${esc(r.name)}.</p>` : ''}

      <h3>Fires per season</h3>
      ${yrs.length ? `<div class="spark">${yrs.map((y) => {
      const v = r.seasons[String(y)] ?? 0;
      return `<span class="spark-bar" style="height:${Math.max(8, (v / maxYr) * 100)}%;background:${rampColor(v, maxYr)}" data-tip="${esc(fmtSeason(y))}&#10;${esc(num(v))} fires"></span>`;
    }).join('')}</div>
      <p class="drawer-note">${esc(fmtSeason(yrs[0]))} to ${esc(fmtSeason(yrs[yrs.length - 1]))}. Gaps are seasons with no mapped fire.</p>`
      : '<p>No fires on record.</p>'}

      <h3>How to read this</h3>
      <p>A fire counts here if any part of its mapped boundary falls inside the council. Sizes are the whole fire, including ground burnt in neighbouring councils — so the combined figure can exceed the council's own area. It measures fire arriving, not the share of the council burnt.</p>
    `);
  };

  const paint = () => {
    const q = query.trim().toLowerCase();
    let rows = data.regions.filter((r) => (
      (!q || r.name.toLowerCase().includes(q))
      && (!stateFilter || r.state === stateFilter)
    ));
    rows = rows.sort((a, b) => val(b) - val(a) || a.name.localeCompare(b.name));
    const max = Math.max(1, ...rows.map(val));

    caveat.innerHTML = metric === 'area'
      ? `Ranking by combined fire size. ${g('reached', 'Each fire counts in full')}, including the parts that burnt in other councils — so this is not the share of a council that burnt.`
      : metric === 'seasons'
        ? `Ranking by ${g('times_burnt', 'seasons with at least one fire')} — the measure least distorted by fires that mostly burnt elsewhere.`
        : `Ranking by the number of fires whose boundary ${g('reached', 'reached this council')}.`;

    host.innerHTML = `<div class="tbl-wrap"><table class="data">
      <thead><tr>
        <th scope="col">#</th><th scope="col">Council area</th><th scope="col">State</th>
        <th scope="col" class="num">Seasons</th><th scope="col" class="num">Fires</th>
        <th scope="col" class="num">Combined size</th><th scope="col">Last fire</th><th scope="col">Largest fire</th>
      </tr></thead>
      <tbody>${rows.length ? rows.slice(0, 200).map((r, i) => `
        <tr class="clickable" data-row="${esc(r.slug)}" tabindex="0">
          <td class="num">${i + 1}</td>
          <td><span class="swatch-inline" style="background:${rampColor(val(r), max)}"></span>${esc(r.name)}</td>
          <td><span class="pill" style="background:${r.state ? `${STATE_COLOR[r.state]}1f` : 'var(--bg-elevated)'};color:${r.state ? STATE_COLOR[r.state] : 'var(--text-secondary)'}">${esc(r.state ?? '—')}</span></td>
          <td class="num">${esc(String(seasonsBurnt(r)))}</td>
          <td class="num">${esc(num(r.fires))}</td>
          <td class="num" data-tip="Combined size of every fire that reached ${esc(r.name)},&#10;counted in full including ground outside the council.">${esc(ha(r.area))}</td>
          <td>${esc(fmtSeason(r.lastSeason))}</td>
          <td class="wide">${cleanName(r.biggest?.name) ? esc(cleanName(r.biggest?.name)) : '<span class="muted">—</span>'}</td>
        </tr>`).join('')
      : `<tr><td colspan="8" class="wide">No council area matches “${esc(query)}”.</td></tr>`}
      </tbody></table></div>
      ${rows.length > 200 ? `<p class="ctl-note">Showing the top 200 of ${num(rows.length)} matching councils — narrow the search to see more.</p>` : ''}`;

    host.querySelectorAll<HTMLElement>('tr[data-row]').forEach((tr) => {
      const open = () => openRegion(tr.dataset.row!);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); open(); }
      });
    });
  };

  paint();
  onSeg(el, 'metric', (v) => { metric = v as Metric; paint(); });

  // Search is debounced: repainting a 547-row table on every keystroke is
  // wasted work on a phone.
  let timer: number | undefined;
  el.querySelector('#rg-q')!.addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { query = v; paint(); }, 300);
  });
  el.querySelector('#rg-state')!.addEventListener('change', (e) => {
    stateFilter = (e.target as HTMLSelectElement).value;
    paint();
  });

  const deep = params.get('lga');
  if (deep) openRegion(mkSlug(deep));
}
