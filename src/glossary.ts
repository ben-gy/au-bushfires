// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Assume the reader knows nothing about fire management or spatial data. Every
// piece of jargon in the interface is a clickable term that resolves here.

import { esc } from './format';

export interface Term { term: string; def: string }

export const GLOSSARY: Record<string, Term> = {
  bushfire: {
    term: 'Bushfire',
    def: 'An unplanned fire burning in vegetation — grass, scrub or forest. Called a wildfire in most other countries. In this data it is one of three recorded fire types, alongside prescribed burns and a large unclassified group.',
  },
  prescribed: {
    term: 'Prescribed burn',
    def: 'A fire lit deliberately by a land manager under controlled conditions, to reduce the fuel available to a future bushfire. Also called hazard reduction, planned burning or fuel reduction. Nearly half of all records in this archive are prescribed burns, which is why separating them from bushfires matters so much — treating them as one number would badly overstate how much of Australia burns by accident.',
  },
  fire_scar: {
    term: 'Fire scar / fire boundary',
    def: 'The mapped outline of the ground a fire actually burnt, usually drawn from satellite imagery or aerial survey after the fire is out. It is a record of where fire went, not of damage or destruction.',
  },
  fire_season: {
    term: 'Fire season',
    def: 'Southern Australia\'s fire season runs across the new year — the 2019–20 season began in September 2019 and ran into February 2020. This site therefore bins everything July to June and labels it "2019–20". Binning by calendar year would cut that season in half and destroy the single most important event in the record. Northern Australia burns on a different cycle entirely, in the dry season after the monsoon.',
  },
  area_ha: {
    term: 'Hectare (ha)',
    def: 'A hectare is 10,000 m² — about the size of a sports oval. One hundred hectares make a square kilometre. Australia is roughly 769 million hectares in total.',
  },
  multipart: {
    term: 'Multi-part fire',
    def: 'A fire whose burnt ground is not one continuous shape — it jumped a river, or spotted ahead of itself and burnt several separate patches. In this dataset such a fire is stored as one row per patch, and critically, every one of those rows repeats the whole fire\'s total area. One Western Australian fire of 162,367 ha is stored 23 times over.',
  },
  double_counting: {
    term: 'Double counting',
    def: 'Adding up the area column in this dataset without first collapsing multi-part fires counts big fires several times over. For the 2019–20 season it returns 31.8 million hectares instead of the correct 16.5 million — nearly double. This site collapses them and shows both numbers side by side.',
  },
  dedupe: {
    term: 'Deduplication',
    def: 'Collapsing the repeated rows of a multi-part fire down to one record per fire. Here that means grouping on state, fire ID, ignition date, area and perimeter together — the fire ID alone is not enough, because thousands of records have no ID at all or share a placeholder value.',
  },
  ignition_cause: {
    term: 'Ignition cause',
    def: 'How the fire started, where an investigating agency recorded it. Only about 11% of records in this archive carry a cause at all, so every cause figure on this site describes that minority and not Australian fires in general. The source vocabulary is only seven values, which this site relabels in plainer English: "Natural" is shown as Lightning, "Incendiary" as Deliberate, and "Undetermined", "NOT DETERMINED", "OTHER" and "WF - unknown" are all shown as Not recorded. Nothing is discarded — every source value maps to exactly one bucket.',
  },
  lga: {
    term: 'Local government area (LGA)',
    def: 'A council area — the Blue Mountains, Shoalhaven, East Gippsland. There are 566 of them across Australia, defined by the Australian Bureau of Statistics. This site works out which fires intersect each one so you can look up your own council.',
  },
  nrt: {
    term: 'Near real-time',
    def: 'Fire extents published within hours rather than months, mapped from satellite passes while the fire is still burning. They are provisional: outlines get corrected, and a mapped extent is not the same as an active fire front.',
  },
  digital_atlas: {
    term: 'Digital Atlas of Australia',
    def: 'The Australian Government\'s national spatial data platform, run by Geoscience Australia. It publishes the Historical Bushfire Boundaries used here, compiled from each state and territory fire agency\'s own mapping.',
  },
  asgs: {
    term: 'ASGS',
    def: 'The Australian Statistical Geography Standard — the Bureau of Statistics\' official set of boundaries, from small suburb-sized areas up to states. The council boundaries on this site are the ASGS 2021 edition.',
  },
  reached: {
    term: 'Fires that reached an area',
    def: 'A fire is counted for a council area if any part of its mapped boundary falls inside it. The size shown alongside is the WHOLE fire, including the parts that burnt in neighbouring councils — the Gospers Mountain fire counts its full 479,514 ha for every council it crossed. That is why a council\'s combined fire size can exceed the council\'s own land area many times over: it is not a measure of how much of that council burnt, but of how much fire arrived at its door.',
  },
  times_burnt: {
    term: 'Seasons with fire',
    def: 'The number of separate fire seasons in which at least one mapped fire reached this area. It is the most honest single measure of fire exposure here, because unlike area it is not distorted by fires that mostly burnt somewhere else.',
  },
  cumulative: {
    term: 'Cumulative burnt area',
    def: 'The total of every fire\'s area added across all years. It is NOT the amount of distinct land that has burnt, because the same ground burns repeatedly — some country has burnt a dozen times since 1899. Adding 124 years of Australian fire gives a figure approaching the size of the continent, which is obviously not what it means.',
  },
};

let pop: HTMLElement | null = null;

function ensurePop(): HTMLElement {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'gloss-pop';
  pop.setAttribute('role', 'dialog');
  pop.hidden = true;
  document.body.appendChild(pop);
  return pop;
}

export function hideGloss(): void {
  if (!pop) return;
  pop.classList.remove('visible');
  pop.hidden = true;
}

function showGloss(key: string, anchor: HTMLElement): void {
  const t = GLOSSARY[key];
  if (!t) return;
  const el = ensurePop();
  el.innerHTML = `<button class="gloss-close" aria-label="Close">×</button>
    <strong>${esc(t.term)}</strong><p>${esc(t.def)}</p>`;
  el.hidden = false;
  el.classList.add('visible');

  const r = anchor.getBoundingClientRect();
  const w = Math.min(330, window.innerWidth - 24);
  el.style.width = `${w}px`;
  const h = el.offsetHeight;
  let left = r.left;
  if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12;
  if (left < 12) left = 12;
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  el.querySelector('.gloss-close')?.addEventListener('click', hideGloss);
}

/** `g('multipart', 'multi-part fires')` → an inline, clickable jargon term. */
export function g(key: string, label?: string): string {
  const t = GLOSSARY[key];
  if (!t) return esc(label ?? key);
  return `<button type="button" class="gloss-link" data-term="${esc(key)}">${esc(label ?? t.term)}<span aria-hidden="true">ⓘ</span></button>`;
}

export function initGlossary(): void {
  document.addEventListener('click', (e) => {
    const link = (e.target as Element)?.closest?.('.gloss-link') as HTMLElement | null;
    if (link?.dataset.term) {
      e.preventDefault();
      showGloss(link.dataset.term, link);
      return;
    }
    // Any click that is not on the popover itself dismisses it.
    if (!(e.target as Element)?.closest?.('.gloss-pop')) hideGloss();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideGloss();
  });
  window.addEventListener('resize', hideGloss);
  window.addEventListener('scroll', hideGloss, { passive: true });
}
