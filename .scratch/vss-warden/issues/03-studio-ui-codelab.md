# 03 — Side-by-Side SDV Verification Studio UI, Race-Safe Reducer, Interactive <google-codelab> & Reproducible Build Pack

**What to build:** The Next.js 16 Side-by-Side SDV Verification Studio (`app/page.tsx`, `lib/studio-model.ts`), the interactive QNX 8.0 Codelab tutorial page (`app/codelab/page.tsx` using `<google-codelab>` structure), and the complete reproducible documentation (`README.md`) specifying QNX 8.0 target and macOS/Linux host build/run instructions.

**Blocked by:** `02 — Host Verification API, Upstream-Ready QNX 8.0 QPP Patch (patches/qpp-vss-warden.patch) & Zero-Fuzz Patch Gate`

**Status:** `ready-for-agent`

**Needs:** None — a worker can check every item unaided

**Validation method:** Run `node --experimental-strip-types --test tests/studio-codelab.test.ts`, `npm test`, `npm run typecheck`, and `npm run build`.

**Evidence required:** `npm test`, `npm run typecheck`, and `npm run build` all exit `0` with passing assertions for `studioReducer` stale-response protection (`Failure: F1`), SVG timeline coordinate clamping and long VSS path truncation (`Failure: F2`), and `<google-codelab>` step rendering.

**Tests:** `required`

**Test seam:** `studioReducer(state, action)`, `buildTimelineChartModel(unguardedTrace, guardedTrace)`, and `/codelab` step model

**Regression scope:** Maintain all Ticket `01` and Ticket `02` tests while guaranteeing race-safe preset switching (`Failure: F1`), finite SVG geometry and `<= 32` char label truncation for deeply nested COVESA VSS paths (`Failure: F2`), and complete Next.js production build.

- [ ] Studio UI (`app/page.tsx`) provides 1-click switching across the 3 automotive presets (`Mirror Pan & Wiper Bounds + Float Bug`, `ADAS P60 vs IVI P10 Actuator Hijack`, `ADAS Holder Crash & Lease Rollback`), rendering side-by-side `Raw QPP (Unguarded)` vs. `VssWarden (Guarded)` SVG timelines, `P1..P3` invariant badges, the `?warden` JSON diagnostic inspector, and the copyable C CLI replay command — Source: Story 4, Story 5
- [ ] Switching presets while an earlier verification request is still in flight increments `activeRequestId` in `studioReducer` so a late response from the previous preset is ignored and never overwrites the newly selected preset's state or error banner — Source: Story 5 — Failure: F1
- [ ] `buildTimelineChartModel` clamps extreme or non-finite numeric values to finite SVG viewBox coordinates and truncates deeply nested VSS signal paths (`> 32` chars) with an ellipsis while preserving the full path in metadata — Source: Story 5 — Failure: F2
- [ ] Navigating to `/codelab` renders an interactive step-by-step QNX 8.0 tutorial (`<google-codelab>` format) walking through the 3 upstream `QPP` gaps, applying `patches/qpp-vss-warden.patch`, testing `.control` arbitration via `echo` and `cat ?warden,text`, and running the Shape 1 `fast-check` PBT suite — Source: Story 5
- [ ] `README.md` documents the QNX 8.0 (`qcc` / `meson`) and Host (`clang` + `npm test`) build/run instructions, exact upstream `qpp/` file and line references, and category/bonus prize mapping — Source: Story 5
