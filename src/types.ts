// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

export type StateCode = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT';
export type FireType = 'bushfire' | 'prescribed' | 'unknown';

export interface Totals {
  rawRows: number;
  fires: number;
  /** Sum of area_ha straight off the source rows — wrong, shown only for contrast. */
  naiveArea: number;
  /** The same sum after one row per fire. This is the number to quote. */
  correctedArea: number;
  overcount: number;
  firstSeason: number;
  lastSeason: number;
  causeKnown: number;
}

export interface BigFire {
  name: string | null;
  state: StateCode | null;
  season: number | null;
  date: number | null;
  area: number;
  type: FireType;
  cause: string;
}

export interface Core {
  generated: string;
  sourceUrl: string;
  licence: string;
  totals: Totals;
  types: { type: FireType; fires: number; area: number }[];
  biggest: BigFire[];
}

export interface Season {
  season: number;
  total: number;
  fires: number;
  byState: Partial<Record<StateCode, number>>;
  byType: Partial<Record<FireType, number>>;
}

export interface StateRow {
  code: StateCode;
  name: string;
  landKm2: number;
  fires: number;
  area: number;
  firstSeason: number | null;
  lastSeason: number | null;
  byType: Record<FireType, number>;
}

export interface CauseRow {
  cause: string;
  fires: number;
  area: number;
  meanArea: number;
  byState: Record<StateCode, number>;
  areaByState: Record<StateCode, number>;
  byType: Record<FireType, number>;
}

export interface SizeRow {
  label: string;
  fires: number;
  area: number;
  byState: Record<StateCode, number>;
  byType: Record<FireType, number>;
}

export interface DuplicateRow {
  fireId: string;
  name: string | null;
  state: StateCode | null;
  season: number | null;
  area: number;
  copies: number;
  inflation: number;
}

export interface BlackSummerRow {
  state: StateCode;
  name: string;
  naive: number;
  corrected: number;
  rows: number;
  fires: number;
}

export interface Correction {
  worst: DuplicateRow[];
  blackSummer: {
    table: BlackSummerRow[];
    naive: number;
    corrected: number;
    orroral: { name: string; area: number } | null;
  };
  naiveArea: number;
  correctedArea: number;
}

export interface Region {
  code: string;
  name: string;
  slug: string;
  state: StateCode | null;
  fires: number;
  bushfires: number;
  prescribed: number;
  area: number;
  firstSeason: number | null;
  lastSeason: number | null;
  biggest: { name: string | null; area: number; season: number | null } | null;
  seasons: Record<string, number>;
}

export interface FireData {
  core: Core;
  seasons: Season[];
  states: StateRow[];
  causes: CauseRow[];
  sizes: SizeRow[];
  correction: Correction;
  regions: Region[];
}

/** A live incident, normalised from whichever feed supplied it. */
export interface LiveFire {
  name: string;
  state: StateCode | null;
  type: FireType;
  areaHa: number | null;
  lat: number | null;
  lon: number | null;
  status: string | null;
  source: 'nrt' | 'nsw';
  updated: number | null;
  /**
   * Outer rings, lon/lat, for feeds that publish an extent rather than a point.
   * A mapped extent is an AREA, and drawing it as a dot both understates it and
   * makes it invisible at continental zoom.
   */
  rings?: number[][][];
}
