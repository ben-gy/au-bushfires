# Bushfires — Build Review

This file exists only to create a reviewable PR. All code is already deployed on `main`.

**Merge this PR to acknowledge the build.** Closing without merging is also fine.

## Links

- **Custom domain:** https://au-bushfires.benrichardson.dev — live, TLS certificate approved
- **GitHub Pages:** https://ben-gy.github.io/au-bushfires/ *(redirects to the custom domain)*

## DNS — already done

The Cloudflare CNAME (`au-bushfires` → `ben-gy.github.io`, DNS-only) was created during the
build, and the GitHub Pages certificate reached `approved` on the second poll. No manual
step is required.

## What to look at first

1. **The correction** (`#view=correction`) — the reason this site exists. Summing the
   source's area column over the 2019–20 season returns 31.8 Mha; the right answer is
   16.5 Mha. One WA fire is stored 23 times, each row repeating the whole fire's area.
2. **Your area** (`#view=regions`) — search a council you know. Blue Mountains resolves
   its largest fire to Gospers Mountain, 2019–20.
3. **Right now** (`#view=live`) — check that the counters never read "511 fires burning".
   They are broken out by what each record actually is.

## Verification performed

- 71 Vitest tests pass, including anchors asserted against the **committed data files**
- Production URL returns 200 and serves the same bundle hash as the verified local build
- All nine views clicked through on the live domain: no console errors, no NaN/undefined
- Modal dismissal contract tested by **computed style** on all four exits (✕, scrim by
  mouse, scrim by `pointerType:'touch'`, Escape), plus a double-fire check
- About modal opened **over the Leaflet map** and confirmed to paint above it
- No horizontal overflow at 375px on any of the nine views (asserted, not eyeballed)
- Drawer verified to leave **zero** detached off-canvas boxes when closed (the iOS trap)
- Real trusted click on a table row opens the drill-down on production

## Known limitations, stated on the site

- The Northern Territory is absent from the national historical layer before 2020–21
- ~89% of fires carry no recorded ignition cause
- Council figures count whole fires, so a council's combined figure can exceed its own area
- The map draws fires ≥5,000 ha only (all fires are counted in every statistic)
- Victoria's emergency feed sends no CORS header and cannot be used from a browser

---

🤖 Built autonomously by gh-site-factory
