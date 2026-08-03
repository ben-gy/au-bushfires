// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Colour is defined once here and referenced everywhere. A state keeps the same
// colour in the season chart, the map, the matrix and the size histogram, so a
// reader who learns "WA is the ochre one" never has to relearn it.

import type { FireType, StateCode } from './types';

/**
 * Fire type carries the most important semantic distinction on the site: a
 * prescribed burn is a deliberate act of land management and must never be
 * coloured as a wildfire. Ember for bushfire, a cooler amber for prescribed,
 * slate for the large unclassified bucket.
 */
export const TYPE_COLOR: Record<FireType, string> = {
  bushfire: '#c2410c',
  prescribed: '#b08900',
  unknown: '#8b8178',
};

export const STATE_COLOR: Record<StateCode, string> = {
  NSW: '#c2410c',
  VIC: '#7c2d12',
  QLD: '#b45309',
  WA: '#a16207',
  SA: '#9a3412',
  TAS: '#4d7c0f',
  ACT: '#0f766e',
  NT: '#78350f',
};

export const CAUSE_COLOR: Record<string, string> = {
  lightning: '#0369a1',
  deliberate: '#b91c1c',
  accidental: '#c2410c',
  prescribed: '#b08900',
  machinery: '#7c3aed',
  powerline: '#0f766e',
  railway: '#4b5563',
  reignition: '#be185d',
  unknown: '#a8a29e',
};

/**
 * Sequential ochre → ember ramp for burn counts and burnt area.
 *
 * Deliberately a SEQUENTIAL scale applied to a log-transformed domain, never a
 * quantile scale. Fire size spans six orders of magnitude — 535 fires are over
 * 100,000 ha while 13,820 are under one hectare — and quantile bins would give
 * a suburban grass fire and a megafire the same colour, which is the single
 * most common way a map of this data lies.
 */
export const RAMP = ['#fdf3e3', '#fbdba7', '#f6b26b', '#e8843c', '#cf5520', '#a63603', '#6f1d02'];

/** Position on the ramp for a value, using a log domain. */
export function rampColor(value: number, max: number): string {
  if (!(value > 0) || !(max > 0)) return '#f0ece7';
  const t = Math.log10(1 + value) / Math.log10(1 + max);
  const i = Math.min(RAMP.length - 1, Math.max(0, Math.floor(t * RAMP.length)));
  return RAMP[i];
}

/** The ramp rendered as legend swatches. */
export function rampStops(): string[] {
  return RAMP;
}
