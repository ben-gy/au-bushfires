// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Slide-in drill-down panel.
//
// The panel is DETACHED from the DOM when closed rather than parked at
// translateX(100%). A closed off-canvas panel is still a real box on iOS
// Safari, which lets the page scroll sideways to reach it — and neither
// `overflow-x: clip` on the body nor a scrollWidth check will reveal it.
// Detaching is the only fix that actually holds.

let panel: HTMLElement | null = null;
let scrim: HTMLElement | null = null;
let lastFocus: HTMLElement | null = null;
let onCloseHook: (() => void) | null = null;

// Escape must close the drawer from ANYWHERE on the page, not only while focus
// happens to be inside it. A keydown listener bound to the panel alone leaves
// the drawer stuck the moment focus moves elsewhere — the reader presses Escape,
// nothing happens, and the panel looks broken. Registered once, at module load.
let escBound = false;
function bindEscape(): void {
  if (escBound) return;
  escBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel) closeDrawer();
  });
}

export function isOpen(): boolean {
  return panel !== null;
}

export function closeDrawer(restoreFocus = true): void {
  if (!panel) return;
  panel.remove();
  scrim?.remove();
  panel = null;
  scrim = null;
  document.body.classList.remove('drawer-open');
  if (restoreFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
  const hook = onCloseHook;
  onCloseHook = null;
  hook?.();
}

export function openDrawer(title: string, html: string, opts: { onClose?: () => void } = {}): HTMLElement {
  closeDrawer(false);
  bindEscape();
  lastFocus = document.activeElement as HTMLElement | null;
  onCloseHook = opts.onClose ?? null;

  scrim = document.createElement('div');
  scrim.className = 'drawer-scrim';
  // pointerdown covers mouse, touch and pen in one handler; a click-only scrim
  // is the classic "I can't close this on my phone" bug.
  scrim.addEventListener('pointerdown', () => closeDrawer());

  panel = document.createElement('aside');
  panel.className = 'drawer';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', title);
  panel.innerHTML = `
    <div class="drawer-head">
      <h2>${title}</h2>
      <button type="button" class="drawer-close" aria-label="Close panel">×</button>
    </div>
    <div class="drawer-body">${html}</div>`;

  document.body.append(scrim, panel);
  document.body.classList.add('drawer-open');
  panel.querySelector('.drawer-close')?.addEventListener('pointerdown', () => closeDrawer());
  // Assistive tech activates a button with `click` and never a pointer event.
  panel.querySelector('.drawer-close')?.addEventListener('click', () => closeDrawer());

  // Focus trap: the panel is modal, so Tab must not escape into the page behind.
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); return; }
    if (e.key !== 'Tab' || !panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  requestAnimationFrame(() => panel?.classList.add('open'));
  (panel.querySelector('.drawer-close') as HTMLElement | null)?.focus();
  return panel.querySelector('.drawer-body') as HTMLElement;
}
