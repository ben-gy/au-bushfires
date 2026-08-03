// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { FireData } from './types';

async function json<T>(path: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) throw new Error(`${path} — HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The fire polygons are ~3.5 MB (about 800 KB over the wire) and only the map
 * needs them, so they load on demand rather than blocking first paint. The
 * promise is cached so switching away from the map and back does not refetch.
 */
let firesPromise: Promise<unknown> | null = null;
export function loadFireShapes(): Promise<unknown> {
  if (!firesPromise) {
    firesPromise = fetch('data/fires.geojson').then((r) => {
      if (!r.ok) throw new Error(`fires.geojson — HTTP ${r.status}`);
      return r.json();
    }).catch((e) => {
      // Clear the cache so a transient failure can be retried by reopening
      // the view, instead of the rejected promise being replayed forever.
      firesPromise = null;
      throw e;
    });
  }
  return firesPromise;
}

let statesPromise: Promise<unknown> | null = null;
export function loadStateShapes(): Promise<unknown> {
  if (!statesPromise) {
    statesPromise = fetch('data/au-states.geojson').then((r) => {
      if (!r.ok) throw new Error(`au-states.geojson — HTTP ${r.status}`);
      return r.json();
    }).catch((e) => { statesPromise = null; throw e; });
  }
  return statesPromise;
}

export async function loadData(signal: AbortSignal): Promise<FireData> {
  const [core, seasons, states, causes, sizes, correction, regions] = await Promise.all([
    json<FireData['core']>('data/core.json', signal),
    json<FireData['seasons']>('data/seasons.json', signal),
    json<FireData['states']>('data/states.json', signal),
    json<FireData['causes']>('data/causes.json', signal),
    json<FireData['sizes']>('data/sizes.json', signal),
    json<FireData['correction']>('data/correction.json', signal),
    json<FireData['regions']>('data/regions.json', signal),
  ]);
  return { core, seasons, states, causes, sizes, correction, regions };
}
