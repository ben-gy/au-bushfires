// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Live feeds, fetched in the BROWSER. Nothing here is ever polled by a
// scheduled Action and no live value is archived server-side.
//
// Two feeds survived a CORS check; a third did not:
//   • Digital Atlas Near Real-Time extents — access-control-allow-origin: *
//   • NSW RFS major incidents — sends ACAO: * only when an Origin header is
//     present, which browsers always do. Testing it with a bare curl shows no
//     CORS header at all and looks like a dead end; it is not.
//   • VIC Emergency (emergency.vic.gov.au/public/osom-geojson.json) sends NO
//     access-control-allow-origin even when asked, so it CANNOT be used from a
//     browser. It is deliberately absent rather than silently failing.

import type { LiveFire, StateCode } from './types';
import { cleanTypeClient, cleanStateClient } from './normalise';

const NRT = 'https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/Near_Real_Time_Bushfire_Boundaries_view/FeatureServer/3/query';
const NSW = 'https://www.rfs.nsw.gov.au/feeds/majorIncidents.json';

export interface LiveResult {
  fires: LiveFire[];
  /** Per-source failure messages, surfaced rather than swallowed. */
  errors: string[];
  retrieved: number | null;
}

interface EsriFeature {
  attributes: Record<string, unknown>;
  geometry?: { rings?: number[][][] };
}

/** Centre of a polygon's outer ring — good enough to drop a marker. */
function ringCentre(rings?: number[][][]): [number | null, number | null] {
  const r = rings?.[0];
  if (!r?.length) return [null, null];
  let x = 0;
  let y = 0;
  for (const p of r) { x += p[0]; y += p[1]; }
  return [y / r.length, x / r.length];
}

async function fetchNrt(signal: AbortSignal): Promise<LiveFire[]> {
  const p = new URLSearchParams({
    where: '1=1',
    outFields: 'fire_name,fire_type,area_ha,state,date_retrieved,agency',
    returnGeometry: 'true',
    maxAllowableOffset: '0.02',
    geometryPrecision: '3',
    outSR: '4326',
    resultRecordCount: '2000',
    f: 'json',
  });
  const res = await fetch(`${NRT}?${p}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message ?? 'service error');
  return ((j.features ?? []) as EsriFeature[]).map((f) => {
    const a = f.attributes;
    const [lat, lon] = ringCentre(f.geometry?.rings);
    return {
      name: String(a.fire_name ?? '').trim() || 'Unnamed extent',
      state: cleanStateClient(a.state as string) as StateCode | null,
      type: cleanTypeClient(a.fire_type as string),
      areaHa: Number(a.area_ha) || null,
      lat,
      lon,
      status: (a.fire_type as string) ?? null,
      source: 'nrt' as const,
      updated: typeof a.date_retrieved === 'number' ? a.date_retrieved : null,
      rings: f.geometry?.rings,
    };
  });
}

/**
 * The RFS ships its detail as an HTML blob inside `description`, e.g.
 * "ALERT LEVEL: Advice <br />STATUS: Being controlled <br />SIZE: 236 ha".
 * Parsed into a plain map rather than regex-fished one field at a time.
 */
export function parseRfsDescription(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(html ?? '').split(/<br\s*\/?>/i)) {
    const idx = part.indexOf(':');
    if (idx < 1) continue;
    const key = part.slice(0, idx).replace(/<[^>]*>/g, '').trim().toUpperCase();
    const val = part.slice(idx + 1).replace(/<[^>]*>/g, '').trim();
    if (key) out[key] = val;
  }
  return out;
}

/** "236 ha" → 236. Returns null for "0 ha", blanks and unparseable values. */
export function parseRfsSize(s: string | undefined): number | null {
  if (!s) return null;
  const m = /([\d,.]+)\s*ha/i.exec(s);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** First coordinate found anywhere in a GeoJSON geometry (incl. collections). */
export function firstPoint(geom: unknown): [number | null, number | null] {
  const g = geom as { type?: string; coordinates?: unknown; geometries?: unknown[] } | null;
  if (!g) return [null, null];
  if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
    for (const sub of g.geometries) {
      const p = firstPoint(sub);
      if (p[0] != null) return p;
    }
    return [null, null];
  }
  let c: unknown = g.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return [c[1] as number, c[0] as number];
  }
  return [null, null];
}

async function fetchNsw(signal: AbortSignal): Promise<LiveFire[]> {
  const res = await fetch(NSW, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return ((j.features ?? []) as { properties: Record<string, string>; geometry: unknown }[])
    .map((f) => {
      const d = parseRfsDescription(f.properties?.description ?? '');
      const [lat, lon] = firstPoint(f.geometry);
      const isFire = (d.FIRE ?? '').toLowerCase() === 'yes';
      const t = (d.TYPE ?? '').toLowerCase();
      return {
        name: String(f.properties?.title ?? d.LOCATION ?? 'Incident').trim(),
        state: 'NSW' as StateCode,
        type: !isFire ? 'unknown' as const
          : t.includes('hazard') || t.includes('prescribed') ? 'prescribed' as const
            : 'bushfire' as const,
        areaHa: parseRfsSize(d.SIZE),
        lat,
        lon,
        status: d.STATUS ?? d['ALERT LEVEL'] ?? null,
        source: 'nsw' as const,
        updated: d.UPDATED ? Date.parse(d.UPDATED) || null : null,
      };
    });
}

/**
 * Both feeds are fetched independently and a failure in one never blanks the
 * other — during a real fire event a partial view is far better than an error
 * page.
 */
export async function loadLive(signal: AbortSignal): Promise<LiveResult> {
  const errors: string[] = [];
  const [nrt, nsw] = await Promise.all([
    fetchNrt(signal).catch((e: Error) => {
      if (e.name !== 'AbortError') errors.push(`National extents unavailable (${e.message})`);
      return [] as LiveFire[];
    }),
    fetchNsw(signal).catch((e: Error) => {
      if (e.name !== 'AbortError') errors.push(`NSW RFS incidents unavailable (${e.message})`);
      return [] as LiveFire[];
    }),
  ]);
  const fires = [...nsw, ...nrt];
  const stamps = fires.map((f) => f.updated).filter((x): x is number => x != null);
  return { fires, errors, retrieved: stamps.length ? Math.max(...stamps) : null };
}
