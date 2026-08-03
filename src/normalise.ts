// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Browser-side twins of the pipeline's `cleanState` / `cleanType`.
//
// The live feeds arrive unprocessed, and they spell things differently from the
// historical archive: the archive says "NSW (New South Wales)" where the
// near-real-time layer says "NSW", and the RFS says "Bush Fire" where the
// archive says "Bushfire". Joining the live overlay onto the historical colours
// without normalising both sides makes the overlay silently colourless.
//
// Kept deliberately separate from pipeline/parse.mjs: that file must stay
// dependency-free for the Node collector and is not part of the bundle.

import type { FireType, StateCode } from './types';

const STATE_CODES: StateCode[] = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

const STATE_NAMES: Record<string, StateCode> = {
  'NEW SOUTH WALES': 'NSW',
  VICTORIA: 'VIC',
  QUEENSLAND: 'QLD',
  'WESTERN AUSTRALIA': 'WA',
  'SOUTH AUSTRALIA': 'SA',
  TASMANIA: 'TAS',
  'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
  'NORTHERN TERRITORY': 'NT',
};

export function cleanStateClient(raw: string | null | undefined): StateCode | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const head = s.split('(')[0].trim().toUpperCase();
  if ((STATE_CODES as string[]).includes(head)) return head as StateCode;
  return STATE_NAMES[s.toUpperCase()] ?? null;
}

export function cleanTypeClient(raw: string | null | undefined): FireType {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === 'null') return 'unknown';
  if (s.includes('prescribed') || s.includes('planned') || s.includes('hazard')) return 'prescribed';
  // "Current Burnt Area" is Victoria's label for ground already burnt this
  // season — a fire scar, not an active fire. It maps to bushfire because that
  // is what burnt it, but the live view must never present it as "burning now".
  if (s.includes('bush') || s.includes('wild') || s.includes('burnt area')) return 'bushfire';
  return 'unknown';
}
