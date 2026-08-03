// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The only view that changes between visits. Everything here is fetched in the
// browser; no Action polls these feeds and nothing live is archived.
//
// THE COUNTER IS THE DANGEROUS PART. The national near-real-time layer returns
// ~511 features, of which the overwhelming majority are Victorian "Current
// Burnt Area" polygons — ground that has ALREADY burnt this season — plus
// prescribed burns. A headline reading "511 fires burning in Australia" would
// be flatly false and would be the first thing anyone screenshots. So the
// counters are broken out by what each record actually is, and the genuinely
// active incidents (NSW RFS) are separated from mapped extents entirely.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { LiveFire } from '../types';
import { TYPE_COLOR, STATE_COLOR } from '../colors';
import { TYPE_LABEL, STATE_LABEL, ha, num, relTime, esc } from '../format';
import { g } from '../glossary';
import { card, statRow, viewHead } from './ui';
import { loadLive } from '../live';
import { loadStateShapes } from '../data';

export function mount(el: HTMLElement): () => void {
  const ctrl = new AbortController();
  let map: L.Map | null = null;
  let markers: L.FeatureGroup | null = null;
  let timer: number | undefined;
  let destroyed = false;

  el.innerHTML = `
    ${viewHead({
    title: 'Fires being mapped right now',
    question: 'What is burning, or has just burnt, in the last few days?',
    blurb: `Live from the national ${g('nrt', 'near real-time')} fire-extent service and the NSW Rural Fire Service. Refreshes every five minutes while this page is open.`,
  })}
    <div id="lv-status" class="live-status" role="status">Loading live feeds…</div>
    <div id="lv-stats"></div>
    <div class="map-wrap">
      <div class="map-canvas map-canvas-sm" id="lv-canvas" role="application" aria-label="Map of current fire activity"></div>
    </div>
    <div id="lv-body"></div>
  `;

  const canvas = el.querySelector('#lv-canvas') as HTMLElement;
  const statusEl = el.querySelector('#lv-status') as HTMLElement;
  const statsEl = el.querySelector('#lv-stats') as HTMLElement;
  const bodyEl = el.querySelector('#lv-body') as HTMLElement;

  // The feeds usually resolve BEFORE the deferred map init below, and the
  // marker-drawing block is guarded on `map` being non-null. Without holding on
  // to the last result the first (and for five minutes, only) render silently
  // drew nothing — a map with correct counters above it and no dots on it.
  let latest: LiveFire[] = [];
  let fitted = false;

  requestAnimationFrame(() => {
    if (destroyed) return;
    map = L.map(canvas, { center: [-27.5, 133.5], zoom: 4, minZoom: 3, maxZoom: 12, preferCanvas: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors, &copy; CARTO | Extents: Digital Atlas of Australia &copy; Commonwealth of Australia (Geoscience Australia), CC BY 4.0 | Incidents: &copy; State of New South Wales (NSW Rural Fire Service), CC BY 4.0 — for current information go to rfs.nsw.gov.au',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
    // Size the container BEFORE anything is projected. Calling invalidateSize
    // on a timer after layers are drawn leaves the shared canvas renderer
    // holding paths projected against the old size, which renders as an
    // outline sitting hundreds of kilometres from the markers.
    map.invalidateSize();

    loadStateShapes().then((geo) => {
      if (destroyed || !map) return;
      L.geoJSON(geo as GeoJSON.GeoJsonObject, {
        style: { color: '#8b8178', weight: 1, fill: false, opacity: 0.6 }, interactive: false,
      }).addTo(map);
      // Only now is every layer on the map, so a view change repaints all of
      // them together.
      drawMarkers(latest);
    }).catch(() => {
      drawMarkers(latest);
    });
  });

  function tipFor(f: LiveFire): string {
    return `<b>${esc(f.name)}</b>${esc(f.state ? STATE_LABEL[f.state] : '')}<br>${esc(TYPE_LABEL[f.type])}${f.areaHa ? ` · ${esc(ha(f.areaHa))}` : ''}<br>${esc(f.status ?? '')}${f.updated ? `<br>${esc(relTime(f.updated))}` : ''}`;
  }

  /**
   * Extents are drawn as their real polygons, incidents as points.
   *
   * Drawing an extent as a centroid dot was both wrong and invisible: at
   * continental zoom a 5px dot for a 40,000 ha burn scar disappears entirely,
   * so the map read as empty while the counters above it said 467.
   */
  function drawMarkers(fires: LiveFire[]): void {
    if (!map) return;
    markers?.remove();
    markers = L.featureGroup().addTo(map);

    for (const f of fires) {
      if (f.source === 'nrt' && f.rings?.length) {
        L.polygon(
          // Esri rings are [lon, lat]; Leaflet wants [lat, lon].
          f.rings.map((ring) => ring.map(([lon, lat]) => [lat, lon] as [number, number])),
          {
            color: TYPE_COLOR[f.type],
            weight: 1.2,
            opacity: 0.9,
            fillColor: TYPE_COLOR[f.type],
            fillOpacity: 0.4,
          },
        ).bindTooltip(tipFor(f), { className: 'map-tip', sticky: true }).addTo(markers);
        continue;
      }
      if (f.lat == null || f.lon == null) continue;
      L.circleMarker([f.lat, f.lon], {
        radius: f.source === 'nsw' ? 7 : 5,
        color: f.source === 'nsw' ? '#7f1d1d' : TYPE_COLOR[f.type],
        weight: f.source === 'nsw' ? 2 : 1,
        fillColor: TYPE_COLOR[f.type],
        fillOpacity: 0.7,
      }).bindTooltip(tipFor(f), { className: 'map-tip', sticky: true }).addTo(markers);
    }

    // Frame the map on where activity actually is. At the continental default
    // view a single 40,000 ha extent is roughly two pixels across, so a map of
    // the whole country looks empty while the counters above it read 467.
    // Only fit once, so a five-minute refresh never yanks the view out from
    // under someone who has panned or zoomed.
    if (!fitted) {
      try {
        const b = markers.getBounds();
        if (b.isValid()) {
          // animate: false — an animated zoom repaints the shared canvas
          // mid-flight and can leave other layers drawn against the old view.
          map.fitBounds(b, { padding: [24, 24], maxZoom: 7, animate: false });
          fitted = true;
          map.invalidateSize();
        }
      } catch {
        /* no geometry yet — keep the default national view */
      }
    }
  }

  const render = (fires: LiveFire[], errors: string[], retrieved: number | null) => {
    if (destroyed) return;

    const incidents = fires.filter((f) => f.source === 'nsw');
    const activeFires = incidents.filter((f) => f.type === 'bushfire');
    const extents = fires.filter((f) => f.source === 'nrt');
    const extentBush = extents.filter((f) => f.type === 'bushfire');
    const extentPresc = extents.filter((f) => f.type === 'prescribed');
    const extentOther = extents.filter((f) => f.type === 'unknown');

    statusEl.className = `live-status${errors.length ? ' live-status-warn' : ''}`;
    statusEl.innerHTML = `<span class="live-dot" aria-hidden="true"></span>
      Updated ${esc(relTime(retrieved ?? Date.now()))}${retrieved ? '' : ' (feed carries no timestamp)'}.
      ${errors.length ? `<strong>${esc(errors.join(' · '))}</strong>` : 'Both feeds responding.'}`;

    statsEl.innerHTML = statRow([
      {
        value: num(activeFires.length),
        label: 'Active NSW bush fire incidents',
        sub: `of ${num(incidents.length)} RFS incidents`,
        tone: activeFires.length ? 'bad' : 'good',
        tip: 'Live incidents from the NSW Rural Fire Service. This is the only genuinely "burning right now" number here — the other states do not publish a browser-readable live feed.',
      },
      {
        value: num(extentBush.length),
        label: 'Recently mapped bushfire extents',
        sub: 'nationally, last few days',
        tone: 'warn',
        tip: 'Fire boundaries mapped from recent satellite passes and typed as bushfire. A mapped extent is not the same as an active fire front.',
      },
      {
        value: num(extentPresc.length),
        label: 'Recently mapped prescribed burns',
        sub: 'deliberate hazard reduction',
        tone: 'dom',
        tip: 'Deliberate burns lit by land managers. Counting these as "fires burning" would badly overstate what is happening.',
      },
      {
        value: num(extentOther.length),
        label: 'Extents with no type recorded',
        sub: 'mostly already-burnt ground',
        tone: 'dom',
        tip: 'Largely Victorian "Current Burnt Area" polygons — ground that has already burnt this season, not fire that is still going.',
      },
    ]);

    // Map markers ───────────────────────────────────────────────────────────
    // Cached as well as drawn: if the map does not exist yet, the deferred
    // init picks these up rather than leaving the map empty.
    latest = fires;
    drawMarkers(fires);

    // Incident list ─────────────────────────────────────────────────────────
    bodyEl.innerHTML = `
      ${card('NSW Rural Fire Service incidents',
      incidents.length
        ? 'Live incidents, including non-fire callouts. This is the only state publishing a feed a browser is allowed to read.'
        : 'No major incidents are listed right now.',
      incidents.length ? `<div class="tbl-wrap"><table class="data">
          <thead><tr><th scope="col">Location</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col" class="num">Size</th><th scope="col">Updated</th></tr></thead>
          <tbody>${incidents.map((f) => `<tr>
            <td class="wide">${esc(f.name)}</td>
            <td><span class="pill" style="background:${TYPE_COLOR[f.type]}1f;color:${TYPE_COLOR[f.type]}">${esc(TYPE_LABEL[f.type])}</span></td>
            <td>${esc(f.status ?? '—')}</td>
            <td class="num">${f.areaHa ? esc(ha(f.areaHa)) : '—'}</td>
            <td>${esc(relTime(f.updated))}</td>
          </tr>`).join('')}</tbody></table></div>`
        : '<p class="empty">Nothing to show. In the southern winter this is normal.</p>')}

      ${card('Recently mapped extents, nationally',
      'Boundaries added to the national near-real-time service in the last few days, grouped by state.',
      extents.length ? `<div class="tbl-wrap"><table class="data">
          <thead><tr><th scope="col">State</th><th scope="col" class="num">Bushfire</th><th scope="col" class="num">Prescribed</th><th scope="col" class="num">Untyped</th><th scope="col" class="num">Total</th></tr></thead>
          <tbody>${byState(extents).map((r) => `<tr>
            <td><span class="pill" style="background:${r.code ? `${STATE_COLOR[r.code]}1f` : 'var(--bg-elevated)'};color:${r.code ? STATE_COLOR[r.code] : 'var(--text-secondary)'}">${esc(r.code ?? '—')}</span> ${esc(r.code ? STATE_LABEL[r.code] : 'Not recorded')}</td>
            <td class="num">${esc(num(r.bushfire))}</td><td class="num">${esc(num(r.prescribed))}</td>
            <td class="num">${esc(num(r.unknown))}</td><td class="num"><strong>${esc(num(r.total))}</strong></td>
          </tr>`).join('')}</tbody></table></div>`
        : '<p class="empty">No extents currently published.</p>')}

      <div class="note-band">
        <strong>What these numbers are not.</strong>
        A mapped extent is a boundary drawn around ground that has burnt — often days ago, and often deliberately.
        It is not a count of fires currently alight, and the large "untyped" group is mostly Victorian already-burnt area.
        For warnings and what to do, always use your state emergency service, never this site.
      </div>
    `;
  };

  const refresh = () => {
    loadLive(ctrl.signal)
      .then((r) => render(r.fires, r.errors, r.retrieved))
      .catch((e: Error) => {
        if (destroyed || e.name === 'AbortError') return;
        statusEl.className = 'live-status live-status-warn';
        statusEl.innerHTML = `Live feeds unavailable (${esc(e.message)}). <button type="button" class="btn-quiet" id="lv-retry">Retry</button>`;
        el.querySelector('#lv-retry')?.addEventListener('click', refresh);
      });
  };

  refresh();
  timer = window.setInterval(refresh, 5 * 60 * 1000);

  return () => {
    destroyed = true;
    window.clearInterval(timer);
    ctrl.abort();
    map?.remove();
    map = null;
  };
}

function byState(fires: LiveFire[]) {
  const m = new Map<string, { code: LiveFire['state']; bushfire: number; prescribed: number; unknown: number; total: number }>();
  for (const f of fires) {
    const k = f.state ?? '—';
    if (!m.has(k)) m.set(k, { code: f.state, bushfire: 0, prescribed: 0, unknown: 0, total: 0 });
    const e = m.get(k)!;
    e[f.type] += 1;
    e.total += 1;
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
