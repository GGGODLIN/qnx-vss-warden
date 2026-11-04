# VssWarden — Mixed-Criticality COVESA VSS Safety Gatekeeper & Verification Studio for QNX 8.0 QPP

`VssWarden` is an upstream-compatible C11 safety gatekeeper, priority-lease `.control` actuator arbiter, and property-based verification studio for BlackBerry QNX's open-source [QNX POSIX Publish Subscribe (QPP)](https://github.com/qnx/qnx-posix-publish-subscribe) resource manager on QNX Neutrino RTOS 8.0.

---

## QNX Global Hackathon Category & Bonus Prize Mapping

| Track / Prize | Target Category | How `VssWarden` Delivers |
| --- | --- | --- |
| **Primary Category** | **2. Automotive & Mobility** | Enforces COVESA Vehicle Signal Specification (VSS v3) `min`, `max`, `allowed`, and `arraysize` bounds at the QNX `QPP` resource-manager boundary (`ERANGE` / `EINVAL`) and arbitrates mixed-criticality ADAS vs. IVI `.control` actuator writes. |
| **Bonus Prize 1** | **Best Use of QNX-specific Technologies** | Hooks directly into QNX 8.0 `resmgr_attach` / `<sys/iofunc.h>` Open Control Block (`io_close_ocb`) lifecycle callbacks, client priority (`ctp->info.priority` / `pid`), `CLOCK_MONOTONIC` lease timers, and a zero-SDK `?warden` POSIX path modifier (`OP_MODE_WARDEN`). |
| **Bonus Prize 2** | **Best Codelab / Tutorial** | Ships a built-in interactive `<google-codelab>` tutorial at `/codelab` ([app/codelab/page.tsx](/app/codelab/page.tsx)) walking developers step-by-step through the 3 upstream `QPP` gaps, zero-fuzz patching, POSIX `echo`/`cat ?warden,text` arbitration, and `fast-check` property-based verification. |

---

## The 3 Upstream QNX `QPP` Safety & Correctness Gaps Fixed by `VssWarden`

Inspecting the upstream `qnx/qnx-posix-publish-subscribe` (`qpp/`) source code reveals three critical gaps when running mixed-criticality Software-Defined Vehicle (SDV) workloads:

1. **Unenforced COVESA VSS Bounds & 3 Upstream Value/Metadata Bugs**:
   - `qpp/README.md` (`lines 187–199`): Marks the COVESA VSS attributes `min`, `max`, `allowed`, and `arraysize` as `Used By QPP? NO`.
   - `qpp/value.c` (`line 73`): Defines `[VECTOR_UINT32] = {0, UINT16_MAX, sizeof(uint16_t), "uint32[]"}`, erroneously capping 32-bit unsigned vectors at `65535` with a 2-byte element size instead of `UINT32_MAX` and `sizeof(uint32_t)`.
   - `qpp/value.c` (`lines 434–447`, specifically `line 438` for `FLOAT` and `line 445` for `DOUBLE`): Decodes JSON floating-point defaults into `json_d` via `json_decoder_get_double()`, but assigns the zero-initialized integer `json_l` (`0`), silently corrupting every non-zero `FLOAT`/`DOUBLE` catalog default (such as `22.5` °C HVAC temperature) to `0.0`.
   - `qpp/metadata.c` (`lines 54–59`): Calls `json_decoder_get_string()` on all metadata properties, causing queries for numeric `min`/`max` or array `allowed` attributes to fail with `EINVAL`.
2. **Blind Last-Write-Wins on `.control` Actuators (`Actuator Hijack`)**:
   - `qpp/README.md` (`line 224`), `qpp/iowrite.c` (`lines 78–90`), and `qpp/iowrite_text.c` (`lines 112–124`): Concurrent writes to an actuator's `.control` node unconditionally overwrite the previous request. A low-priority Infotainment script (`Priority P10`) can immediately overwrite an active emergency command from ADAS Automatic Emergency Braking (`Priority P60`).
3. **No Crash / Disconnect Lease Recovery (`io_close_ocb`) or POSIX Rejection Diagnostics (`?warden`)**:
   - `qpp/ioclose.c`, `qpp/ioopen.c`, and `qpp/main.c` (`line 160`): When a high-priority holder crashes or disconnects without releasing an actuator lock, a naive lock permanently deadlocks the actuator unless tied to `io_close_ocb` cleanup and `CLOCK_MONOTONIC` lease expiry with standby promotion or VSS `default` safe-state rollback. Furthermore, rejected POSIX writes return `-1` without structured diagnostics explaining which rule or higher-priority owner blocked the actuation.

---

## Repository Architecture

- [src/c/vss_warden_core.h](/src/c/vss_warden_core.h) & [src/c/vss_warden_core.c](/src/c/vss_warden_core.c): Portable C11 safety engine (`libvsswarden_core`) with zero QNX header dependencies, implementing comment stripping for `signal_catalog.json`, VSS constraint pre-compilation, priority-lease `.control` arbitration, `io_close_ocb` / `CLOCK_MONOTONIC` rollback, and `?warden` JSON diagnostics.
- [src/c/vss_warden_cli.c](/src/c/vss_warden_cli.c): Native C11 CLI runner supporting both `--preset <id> --seed <n>` deterministic replay and persistent JSON batch verification.
- [patches/qpp-vss-warden.patch](/patches/qpp-vss-warden.patch): Clean unified diff (`patch -p1 --fuzz=0`) patching `qpp/catalog.c`, `qpp/ioopen.c`, `qpp/iowrite.c`, `qpp/iowrite_text.c`, `qpp/ioclose.c`, `qpp/metadata.c`, and `qpp/value.c`.
- [lib/oracle.ts](/lib/oracle.ts) & [tests/warden-core-pbt.test.ts](/tests/warden-core-pbt.test.ts): Independent TypeScript state-machine oracle and Shape 1 `fast-check` Property-Based Testing suite (`P1..P3`).
- [app/page.tsx](/app/page.tsx) & [lib/studio-model.ts](/lib/studio-model.ts): Side-by-Side SDV Verification Studio (`Raw QPP (Unguarded)` vs. `VssWarden (Guarded)`) with race-safe `studioReducer` (`activeRequestId`) and clamped SVG timelines.
- [app/codelab/page.tsx](/app/codelab/page.tsx): Interactive step-by-step QNX 8.0 `<google-codelab>` tutorial.

---

## Reproducible Build & Verification Instructions

### 1. Host Build & Verification (macOS / Linux — Zero External API Keys)

Requirements: Node.js 22+ and `clang` (C11).

```bash
# 1. Install dependencies
npm install

# 2. Compile the portable C11 engine and CLI binary via clang
npm run build:c
# Executes: mkdir -p build && clang -std=c11 -O2 -Wall -Wextra src/c/vss_warden_core.c src/c/vss_warden_cli.c -o build/vss-warden-cli

# 3. Run the complete test suite (Shape 1 fast-check PBT P1..P3 + patch --fuzz=0 gate + Studio/Codelab tests)
npm test

# 4. Run TypeScript typechecking and Next.js production build
npm run typecheck
npm run build

# 5. Start the Side-by-Side Verification Studio & Interactive Codelab on http://localhost:3000
npm run dev
```

Replay any preset deterministically from the terminal in one line:

```bash
./build/vss-warden-cli --preset preset-1-bounds-float-bug --seed 20261105
./build/vss-warden-cli --preset preset-2-adas-vs-ivi-hijack --seed 20261105
./build/vss-warden-cli --preset preset-3-crash-lease-rollback --seed 20261105
```

### 2. QNX Neutrino RTOS 8.0 Target Build (`qcc` / `meson`)

Requirements: QNX Software Development Platform (SDP) 8.0 (`qnxsdp-env.sh`) and `meson` / `ninja`.

```bash
# 1. Load the QNX 8.0 SDP environment
source ~/qnx800/qnxsdp-env.sh

# 2. Clone upstream QPP (note: vendor/qpp-upstream/qpp/ in this repo is the 9-file snapshot
#    used for offline `patch -p1 --fuzz=0` regression verification) and apply the patch:
git clone https://github.com/qnx/qnx-posix-publish-subscribe.git /tmp/qpp-vss-warden-qnx
cp src/c/vss_warden_core.h src/c/vss_warden_core.c /tmp/qpp-vss-warden-qnx/qpp/
patch -p1 --fuzz=0 -d /tmp/qpp-vss-warden-qnx -i $(pwd)/patches/qpp-vss-warden.patch

# 3. Cross-compile with QNX 8.0 qcc (aarch64le or x86_64) via meson
cd /tmp/qpp-vss-warden-qnx
CC="qcc -Vgcc_ntoaarch64le" meson setup build-qnx
meson compile -C build-qnx

# Or compile the standalone C11 verification CLI directly for QNX 8.0 target:
qcc -Vgcc_ntoaarch64le -std=c11 -O2 -Wall -Wextra \
  src/c/vss_warden_core.c src/c/vss_warden_cli.c \
  -o build/vss-warden-cli-qnx800
```

### 3. Target POSIX CLI Usage on QNX 8.0 (`/dev/signal/`)

Once `qpp` is mounted at `/dev/signal`, standard POSIX shell commands interact with `VssWarden` without any custom SDK:

```bash
# High-priority ADAS AEB (priority 60, 1000ms lease) commands 0 km/h emergency stop:
echo "0" > "/dev/signal/Vehicle/ADAS/CruiseControl/.SpeedSet.control?priority=60,lease=1000,as=ADAS_AEB"

# Low-priority IVI EcoMode (priority 10) attempts to overwrite speed to 110 km/h -> rejected with EBUSY:
echo "110" > "/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=10,lease=1000,as=IVI_EcoMode"

# Query the structured ?warden JSON diagnostic receipt:
cat "/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?warden,text"
```

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](/LICENSE) and [NOTICE](/NOTICE) for full attribution of BlackBerry Limited's Apache-2.0 `qnx/qnx-posix-publish-subscribe` interfaces.
