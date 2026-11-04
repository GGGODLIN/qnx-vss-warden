## Problem Statement

BlackBerry QNX recently open-sourced the **QNX POSIX Publish Subscribe (`QPP`)** service (`qnx/qnx-posix-publish-subscribe`), a QNX 8.0 file-system Resource Manager (`resmgr_attach`) that mounts a COVESA Vehicle Signal Specification (VSS v3) catalog as standard POSIX files (`Value`, `.Name.control`, and `.Name.metadata`) so automotive applications can read sensor state and request actuator changes using ordinary `open()`, `read()`, `write()`, `echo`, and `cat` operations.

However, inspecting the upstream `QPP` documentation and C source code reveals three safety and correctness gaps that prevent mixed-criticality Software-Defined Vehicle (SDV) workloads from safely sharing a `QPP` tree:

1. **Unenforced VSS Bounds & Upstream Value/Metadata Bugs**: The upstream table in `qpp/README.md` (`lines 187–199`) explicitly marks the COVESA VSS attributes `min`, `max`, `allowed`, and `arraysize` as `Used By QPP? NO`. Furthermore, upstream `qpp/value.c` (`lines 434–447`) decodes JSON `FLOAT`/`DOUBLE` defaults into `json_d` but assigns the zero-initialized integer `json_l` (`0`), silently corrupting every floating-point default value to `0.0`; `qpp/value.c` (`line 73`) caps `VECTOR_UINT32` at `UINT16_MAX` (`65535`) with 2-byte element size; and `qpp/metadata.c` (`lines 54–59`) hardcodes string decoding so querying numeric `min`/`max` or array `allowed` attributes fails with `EINVAL`.
2. **Blind Last-Write-Wins on `.control` Actuators (`Actuator Hijack`)**: As documented in `qpp/README.md` (`line 224`) and implemented in `qpp/iowrite.c` (`lines 78–90`) and `qpp/iowrite_text.c` (`lines 112–124`), concurrent writes to an actuator's `.control` file unconditionally overwrite the previous request. A low-criticality infotainment or cabin comfort script (`Priority P3`) writing to a shared actuator (such as hazard lights, windshield wiper mode, or ADAS cruise control) immediately overwrites an active command from a high-criticality safety loop (`Priority P0`).
3. **No Crash / Disconnect Lease Recovery or POSIX-Readable Rejection Diagnostics**: When a `.control` write fails, POSIX `write()` returns only `-1` and `errno` while `QPP` suppresses `QLOG_WRN` messages in production console mode (`qpp/main.c` `line 160`) and does not increment `dattr->version`, leaving engineers blind as to which rule or higher-priority owner blocked the write. Conversely, if a high-priority holder locks an actuator and then crashes or disconnects without releasing it, a naive priority lock permanently wedges the actuator unless tied to QNX Open Control Block (`io_close_ocb`) lifecycle cleanup and monotonic lease expiry (`CLOCK_MONOTONIC`) with automatic safe-state rollback.

## Solution

**`VssWarden`** is an upstream-compatible C11 safety gatekeeper, mixed-criticality actuator arbiter, and property-based verification studio for QNX 8.0 `QPP`, competing in the **Automotive & Mobility** category of the QNX Global Hackathon (with built-in eligibility for **Best Use of QNX-specific Technologies** and **Best Codelab / Tutorial**).

`VssWarden` preserves 100% of `QPP`'s zero-SDK POSIX file and CLI experience (`open`/`read`/`write`/`echo`/`cat` with `?` path modifiers) by delivering:
1. **A Portable C11 Core Engine & Upstream-Ready QNX 8.0 `QPP` Patch**: Pre-compiles COVESA VSS v3 `min`, `max`, `allowed`, and `arraysize` constraints at catalog load time (stripping C-style `/* ... */` header comments from upstream `signal_catalog.json`), fixes the three upstream `QPP` value/metadata bugs, arbitrates `.control` writes using caller priority (`ctp->info.priority` on QNX 8.0 or `?priority=<N>,lease=<ms>,as=<role>` path modifiers), automatically recovers from holder crash (`io_close_ocb`) or monotonic lease expiry by rolling back to the highest surviving pending request or the VSS `default` safe value, and exposes a `?warden` POSIX diagnostic modifier returning structured JSON receipts.
2. **A Zero-Key Host Verification Studio, Conditional PBT Suite & Interactive `<google-codelab>`**: Compiles the exact same C11 core natively via `clang` on macOS/Linux so a Next.js side-by-side verification studio (`Raw QPP` vs. `VssWarden`) and a Shape 1 `fast-check` property-based test suite (`P1..P3`) execute directly against the compiled C engine with one-line reproducible CLI execution receipts and an embedded step-by-step QNX 8.0 Codelab.

## User Stories

1. As an automotive systems engineer using QNX `QPP`, I want `.control` and `Value` writes that violate COVESA VSS `min`, `max`, `allowed`, or `arraysize` constraints to be deterministically rejected (`ERANGE` for numeric range violations, `EINVAL` for enum or array-size violations) while preserving valid `FLOAT`/`DOUBLE` catalog defaults and `VECTOR_UINT32` ranges, so that out-of-range actuator requests never reach vehicle hardware and upstream `QPP` catalog bugs are eliminated. `[evidence: qpp/README.md:187-199, qpp/value.c:73,434-447, qpp/metadata.c:54-59]`
2. As an SDV integration engineer running mixed-criticality processes on QNX 8.0, I want `.control` actuator nodes to arbitrate writes by caller priority and lease ownership (accepting higher-priority preemption, enforcing FIFO within equal priority while held, and rejecting lower-priority interference with `EBUSY` or unauthorized callers with `EPERM`), so that an infotainment app cannot overwrite an active ADAS or safety command. `[user: "1a, 2a, 3a"]`
3. As a safety systems architect, I want an active high-priority actuator lease to automatically release when the holder closes its file descriptor / crashes (`io_close_ocb`) or when its monotonic lease timer (`CLOCK_MONOTONIC` TTL) expires, rolling the `.control` state back to the highest-priority still-active pending request or the VSS catalog's `default` safe value, so that a crashed high-priority process never permanently deadlocks an actuator. `[user: "1a, 2a, 3a"]`
4. As an on-call embedded developer debugging a rejected `.control` write from the terminal, I want to run a standard POSIX `cat` on the `?warden` path modifier (e.g., `/dev/signal/Vehicle/Body/Mirrors/Left/Pan?warden,text`) and receive a structured JSON diagnostic receipt showing the active compiled constraints, current winning owner/PID/priority/lease TTL, and the exact reason and `errno` of the last rejected write, so that I can diagnose any blocked actuation in one command without custom SDKs. `[evidence: brainstorm-review-2026-11-04.md §2 Seat 3 & Seat 5]`
5. As a QNX Global Hackathon judge evaluating the project in under 3 minutes without external API keys or physical Raspberry Pi hardware, I want a zero-config side-by-side verification studio (`Raw QPP` vs. `VssWarden`) pre-loaded with 3 real automotive presets from the official 9,706-line `signal_catalog.json`, live Shape 1 `fast-check` PBT verification (`P1..P3`) backed by the compiled C engine, a copyable one-line C CLI replay command with IEEE-754 hex receipts, and an interactive `<google-codelab>` tutorial page, so that I can verify both the QNX 8.0 engineering depth and the end-to-end product experience immediately. `[evidence: qnx-rules.md:86-114,154-165]`

## Implementation Decisions

- **Clean Standalone Repository & Apache-2.0 Licensing Compliance**: Initialize the project as a brand-new Git repository (never a GitHub fork of `qnx/qnx-posix-publish-subscribe` and containing zero upstream commit history) with a top-level Apache-2.0 `LICENSE` and `NOTICE` file that attributes BlackBerry Limited's Apache-2.0 `qnx/qnx-posix-publish-subscribe` interfaces and ships a clean unified patch (`--fuzz=0` compatible) alongside the standalone portable C11 engine. `[evidence: qnx-rules.md:78,86,128 & brainstorm-review-2026-11-04.md §2 Seat 4]`
- **Zero-QNX-Header Portable C11 Core (`libvsswarden_core`) + Thin QNX 8.0 Resource Manager Integration**: Implement all catalog comment-stripping, VSS constraint pre-compilation, upstream `FLOAT`/`DOUBLE`/`VECTOR_UINT32` bug fixes, priority-lease state machine transitions, and `?warden` JSON formatting in a pure C11 module that depends only on standard C headers (`<stdint.h>`, `<stdbool.h>`, `<stdlib.h>`, `<string.h>`, `<stdio.h>`, `<errno.h>`). The QNX 8.0 target adapter maps `<sys/iofunc.h>` `ctp->info` (`pid`, `tid`, `priority`, `scoid`) and `io_close_ocb` callbacks into this core, while the Host CLI binary compiles natively via `clang` on macOS/Linux so both environments execute the exact same C implementation. `[evidence: brainstorm-review-2026-11-04.md §2 Seat 1, Seat 2, Seat 4, Seat 6]`
- **Single Source of Truth for Catalog Schema & Path Canonicalization**: Treat COVESA VSS v3 JSON/JSONC catalogs (including the official `signal_catalog.json` with its 57-line C `/* ... */` header comment stripped before parsing) as the sole source of truth for `datatype`, `type`, `default`, `min`, `max`, `allowed`, and `arraysize`. Canonicalize all four `QPP` path notations (`Vehicle.ADAS.ABS.IsEnabled`, `Vehicle/ADAS/ABS/IsEnabled`, `Vehicle/ADAS/ABS/.IsEnabled.control`, and `Vehicle/ADAS/ABS/IsEnabled?control,text`) to a single canonical slash-separated signal key plus target kind (`VALUE` | `CONTROL` | `METADATA` | `WARDEN`). `[evidence: brainstorm-review-2026-11-04.md §2 Seat 3 & Seat 6]`
- **Deterministic `.control` Arbitration & Lease State Machine**: Each actuator node maintains its current committed value, active holder lease (`holder_fd`, `client_role`, `pid`, `priority`, `lease_expires_ms`), and a bounded slot for the highest-priority still-open standby request:
  ```ts
  // Prototype decision shape for per-step C engine & Oracle verification
  type WardenOperation =
    | { kind: "OPEN"; fd: number; path: string; pid: number; priority: number; leaseMs: number; role: string }
    | { kind: "WRITE"; fd: number; value: number | string | boolean | number[]; nowMs: number }
    | { kind: "CLOSE"; fd: number; reason: "NORMAL_CLOSE" | "CRASH_DISCONNECT"; nowMs: number }
    | { kind: "ADVANCE_CLOCK"; deltaMs: number }
    | { kind: "READ_WARDEN"; path: string; nowMs: number };

  interface WardenStepReceipt {
    stepIndex: number;
    opKind: WardenOperation["kind"];
    status: "EOK" | "ERANGE" | "EINVAL" | "EBUSY" | "EPERM" | "EBADF" | "ENOENT";
    committedControlValue: number | string | boolean | number[] | null;
    committedHex: string;
    activeHolder: { fd: number; role: string; pid: number; priority: number; leaseExpiresMs: number | null } | null;
    lastRejection: {
      callerRole: string;
      callerPid: number;
      callerPriority: number;
      attemptedValue: string;
      errnoCode: string;
      ruleId: "VSS_MIN_MAX" | "VSS_ALLOWED_ENUM" | "VSS_ARRAY_SIZE" | "PRIORITY_PREEMPTED" | "ROLE_UNAUTHORIZED";
      reason: string;
    } | null;
  }
  ```
  Higher numeric QNX priority (`priority > activeHolder.priority`, or equal priority from the same `holder_fd`, or any authorized writer after `nowMs >= activeHolder.leaseExpiresMs`) succeeds with `EOK` and updates the `.control` value; lower-priority writes while an active lease is held fail with `EBUSY` without mutating `.control` and record `lastRejection`; when the active holder executes `CLOSE` (`io_close_ocb` on crash/close) or `ADVANCE_CLOCK` crosses `leaseExpiresMs`, the engine automatically promotes the highest-priority open standby request or falls back to the signal's VSS `default` value. `[user: "1a, 2a, 3a"]`
- **Persistent Batch C Execution for `fast-check` & Zero-Key Studio API**: Run `fast-check` property suites and Next.js verification requests against the compiled C binary (`vss-warden-cli`) using batch JSON/NDJSON input over a single invocation per test batch (or in-memory batch mode) rather than forking a subprocess per operation step, keeping full `P1..P3` property verification under 2 seconds with zero external LLM API keys required. Cap incoming HTTP request bodies at `512 KB` and operation sequences at `500` steps per request (`400 PAYLOAD_TOO_LARGE` on overflow). `[evidence: brainstorm-review-2026-11-04.md §2 Seat 2]`
- **Side-by-Side Verification Studio, Race-Safe UI Reducer & Built-In `<google-codelab>`**: Build the Host UI with 3 zero-config automotive presets extracted from `signal_catalog.json` (Preset 1: `Vehicle/Body/Mirrors/Left/Pan` `[-100, 100]` & `Wiping/Mode` `allowed` bounds + upstream `FLOAT` default bug proof; Preset 2: `ADAS AEB (P60)` vs. `IVI EcoMode (P10)` `.control` hijack defense; Preset 3: `ADAS CruiseControl` holder crash & monotonic TTL safe-state rollback), a `useReducer` state model with `activeRequestId` stale-response protection, a side-by-side `Raw QPP (Unguarded)` vs. `VssWarden (Guarded)` timeline, a copyable one-line `./build/vss-warden-cli` replay command on every run, and an interactive `<google-codelab>` tutorial page. `[evidence: brainstorm-review-2026-11-04.md §2 Seat 3 & Seat 5]`

## Testing Decisions

- **What makes a good test**: Tests verify external behavior at the two confirmed public seams—observing structured `WardenStepReceipt` outputs, POSIX `errno` codes (`EOK`, `ERANGE`, `EINVAL`, `EBUSY`, `EPERM`), `?warden` JSON diagnostics, HTTP API responses, and `patch --fuzz=0` clean application—without coupling to internal C struct layout or private helper functions.
- **Modules under test**:
  - **Seam 1 (`runWardenCoreSequence` + `evaluateVssWardenOracle`)**: The compiled C11 core engine (`vss-warden-cli`), catalog comment-stripper/parser, and independent TypeScript specification oracle.
  - **Seam 2 (`POST /api/vss-warden/verify` + `studioReducer` + `patches/qpp-vss-warden.patch` + Codelab)**: The Next.js verification endpoint, studio UI reducer & preset flows, zero-fuzz upstream QPP patch verification, and `<google-codelab>` step structure.
- **Prior art**: Follows the three-role Conditional PBT architecture in `/Users/linhancheng/.claude/skills/tdd/tests.md` (`Role 1: Concrete Capability Examples`, `Role 2: Safety Property Guardians (fc.property)`, `Role 3: Oracle Calibration & Counterexample Replay`).
- **Conditional PBT Specification (Shape 1 — Multi-Step State Machines & Interlocking Transitions)**:
  - **Applicability domain**: Generated action sequences (`1..30` steps per run across `OPEN`, `WRITE`, `CLOSE`, `ADVANCE_CLOCK`, `READ_WARDEN`) operating on valid VSS actuator schemas (`INT8` range `[-100, 100]`, `FLOAT` range `[-40.0, 125.0]` with non-zero default `22.5`, `STRING` enum `["OFF", "SLOW", "MEDIUM", "FAST"]`, `UINT32[]` array up to `4,294,967,295`) with caller priorities in `1..63`, lease TTLs in `50..2000 ms`, and clock steps in `10..1000 ms`.
  - **Mapped Invariants (`P1..P3`) checked after *every individual step***:
    - **`P1_VSS_BOUNDS_AND_UPSTREAM_FIX`**: Every `WRITE` whose value is outside `[min, max]`, not in `allowed`, or exceeds `arraysize` MUST return `ERANGE` or `EINVAL` and leave `committedControlValue` unchanged; initial catalog load MUST preserve non-zero `FLOAT`/`DOUBLE` defaults (never corrupting them to `0.0` as in unpatched `qpp/value.c:438,445`) and allow `VECTOR_UINT32` elements above `65535` up to `UINT32_MAX` (fixing `qpp/value.c:73`).
    - **`P2_PRIORITY_ARBITRATION_PREEMPTION`**: While an active lease is held by `activeHolder` (`nowMs < activeHolder.leaseExpiresMs` and holder FD not closed), any valid `WRITE` from a caller with `priority < activeHolder.priority` MUST be rejected with `EBUSY`, MUST NOT overwrite `committedControlValue`, and MUST populate `lastRejection` with `ruleId === "PRIORITY_PREEMPTED"`; any valid `WRITE` with `priority > activeHolder.priority` (or from the same `holder_fd`) MUST succeed with `EOK` and become the new `activeHolder`.
    - **`P3_DEAD_OWNER_LEASE_RECOVERY`**: Immediately after the active holder executes `CLOSE` (`NORMAL_CLOSE` or `CRASH_DISCONNECT`) or `ADVANCE_CLOCK` advances `nowMs >= activeHolder.leaseExpiresMs`, the expired/closed holder MUST no longer hold the lock, `committedControlValue` MUST deterministically transition to the highest-priority non-expired open standby request (or the VSS catalog `default` value if none exists), and subsequent lower-priority valid writes MUST no longer be blocked by the dead holder.
  - **Independent Oracle boundary**: `evaluateVssWardenOracle(catalog, operations, unguardedTrace, guardedTrace)` is a pure, independent TypeScript reference state machine that computes the expected step-by-step state from first principles without calling or sharing code with the C engine; Role 2 verifies `P1 && P2 && P3` at every step and checks aggregate reachability witnesses (`appliedCount > 0`, `boundsRejectedCount > 0`, `priorityBlockedCount > 0`, `leaseRecoveredCount > 0`) outside `fc.property`; Role 3 calibrates `P1`, `P2`, and `P3` individually on test-local mutated traces (`P1 === false`, `P2 === false`, `P3 === false`) without production fault switches.

## Out of Scope

- External proxy daemon (`vss-wardend` over a separate IPC mount point) that duplicates `QPP`'s tree in a second process.
- Cross-file multi-signal transaction snapshots (`/dev/signal/.snapshot`), per Seat 1 YAGNI decision (`1a`).
- Paid or cloud-key-dependent LLM API calls in the verification loop.
- Hardware CAN-bus physical wiring or proprietary BSP driver development (all verification runs deterministically on Host C + `QPP` patch verification).

## Further Notes

- Submission targets **Primary Category: `2. Automotive & Mobility`**, **Bonus Prize 1: `Best Use of QNX-specific Technologies`**, and **Bonus Prize 2: `Best Codelab / Tutorial`** (`<google-codelab>` hosted at `/codelab`).
