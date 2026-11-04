# 01 — Portable C11 Warden Engine (libvsswarden_core + vss-warden-cli), 3 Automotive Presets & Shape 1 Conditional PBT Suite

**What to build:** A zero-QNX-header-dependency portable C11 gatekeeper and mixed-criticality actuator arbiter (`vss_warden_core` + `vss-warden-cli` compiled natively via `clang`), 3 built-in automotive presets extracted from COVESA VSS v3 (`signal_catalog.json`), an independent TypeScript reference state-machine oracle (`evaluateVssWardenOracle`), and a Shape 1 `fast-check` conditional Property-Based Testing suite verifying `P1_VSS_BOUNDS_AND_UPSTREAM_FIX`, `P2_PRIORITY_ARBITRATION_PREEMPTION`, and `P3_DEAD_OWNER_LEASE_RECOVERY` at every step.

**Blocked by:** None — can start immediately

**Status:** `ready-for-agent`

**Needs:** None — a worker can check every item unaided (`/usr/bin/clang` and `node` are available locally)

**Validation method:** Run `node --experimental-strip-types --test tests/warden-core-pbt.test.ts` covering Role 1 concrete capability examples (3 automotive presets, upstream `FLOAT` default & `VECTOR_UINT32` bug-fix verification, 4 path notations, JSONC comment stripping, boundary rejections), Role 2 `fast-check` Shape 1 property guardians (`P1..P3` checked after every step across `1..30` generated operations over `INT8`, `FLOAT`, `STRING` enum, and `UINT32[]` actuator schemas, with aggregate reachability counters verified outside `fc.property`), and Role 3 test-local oracle calibration (`P1`, `P2`, and `P3` individually evaluating to `false` on mutated traces without production fault switches) plus deterministic shrunken counterexample replay.

**Evidence required:** `node --experimental-strip-types --test tests/warden-core-pbt.test.ts` exit code `0` with passing output for Role 1 concrete examples, Role 2 `fast-check` property runs + reachability witness counts, and Role 3 individual `P1`/`P2`/`P3` calibration controls + deterministic replay.

**Tests:** `required`

**Test seam:** `runWardenCoreSequence(catalogJsonc, operations, mode)` and `evaluateVssWardenOracle(catalog, operations, unguardedTrace, guardedTrace)`

**Regression scope:** Maintain Shape 1 conditional PBT invariants `P1_VSS_BOUNDS_AND_UPSTREAM_FIX` (enforce `min`/`max`/`allowed`/`arraysize` with `ERANGE`/`EINVAL`, preserve non-zero `FLOAT`/`DOUBLE` defaults fixing `qpp/value.c:438,445`, and support `VECTOR_UINT32` values above `65535` up to `UINT32_MAX` fixing `qpp/value.c:73`), `P2_PRIORITY_ARBITRATION_PREEMPTION` (higher priority preempts lower priority, lower priority fails with `EBUSY` without mutating `.control` and populates `lastRejection` in `?warden`), and `P3_DEAD_OWNER_LEASE_RECOVERY` (`CLOSE` / `CRASH_DISCONNECT` or `ADVANCE_CLOCK` crossing `leaseExpiresMs` releases the lock and rolls back to the highest surviving standby request or VSS `default` value) across `1..30` step sequences.

- [ ] `runWardenCoreSequence(catalogJsonc, operations, mode)` compiles and executes the portable C11 engine (`vss-warden-cli`) in a single batch invocation, returning step-by-step `WardenStepReceipt` items (including IEEE-754 `committedHex`, `activeHolder`, and `lastRejection`) for both `unguarded` (`Raw QPP`) and `guarded` (`VssWarden`) modes — Source: Story 1, Story 2
- [ ] `evaluateVssWardenOracle` verifies `P1_VSS_BOUNDS_AND_UPSTREAM_FIX`: out-of-range numeric writes return `ERANGE`, invalid `allowed` enum strings or oversized arrays return `EINVAL`, non-zero `FLOAT`/`DOUBLE` catalog defaults are preserved (not corrupted to `0.0`), and `UINT32[]` values above `65535` succeed up to `UINT32_MAX` — Source: Story 1
- [ ] `evaluateVssWardenOracle` verifies `P2_PRIORITY_ARBITRATION_PREEMPTION`: while a higher-priority caller holds an active `.control` lease, lower-priority writes fail with `EBUSY`, leave `committedControlValue` unchanged, and record `ruleId: "PRIORITY_PREEMPTED"` in the `?warden` diagnostic receipt — Source: Story 2, Story 4
- [ ] `evaluateVssWardenOracle` verifies `P3_DEAD_OWNER_LEASE_RECOVERY`: when the active holder executes `CLOSE` (`NORMAL_CLOSE` or `CRASH_DISCONNECT`) or `ADVANCE_CLOCK` advances past `leaseExpiresMs`, the lock releases and `committedControlValue` rolls back to the highest-priority open standby request or the signal's VSS `default` safe value — Source: Story 3
- [ ] Catalog inputs containing C-style `/* ... */` header comments (as in the official 9,706-line `signal_catalog.json:1-57`) parse cleanly without `SyntaxError`, and all 4 `QPP` path notations (`Vehicle.Body.Mirrors.Left.Pan`, `Vehicle/Body/Mirrors/Left/Pan`, `Vehicle/Body/Mirrors/Left/.Pan.control`, `Vehicle/Body/Mirrors/Left/Pan?control,text`) resolve to the same canonical actuator node — Source: Story 1 — Failure: F2, F5
- [ ] Empty catalog input, malformed JSONC, unknown signal path (`ENOENT`), or closed file descriptor (`EBADF`) returns a structured error status rather than crashing or silently passing — Source: Story 1 — Failure: F6

## Verification Log

- **Batch Execution & Testing Mode Approval**: Base execution mode = `Subagent-Driven` (`1b`), Testing mode = `tdd` (`2a`), covered tickets = `01`, `02`, `03`, user verbatim = `"1b, 2a"`.

