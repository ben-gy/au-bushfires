// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Real fire-scar polygons on a Leaflet map.
//
// Geometry provenance: every ring here comes from the Digital Atlas service and
// is simplified with mapshaper in the pipeline. Nothing is hand-authored.
//
// The wrapper carries `isolation: isolate; z-index: 0` (see styles.css) so
// Leaflet's own panes — which it numbers up to 1000 — stay contained and cannot
// paint over the About modal or the drill-down drawer.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { FireData, FireType } from '../types';
import { TYPE_COLOR } from '../colors';
import { TYPE_LABEL, ha, km2, num, season as fmtSeason, esc } from '../format';
import { g } from '../glossary';
import { onSeg, seg, viewHead, legend } from './ui';
import { loadFireShapes, loadStateShapes } from '../data';

interface FireProps { n: string | null; s: string | null; y: number | null; a: number; t: FireType }

export function mount(el: HTMLElement, data: FireData): () => void {
  let map: L.Map | null = null;
  let layer: L.GeoJSON | null = null;
  let typeFilter: FireType | 'all' = 'all';
  let minSeason = 1899;
  let destroyed = false;

  const lastSeason = data.core.totals.lastSeason;

  el.innerHTML = `
    ${viewHead({
    title: 'Where Australia has burnt',
    question: 'What do a century of fire scars actually look like on the ground?',
    blurb: `Every mapped fire of 5,000 hectares or more — ${g('fire_scar', 'the outline of ground that burnt')}, not of damage. Smaller fires are omitted here only because there are too many to draw; they are all counted everywhere else on this site.`,
  })}

    <div class="ctl-row">
      ${seg('ftype', [
    { id: 'all', label: 'All fires' },
    { id: 'bushfire', label: 'Bushfire' },
    { id: 'prescribed', label: 'Prescribed' },
  ], 'all', 'Fire type')}
      <label class="year-ctl">From season
        <input type="range" id="mp-year" min="1899" max="${lastSeason}" value="1899" step="1" aria-label="Earliest season to show" />
        <output id="mp-year-out">${esc(fmtSeason(1899))}</output>
      </label>
      <span class="ctl-note" id="mp-count"></span>
    </div>

    <div class="map-wrap">
      <div class="map-canvas" id="mp-canvas" role="application" aria-label="Map of Australian fire scars"></div>
    </div>
    <div id="mp-legend"></div>
    <p class="ctl-note">Overlapping scars are the point: the darker an area looks, the more times it has burnt. Tap or hover any scar for its name, season and size.</p>
  `;

  el.querySelector('#mp-legend')!.innerHTML = legend(
    (['bushfire', 'prescribed', 'unknown'] as const).map((t) => ({
      color: TYPE_COLOR[t], label: TYPE_LABEL[t],
    })),
  );

  const canvas = el.querySelector('#mp-canvas') as HTMLElement;
  const countEl = el.querySelector('#mp-count') as HTMLElement;
  countEl.textContent = 'Loading fire boundaries…';

  let all: GeoJSON.FeatureCollection | null = null;

  const draw = () => {
    if (!map || !all) return;
    if (layer) { layer.remove(); layer = null; }
    const feats = all.features.filter((f) => {
      const p = f.properties as unknown as FireProps;
      return (typeFilter === 'all' || p.t === typeFilter) && (p.y ?? 0) >= minSeason;
    });
    layer = L.geoJSON({ type: 'FeatureCollection', features: feats } as GeoJSON.FeatureCollection, {
      style: (f) => {
        const p = f?.properties as unknown as FireProps;
        return {
          color: TYPE_COLOR[p?.t ?? 'unknown'],
          weight: 0.4,
          opacity: 0.75,
          fillColor: TYPE_COLOR[p?.t ?? 'unknown'],
          // Low fill opacity so repeated burns accumulate visibly where scars
          // overlap — the single most informative thing this map shows.
          fillOpacity: 0.22,
        };
      },
      onEachFeature: (f, lyr) => {
        const p = f.properties as unknown as FireProps;
        lyr.bindTooltip(
          `<b>${esc(p.n ?? 'Unnamed fire')}</b>${esc(p.s ?? '')} · ${esc(fmtSeason(p.y))}<br>${esc(ha(p.a))} (${esc(km2(p.a))})<br>${esc(TYPE_LABEL[p.t] ?? 'Unclassified')}`,
          { className: 'map-tip', sticky: true },
        );
      },
    }).addTo(map);
    countEl.textContent = `${num(feats.length)} fire scars shown`;
  };

  // Leaflet measures its container on init, and a container that is still
  // zero-height renders a grey box forever. Deferring one frame lets layout
  // settle first.
  requestAnimationFrame(() => {
    if (destroyed) return;
    map = L.map(canvas, {
      center: [-27.5, 133.5],
      zoom: 4,
      minZoom: 3,
      maxZoom: 11,
      preferCanvas: true,
      attributionControl: true,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a> | Fire boundaries: Digital Atlas of Australia &copy; Commonwealth of Australia (Geoscience Australia), CC BY 4.0, de-duplicated and simplified',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    // Size the container before anything is projected. Deferring this to a
    // timer leaves the shared canvas renderer holding paths projected against
    // the old container size — which draws the state outlines hundreds of
    // kilometres away from everything else.
    map.invalidateSize();

    loadStateShapes().then((geo) => {
      if (destroyed || !map) return;
      L.geoJSON(geo as GeoJSON.GeoJsonObject, {
        style: { color: '#8b8178', weight: 1, fill: false, opacity: 0.6 },
        interactive: false,
      }).addTo(map);
    }).catch(() => { /* state outlines are decorative; the map works without them */ });

    loadFireShapes().then((geo) => {
      if (destroyed) return;
      all = geo as GeoJSON.FeatureCollection;
      draw();
    }).catch((err: Error) => {
      if (destroyed) return;
      countEl.innerHTML = `<span class="error-inline">Fire boundaries failed to load (${esc(err.message)}). <button type="button" class="btn-quiet" id="mp-retry">Retry</button></span>`;
      el.querySelector('#mp-retry')?.addEventListener('click', () => {
        countEl.textContent = 'Loading fire boundaries…';
        loadFireShapes().then((geo2) => { all = geo2 as GeoJSON.FeatureCollection; draw(); })
          .catch(() => { countEl.textContent = 'Still unavailable — please try again later.'; });
      });
    });

    setTimeout(() => map?.invalidateSize(), 60);
  });

  onSeg(el, 'ftype', (v) => { typeFilter = v as FireType | 'all'; draw(); });

  const slider = el.querySelector('#mp-year') as HTMLInputElement;
  const out = el.querySelector('#mp-year-out') as HTMLElement;
  slider.addEventListener('input', () => {
    minSeason = Number(slider.value);
    out.textContent = fmtSeason(minSeason);
  });
  // Redraw on release rather than on every pixel of drag — rebuilding 7,000
  // polygons per input event locks up a phone.
  slider.addEventListener('change', draw);

  return () => {
    destroyed = true;
    map?.remove();
    map = null;
  };
}
