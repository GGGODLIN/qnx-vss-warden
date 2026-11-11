# VssWarden — Mixed-Criticality COVESA VSS Safety Gatekeeper & Verification Studio for QNX 8.0 QPP

`VssWarden` is an upstream-compatible C11 safety gatekeeper, priority-lease `.control` actuator arbiter, and property-based verification studio for BlackBerry QNX's open-source [QNX POSIX Publish Subscribe (QPP)](https://github.com/qnx/qnx-posix-publish-subscribe) resource manager on QNX Neutrino RTOS 8.0.

Host verification covers the portable C11 engine and the real upstream QPP catalog/open/read/write/close handlers at commit `b5ca892f`, built on Linux with test-only QNX transport and JSON compatibility layers. **QNX SDP 8.0 cross-compilation, QEMU target execution, and hardware behavior have not been verified.** The video shows the host Studio, not a QNX target recording.

The Studio and API execute the same C source as a bundled WASI module (`runtimeEngine: "c11-wasi"`). They require Node.js, not a runtime C compiler or a macOS executable. QNX priority comes from the client context; a path modifier can lower that priority but cannot raise it above `ctp->info.priority`.

---

## QNX Global Hackathon Category & Bonus Prize Mapping

| Track / Prize | Target Category | How `VssWarden` Delivers |
| --- | --- | --- |
| **Primary Category** | **2. Automotive & Mobility** | Enforces COVESA Vehicle Signal Specification (VSS v3) `min`, `max`, `allowed`, and `arraysize` bounds at the QNX `QPP` resource-manager boundary (`ERANGE` / `EINVAL`) and arbitrates mixed-criticality ADAS vs. IVI `.control` actuator writes. |
| **Bonus Prize 1** | **Best Use of QNX-specific Technologies** | Hooks directly into QNX 8.0 `resmgr_attach` / `<sys/iofunc.h>` Open Control Block (`io_close_ocb`) lifecycle callbacks, client priority (`ctp->info.priority` / `pid`), `CLOCK_MONOTONIC` lease timers, and a zero-SDK `?warden` POSIX path modifier (`OP_MODE_WARDEN`). |
| **Bonus Prize 2** | **Best Codelab / Tutorial** | Ships a built-in interactive `<google-codelab>` tutorial at `/codelab` ([app/codelab/page.tsx](/app/codelab/page.tsx)) walking developers step-by-step through the 3 upstream `QPP` gaps, zero-fuzz patching, POSIX `echo`/`cat ?warden,text` arbitration, and `fast-check` property-based verification. |

---

## Demo Video & Visual Walkthrough

- **45-Second Narrated Launch & Technical Demo Video (`1080p30`, 180° shutter motion blur, Kokoro VO + bilingual EN/ZH-TW subtitles)**: [docs/media/vss-warden-demo.mp4](/docs/media/vss-warden-demo.mp4)
- **12-Frame Contact Sheet**: [docs/media/stills.png](/docs/media/stills.png)

| Beat 1 — POSIX `.control` Collision Hook (`t = 9.20s`) | Beat 2 — Split-Timeline Priority Preemption (`t = 19.45s`) |
| --- | --- |
| ![Beat 1 — POSIX .control Collision Hook](/docs/media/01-aeb-infotainment-collision-hook.png) | ![Beat 2 — Split-Timeline Priority Preemption](/docs/media/02-split-timeline-priority-preemption.png) |
| **Beat 3 — Upstream `QPP` 3-Bug Hex Probe (`t = 27.05s`)** | **Beat 4 — Crash / TTL Lease Recovery (`t = 33.75s`)** |
| ![Beat 3 — Upstream QPP 3-Bug Hex Probe](/docs/media/03-upstream-qpp-3-bugs-hex-probe.png) | ![Beat 4 — Crash Lease Recovery & Seal](/docs/media/04-crash-lease-recovery-and-seal.png) |

### Web UI — Two-Channel Arbitration Bench (`/`) & Interactive Codelab (`/codelab`)

| Two-Channel Arbitration Bench (`/`) | IEEE-754 Binary32 & `?warden` Inspector (`/`) | Interactive `<google-codelab>` Workshop (`/codelab`) |
| --- | --- | --- |
| ![Two-Channel Arbitration Bench](/docs/media/05-studio-arbitration-bench.png) | ![IEEE-754 Memory Inspector](/docs/media/06-studio-ieee754-memory-inspector.png) | ![Interactive Codelab Workshop](/docs/media/07-interactive-codelab-workshop.png) |

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
- [patches/qpp-vss-warden.patch](/patches/qpp-vss-warden.patch): Unified diff for 13 original upstream files, including `meson.build`, `node.{c,h}`, `ocb.h`, catalog, open, both read/write paths, close, value and metadata. [scripts/apply-qpp-patch.sh](/scripts/apply-qpp-patch.sh) checks the pinned base, applies with zero fuzz, and copies the core plus [QPP adapter](/src/c/qpp_warden.c).
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
# Executes the C11 build with -lm; presets are generated from lib/presets.ts.

# 3. Run the complete test suite (Shape 1 fast-check PBT P1..P3 + patch --fuzz=0 gate + Studio/Codelab tests)
npm test

# 4. Run TypeScript typechecking and Next.js production build
npm run typecheck
npm run build

# 5. Start the Side-by-Side Verification Studio & Interactive Codelab on http://localhost:3000
npm run dev
```

Replay any preset deterministically from the terminal in one line. `--seed` drives an unsigned 32-bit LCG and adds reproducible 10–50 ms timing increments to timed operations. Different seeds change actual lease-expiry timestamps. The API uses the same generator and the CLI presets are generated from [lib/presets.ts](/lib/presets.ts):

```bash
./build/vss-warden-cli --preset preset-1-bounds-float-bug --seed 20261105
./build/vss-warden-cli --preset preset-2-adas-vs-ivi-hijack --seed 20261105
./build/vss-warden-cli --preset preset-3-crash-lease-rollback --seed 20261105
```

### 2. QNX Neutrino RTOS 8.0 target build — not target-verified

Use a licensed QNX SDP 8.0 Linux host with `qnxsdp-env.sh`, Meson and Ninja. The [official qcc reference](https://www.qnx.com/developers/docs/8.0/com.qnx.doc.neutrino.utilities/topic/q/qcc.html) lists `gcc_ntoaarch64le` and `gcc_ntox86_64` for C. The C++ library variant is `gcc_ntoaarch64le_cxx`, not `gcc_ntoaarch64_cxx`.

From the VssWarden checkout:

```bash
source ~/qnx800/qnxsdp-env.sh
git clone https://github.com/qnx/qnx-posix-publish-subscribe qpp-patched
git -C qpp-patched checkout b5ca892f
bash scripts/apply-qpp-patch.sh qpp-patched
mkdir -p build
qcc -Vgcc_ntox86_64 -std=c11 -O2 src/c/vss_warden_core.c src/c/vss_warden_cli.c -lm -o build/vss-warden-cli-qnx800
# For an AArch64 target use -Vgcc_ntoaarch64le instead.
```

Create `qnx-x86_64.ini` in the upstream checkout:

```ini
[binaries]
c = ['qcc', '-Vgcc_ntox86_64']
ar = 'ntox86_64-ar'
strip = 'ntox86_64-strip'
[host_machine]
system = 'qnx'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
```

```bash
meson setup qpp-patched/build-qnx qpp-patched --cross-file qpp-patched/qnx-x86_64.ini
meson compile -C qpp-patched/build-qnx
```

The upstream build also requires the SDP `json`, `slog2` and `socket` libraries. Its QNX `qpp` executable is not a Linux filesystem service; host integration below replaces only the transport/JSON interfaces and invokes the real handlers.

### 3. QEMU QNX 8.0 boot, mount and run — not target-verified

On the SDP Linux host, use the [official mkqnximage utility](https://www.qnx.com/developers/docs/8.0/com.qnx.doc.neutrino.utilities/topic/m/mkqnximage.html) with QEMU installed:

```bash
mkdir -p qnx-vm
cd qnx-vm
mkqnximage --type=qemu --arch=x86_64 --build
mkqnximage --run
mkqnximage --getip
```

Copy `qpp-patched/build-qnx/qpp/qpp`, `build/vss-warden-cli-qnx800` and a supported catalog to the guest with `scp` using the guest address and account supplied by that image. From a writable guest directory, mount the resource manager and run the CLI:

```bash
chmod +x ./qpp ./vss-warden-cli-qnx800
./qpp -s -c ./signal_catalog.json -m /dev/signal &
./vss-warden-cli-qnx800 --preset preset-2-adas-vs-ivi-hijack --seed 20261105
```

For the shell example below, use a catalog containing `Vehicle/ADAS/CruiseControl/SpeedSet` (`int8`, min 0, max 120, default 0). In separate guest consoles start `on -p60 sh` for ADAS and `on -p10 sh` for IVI. Keep ADAS fd 3 open; a one-shot shell redirection closes its OCB and immediately releases its lease.

```bash
# ADAS shell (P60):
exec 3>"/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=60,lease=60000,as=ADAS_AEB"
echo "0" >&3
# IVI shell (P10), while ADAS fd 3 stays open:
echo "110" > "/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=10,as=IVI_EcoMode"
cat "/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?warden,text"
# ADAS shell: release the lease, then query again from either shell.
exec 3>&-
```

Expected: IVI receives `EBUSY`; `steps[0].wardenPayload` in the JSON receipt identifies the holder and rejection. Closing the holder restores a live standby or the VSS default. `CLOCK_MONOTONIC` expiry is evaluated on the next read/write/close; this patch does not schedule an idle hardware actuation timer.

### 4. Host QPP integration and Serverless runtime

The [host integration fixture](/tests/qpp-host/meson.build) compiles the patched upstream catalog, node/tree, open, text/binary read/write, close and value/metadata sources. It uses `json-c` plus test-only QNX message compatibility headers. With `libjson-c-dev`, Meson and Ninja installed on Linux:

```bash
meson setup build/qpp-host tests/qpp-host -Dqpp_source="$(pwd)/qpp-patched/qpp"
meson compile -C build/qpp-host
meson test -C build/qpp-host --print-errorlogs
```

The default web path executes [runtime/vss-warden.wasm](/runtime/vss-warden.wasm) through Node's WASI preview1 runtime and only writes temporary stdin/stdout files under the OS temp directory. [next.config.ts](/next.config.ts) includes both runtime files in the API function. `npm run build` needs no C compiler. Native tests still use `npm run build:c`; if the C source or presets change, regenerate the bundled module with the [official WASI SDK](https://github.com/WebAssembly/wasi-sdk):

```bash
WASI_SDK_PATH=/path/to/wasi-sdk bash scripts/build-wasi.sh
```

WASI preview1 emits Node's experimental-feature warning. This is host verification of the C engine, not QNX scheduling or resource-manager kernel behavior. Supported guarded data types are the numeric scalars, `string`, and `uint32[]` represented by the core header; unsupported catalog types fail initialization rather than silently bypassing protection.

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](/LICENSE) and [NOTICE](/NOTICE) for full attribution of BlackBerry Limited's Apache-2.0 `qnx/qnx-posix-publish-subscribe` interfaces.
