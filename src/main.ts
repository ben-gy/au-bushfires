// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import './styles.css';
import type { FireData } from './types';
import { loadData } from './data';
import { initTooltip } from './components/tooltip';
import { initGlossary, hideGloss } from './glossary';
import { closeDrawer } from './drawer';
import { ha, num, isoDate, esc, season as fmtSeason } from './format';
import { openModal } from './views/ui';

import { mount as overview } from './views/overview';
import { mount as regions } from './views/regions';
import { mount as mapView } from './views/map';
import { mount as seasons } from './views/seasons';
import { mount as sizes } from './views/sizes';
import { mount as causes } from './views/causes';
import { mount as correction } from './views/correction';
import { mount as live } from './views/live';

type ViewFn = (
  el: HTMLElement,
  data: FireData,
  go: (view: string) => void,
  params: URLSearchParams,
) => void | (() => void);

interface Tab { id: string; label: string; fn: ViewFn }

// Tab labels are words only — never counts. A number in a tab is stale the
// moment a filter changes and reads as a notification badge.
const TABS: Tab[] = [
  { id: 'overview', label: 'Overview', fn: overview },
  { id: 'regions', label: 'Your area', fn: regions },
  { id: 'map', label: 'Map', fn: (el, d) => mapView(el, d) },
  { id: 'seasons', label: 'Seasons', fn: seasons },
  { id: 'sizes', label: 'Fire size', fn: (el, d) => sizes(el, d) },
  { id: 'causes', label: 'Causes', fn: (el, d) => causes(el, d) },
  { id: 'coverage', label: 'Coverage', fn: (el, d) => coverageLazy(el, d) },
  { id: 'correction', label: 'The correction', fn: (el, d) => correction(el, d) },
  { id: 'live', label: 'Right now', fn: (el) => live(el) },
];

// Imported lazily only to keep the module graph readable; it is a normal import.
import { mount as coverageLazy } from './views/coverage';

let cleanup: (() => void) | void;
let data: FireData;
let currentView = '';

function parseHash(): { view: string; params: URLSearchParams } {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  return { view: p.get('view') || 'overview', params: p };
}

function aboutHtml(): string {
  const t = data.core.totals;
  return `
    <h2>About this site</h2>
    <p>Australia's state and territory fire agencies map the boundary of nearly every fire they attend. Geoscience Australia compiles those maps into a single national dataset and publishes it openly. This site is that dataset, made usable.</p>

    <h3>What it contains</h3>
    <p><strong>${esc(num(t.fires))}</strong> distinct fires between ${esc(fmtSeason(t.firstSeason))} and ${esc(fmtSeason(t.lastSeason))}, covering <strong>${esc(ha(t.correctedArea))}</strong> of cumulative burnt area. "Cumulative" matters: the same ground burns repeatedly and every burn is counted again, so this is not a measure of how much of Australia has burnt.</p>

    <h3>The correction</h3>
    <p>The source file stores a fire made of several separate burnt patches as one row per patch — and repeats the whole fire's area on every one of those rows. Summing the area column therefore multiplies large fires by their patch count. For the 2019–20 season it returns 31.8 million hectares instead of 16.5 million.</p>
    <p>This site collapses repeated rows to one record per fire, grouping on state, fire ID, ignition date, area and perimeter together. Every rebuild asserts three things before it writes anything: that New South Wales in 2019–20 lands near the NSW Bushfire Inquiry's 5,520,000 hectares, that the ACT's Orroral Valley fire lands near 87,000 hectares, and that the naive total still overstates the corrected one by at least 1.9×.</p>
    <p>The first two check <em>accuracy</em>; only the third checks the <em>correction</em>, because New South Wales and the ACT contain almost no multi-part records — de-duplicating NSW changes it by 337 hectares. The ratio is what would catch the de-duplication silently breaking, and it did catch exactly that during this site's construction.</p>

    <h3>Known limits</h3>
    <ul>
      <li><strong>The Northern Territory is missing before ${esc(fmtSeason(data.states.find((s) => s.code === 'NT')?.firstSeason ?? 2020))}.</strong> Not because it did not burn — it simply is not in the national historical layer.</li>
      <li><strong>About 89% of fires have no recorded cause.</strong> Every cause figure describes the remainder, which is not a random sample.</li>
      <li><strong>Records per state reflect mapping effort as well as fire.</strong> Western Australia holds over half of all records. The Coverage view exists to make that visible.</li>
      <li><strong>Council figures count whole fires.</strong> A fire counts for a council if any part of it falls inside, at its full size — so a council's combined figure can exceed its own land area.</li>
      <li><strong>The map draws fires of 5,000 hectares and above only.</strong> Smaller fires are counted in every statistic but there are too many to draw.</li>
      <li><strong>The archive lags.</strong> History is stitched from two releases at 1 July 2020; the current season appears only in the live view.</li>
    </ul>

    <h3>Where the data comes from</h3>
    <ul>
      <li><strong>Digital Atlas of Australia — Historical Bushfire Boundaries v2.0</strong> and <strong>Historical Bushfire Extents 2020–25</strong>, compiled by the National Bushfire Intelligence Capability. © Commonwealth of Australia (Geoscience Australia), licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. <a href="https://digital.atlas.gov.au/" target="_blank" rel="noopener">digital.atlas.gov.au</a></li>
      <li><strong>Digital Atlas — Near Real-Time Bushfire Extents</strong>, same licence, fetched live in your browser.</li>
      <li><strong>NSW Rural Fire Service</strong> major incidents feed, fetched live in your browser.</li>
      <li><strong>Australian Bureau of Statistics</strong> — ASGS 2021 council and state boundaries, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</li>
    </ul>
    <p>Victoria's emergency feed is deliberately absent: it sends no cross-origin header, so a browser is not permitted to read it.</p>
    <p>Data processed on ${esc(isoDate(data.core.generated))} and refreshed quarterly. This site is not affiliated with Geoscience Australia, the NSW RFS or any fire agency.</p>

    <h3>In an emergency</h3>
    <p>This is a historical research tool, not a warning service. For current warnings and advice always use your state emergency service, or call 000.</p>
  `;
}

function render(): void {
  const { view, params } = parseHash();
  const tab = TABS.find((t) => t.id === view) ?? TABS[0];

  document.querySelectorAll('.tabs a').forEach((a) => {
    a.classList.toggle('active', (a as HTMLAnchorElement).dataset.view === tab.id);
  });

  // Re-running a view for a deep-link change (e.g. ?lga=) would tear down and
  // rebuild the whole DOM, which loses scroll position and remounts Leaflet.
  const host = document.getElementById('view-host') as HTMLElement;
  if (currentView !== tab.id) {
    if (typeof cleanup === 'function') cleanup();
    cleanup = undefined;
    closeDrawer(false);
    hideGloss();
    host.innerHTML = '';
    currentView = tab.id;
    cleanup = tab.fn(host, data, go, params) ?? undefined;
    window.scrollTo({ top: 0 });
  }
}

function go(view: string): void {
  location.hash = `view=${view}`;
}

function shell(): string {
  return `
    <a class="skip" href="#view-host">Skip to content</a>
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="#view=overview">
          <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 3c1.7 4.4.4 6.9-1.7 9.2-2.3 2.5-4.8 4.8-4.8 8.6A6.7 6.7 0 0 0 16 27.6a6.7 6.7 0 0 0 6.5-6.8c0-2.7-1.3-4.6-2.5-6.5-.5 1.3-1.3 2.1-2.2 2.6.6-3.6-.3-7.2-1.8-13.9Z" fill="currentColor"/>
          </svg>
          <span class="brand-txt"><strong>Bushfires</strong><small>Australia, 1899–present</small></span>
        </a>
        <nav class="tabs" aria-label="Views">
          ${TABS.map((t) => `<a href="#view=${t.id}" data-view="${t.id}">${esc(t.label)}</a>`).join('')}
        </nav>
        <button class="about-btn" id="about-btn" aria-label="About this site" title="About this site">?</button>
      </div>
    </header>
    <main class="main-content" id="view-host"></main>
    <footer class="site-footer">
      <div class="footer-inner">
        <span>Fire boundaries: <a href="https://digital.atlas.gov.au/" target="_blank" rel="noopener">Digital Atlas of Australia</a> © Commonwealth of Australia (Geoscience Australia), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.
        Boundaries: <a href="https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3" target="_blank" rel="noopener">ABS ASGS 2021</a> © Commonwealth of Australia (Australian Bureau of Statistics), CC BY 4.0.
        Live incidents: © State of New South Wales (<a href="https://www.rfs.nsw.gov.au/" target="_blank" rel="noopener">NSW Rural Fire Service</a>), CC BY 4.0 — for current information go to rfs.nsw.gov.au.
        <br><em>Changes made:</em> fire records have been de-duplicated and area totals corrected; boundaries have been simplified. Neither Geoscience Australia, the ABS nor the NSW RFS endorse this analysis.</span>
        <span>Built by <a href="https://benrichardson.dev/">benrichardson.dev</a> · <a href="https://lab.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a></span>
      </div>
    </footer>
  `;
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  app.innerHTML = `${shell()}`;
  const host = document.getElementById('view-host')!;
  host.innerHTML = `<div class="loading"><div class="skeleton" style="height:120px"></div>
    <p style="margin-top:14px">Loading Australia’s fire record…</p></div>`;

  initTooltip();
  initGlossary();

  document.getElementById('about-btn')!.addEventListener('click', () => openModal('About this site', aboutHtml()));

  const ctrl = new AbortController();
  try {
    data = await loadData(ctrl.signal);
  } catch (err) {
    host.innerHTML = `<div class="error">
      <p><strong>The data failed to load.</strong> ${esc((err as Error).message)}</p>
      <p><button class="btn" id="reload">Try again</button></p>
    </div>`;
    document.getElementById('reload')?.addEventListener('click', () => location.reload());
    return;
  }

  window.addEventListener('hashchange', render);
  render();
}

boot();
