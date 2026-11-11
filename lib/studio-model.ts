import { AUTOMOTIVE_PRESETS } from "./presets.ts";
import type {
  VssSignalValue,
  WardenErrno,
  WardenOperation,
  WardenStepReceipt,
  WardenVerifySuccessResponse,
} from "./types.ts";

export interface StudioState {
  selectedPresetId: string;
  seed: number;
  activeRequestId: number;
  isLoading: boolean;
  errorBanner: string | null;
  lastResponse: WardenVerifySuccessResponse | null;
}

export type StudioAction =
  | { type: "SELECT_PRESET"; presetId: string; seed?: number }
  | { type: "START_VERIFY"; presetId?: string; seed?: number }
  | {
      type: "VERIFY_SUCCESS";
      requestId: number;
      response: WardenVerifySuccessResponse;
    }
  | {
      type: "VERIFY_ERROR";
      requestId: number;
      errorCode: string;
      errorMessage: string;
    };

export interface TimelinePoint {
  stepIndex: number;
  opKind: WardenOperation["kind"];
  status: WardenErrno;
  x: number;
  y: number;
  numericValue: number;
  rawCommittedValue: VssSignalValue | null;
  committedHex: string;
  fullSignalPath: string;
  displaySignalPath: string;
}

export interface TimelineChartModel {
  viewBoxWidth: number;
  viewBoxHeight: number;
  valueMin: number;
  valueMax: number;
  unguardedPoints: TimelinePoint[];
  guardedPoints: TimelinePoint[];
  unguardedPolyline: string;
  guardedPolyline: string;
}

export interface CodelabStep {
  stepNumber: number;
  id: string;
  label: string;
  durationMinutes: number;
  summary: string;
  commands: string[];
  codeSnippet: string;
  upstreamReferences: string[];
}

const DEFAULT_PRESET_ID = "preset-1-bounds-float-bug";
const DEFAULT_SEED = 20261105;

export function createInitialStudioState(
  initialResponse: WardenVerifySuccessResponse | null = null
): StudioState {
  const candidatePresetId = initialResponse?.presetId ?? DEFAULT_PRESET_ID;
  const selectedPresetId =
    AUTOMOTIVE_PRESETS.find((p) => p.id === candidatePresetId)?.id ??
    DEFAULT_PRESET_ID;
  const seed = initialResponse?.seed ?? DEFAULT_SEED;
  const activeRequestId = initialResponse?.requestId ?? 1;

  return {
    selectedPresetId,
    seed,
    activeRequestId,
    isLoading: false,
    errorBanner: null,
    lastResponse: initialResponse,
  };
}

export function studioReducer(
  state: StudioState,
  action: StudioAction
): StudioState {
  switch (action.type) {
    case "SELECT_PRESET": {
      const nextRequestId = state.activeRequestId + 1;
      const nextSeed = action.seed ?? state.seed;
      const resolvedPresetId =
        AUTOMOTIVE_PRESETS.find((p) => p.id === action.presetId)?.id ??
        action.presetId;

      return {
        ...state,
        selectedPresetId: resolvedPresetId,
        seed: nextSeed,
        activeRequestId: nextRequestId,
        isLoading: true,
        errorBanner: null,
      };
    }

    case "START_VERIFY": {
      const nextRequestId = state.activeRequestId + 1;
      const nextPresetId = action.presetId ?? state.selectedPresetId;
      const nextSeed = action.seed ?? state.seed;

      return {
        ...state,
        selectedPresetId: nextPresetId,
        seed: nextSeed,
        activeRequestId: nextRequestId,
        isLoading: true,
        errorBanner: null,
      };
    }

    case "VERIFY_SUCCESS": {
      if (action.requestId !== state.activeRequestId) {
        return state;
      }
      return {
        ...state,
        isLoading: false,
        errorBanner: null,
        lastResponse: action.response,
      };
    }

    case "VERIFY_ERROR": {
      if (action.requestId !== state.activeRequestId) {
        return state;
      }
      return {
        ...state,
        isLoading: false,
        errorBanner: action.errorMessage,
      };
    }

    default:
      return state;
  }
}

const VIEWBOX_WIDTH = 640;
const VIEWBOX_HEIGHT = 220;
const PLOT_LEFT = 48;
const PLOT_RIGHT = 616;
const PLOT_TOP = 24;
const PLOT_BOTTOM = 184;
const MIN_CLAMP_VALUE = -1000;
const MAX_CLAMP_VALUE = 1000;
const MAX_SIGNAL_PATH_LABEL_CHARS = 32;

function clampFiniteNumericValue(raw: VssSignalValue | null): number {
  if (typeof raw === "number") {
    if (Number.isNaN(raw)) {
      return 0;
    }
    if (raw === Number.POSITIVE_INFINITY) {
      return MAX_CLAMP_VALUE;
    }
    if (raw === Number.NEGATIVE_INFINITY) {
      return MIN_CLAMP_VALUE;
    }
    return Math.max(MIN_CLAMP_VALUE, Math.min(MAX_CLAMP_VALUE, raw));
  }

  if (Array.isArray(raw)) {
    const first = raw[0] ?? 0;
    return clampFiniteNumericValue(first);
  }

  if (typeof raw === "string") {
    const enumScale: Record<string, number> = {
      OFF: 0,
      SLOW: 25,
      MEDIUM: 50,
      FAST: 75,
      HYPER_TURBO: 120,
    };
    if (raw in enumScale) {
      return enumScale[raw]!;
    }
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(MIN_CLAMP_VALUE, Math.min(MAX_CLAMP_VALUE, parsed));
    }
    return Math.min(MAX_CLAMP_VALUE, raw.length * 10);
  }

  return 0;
}

function truncateSignalPathLabel(fullPath: string): string {
  const trimmed = fullPath.trim();
  if (trimmed.length === 0) {
    return "Vehicle/Signal";
  }
  if (trimmed.length <= MAX_SIGNAL_PATH_LABEL_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, 14)}...${trimmed.slice(-15)}`;
}

export function buildTimelineChartModel(
  unguardedTrace: readonly WardenStepReceipt[],
  guardedTrace: readonly WardenStepReceipt[]
): TimelineChartModel {
  const unguardedNumeric = unguardedTrace.map((s) =>
    clampFiniteNumericValue(s.committedControlValue)
  );
  const guardedNumeric = guardedTrace.map((s) =>
    clampFiniteNumericValue(s.committedControlValue)
  );
  const allValues = [...unguardedNumeric, ...guardedNumeric, 0];

  let rawMin = Math.min(...allValues);
  let rawMax = Math.max(...allValues);
  if (!Number.isFinite(rawMin)) rawMin = MIN_CLAMP_VALUE;
  if (!Number.isFinite(rawMax)) rawMax = MAX_CLAMP_VALUE;
  if (rawMax - rawMin < 1) {
    rawMin -= 10;
    rawMax += 10;
  }

  const valueMin = Math.max(MIN_CLAMP_VALUE, rawMin);
  const valueMax = Math.min(MAX_CLAMP_VALUE, rawMax);
  const domainSpan = Math.max(1, valueMax - valueMin);
  const plotWidth = PLOT_RIGHT - PLOT_LEFT;
  const plotHeight = PLOT_BOTTOM - PLOT_TOP;

  const mapStepToPoint = (
    step: WardenStepReceipt,
    idx: number,
    totalCount: number,
    numericVal: number
  ): TimelinePoint => {
    const xRatio = totalCount > 1 ? idx / (totalCount - 1) : 0.5;
    const rawX = PLOT_LEFT + xRatio * plotWidth;
    const clampedX = Math.max(0, Math.min(VIEWBOX_WIDTH, rawX));

    const yRatio = (numericVal - valueMin) / domainSpan;
    const rawY = PLOT_BOTTOM - yRatio * plotHeight;
    const clampedY = Math.max(0, Math.min(VIEWBOX_HEIGHT, rawY));

    const fullSignalPath =
      step.signalPath ?? step.wardenPayload?.path ?? "Vehicle/Signal";

    return {
      stepIndex: step.stepIndex,
      opKind: step.opKind,
      status: step.status,
      x: clampedX,
      y: clampedY,
      numericValue: numericVal,
      rawCommittedValue: step.committedControlValue,
      committedHex: step.committedHex,
      fullSignalPath,
      displaySignalPath: truncateSignalPathLabel(fullSignalPath),
    };
  };

  const unguardedPoints = unguardedTrace.map((step, idx) =>
    mapStepToPoint(
      step,
      idx,
      unguardedTrace.length,
      unguardedNumeric[idx] ?? 0
    )
  );
  const guardedPoints = guardedTrace.map((step, idx) =>
    mapStepToPoint(step, idx, guardedTrace.length, guardedNumeric[idx] ?? 0)
  );

  const unguardedPolyline = unguardedPoints
    .map((pt) => `${pt.x},${pt.y}`)
    .join(" ");
  const guardedPolyline = guardedPoints
    .map((pt) => `${pt.x},${pt.y}`)
    .join(" ");

  return {
    viewBoxWidth: VIEWBOX_WIDTH,
    viewBoxHeight: VIEWBOX_HEIGHT,
    valueMin,
    valueMax,
    unguardedPoints,
    guardedPoints,
    unguardedPolyline,
    guardedPolyline,
  };
}

export const CODELAB_STEPS: readonly CodelabStep[] = [
  {
    stepNumber: 1,
    id: "step-1-upstream-qpp-gaps",
    label: "1. Diagnose the 3 Upstream QNX 8.0 QPP Safety & Correctness Gaps",
    durationMinutes: 5,
    summary:
      "Inspect BlackBerry QNX's open-source QNX POSIX Publish Subscribe (QPP) service (qnx/qnx-posix-publish-subscribe) and identify the 3 critical SDV safety and data-corruption gaps in the upstream C resource manager.",
    commands: [
      "sed -n '68,78p;432,448p' vendor/qpp-upstream/qpp/value.c",
      "sed -n '50,64p' vendor/qpp-upstream/qpp/metadata.c",
      "sed -n '75,92p' vendor/qpp-upstream/qpp/iowrite.c",
    ],
    codeSnippet: `/* Gap 1: qpp/value.c:73 & qpp/value.c:434-447 + qpp/metadata.c:54-59 */
// Upstream qpp/value.c:73 caps VECTOR_UINT32 at UINT16_MAX (65535) with 2-byte element size:
[VECTOR_UINT32] = {0, UINT16_MAX, sizeof(uint16_t), "uint32[]"},
// Upstream qpp/value.c:438 & 445 decode JSON float/double into json_d, but assign json_l (0):
case FLOAT:  ((float *)data_ptr)[idx]  = (float)json_l;  /* corrupts 22.5 -> 0.0 */
case DOUBLE: ((double *)data_ptr)[idx] = (double)json_l;

/* Gap 2: qpp/iowrite.c:78-90 & qpp/iowrite_text.c:112-124 */
// Blind last-write-wins on .control lets IVI (P10) overwrite ADAS AEB (P60).

/* Gap 3: qpp/ioclose.c & qpp/main.c:160 */
// No io_close_ocb holder crash rollback, no CLOCK_MONOTONIC lease TTL, and no ?warden receipt.`,
    upstreamReferences: [
      "qpp/README.md:187-199 (min, max, allowed, arraysize marked Used By QPP? NO)",
      "qpp/value.c:73 (VECTOR_UINT32 capped at UINT16_MAX with sizeof(uint16_t))",
      "qpp/value.c:434-447 (FLOAT/DOUBLE default assigns json_l instead of json_d)",
      "qpp/metadata.c:54-59 (string-only metadata decoding fails with EINVAL on numeric/array attributes)",
      "qpp/iowrite.c:78-90 & qpp/iowrite_text.c:112-124 (blind last-write-wins on .control)",
    ],
  },
  {
    stepNumber: 2,
    id: "step-2-apply-zero-fuzz-patch",
    label: "2. Apply patches/qpp-vss-warden.patch with Zero Fuzz (--fuzz=0)",
    durationMinutes: 5,
    summary:
      "Apply the patch to upstream QPP b5ca892f, including meson.build, OCB state, reads, writes, catalog compilation and close recovery. The helper checks git apply --check, applies patch -p1 --fuzz=0, and copies the C core and adapter.",
    commands: [
      "git clone https://github.com/qnx/qnx-posix-publish-subscribe qpp-patched",
      "git -C qpp-patched checkout b5ca892f",
      "bash scripts/apply-qpp-patch.sh qpp-patched",
      "npm run build:c",
    ],
    codeSnippet: `# From the VssWarden checkout:
$ bash scripts/apply-qpp-patch.sh qpp-patched
# git apply --check + patch -p1 --fuzz=0; 13 original QPP files
# Copies vss_warden_core.{c,h} and qpp_warden.{c,h} into qpp/
# QNX target build instructions are in README.md; target execution is not verified.`,
    upstreamReferences: [
      "patches/qpp-vss-warden.patch (13 upstream QPP files patched with --fuzz=0)",
      "src/c/vss_warden_core.h & src/c/vss_warden_core.c (Zero-QNX-header C11 safety engine)",
    ],
  },
  {
    stepNumber: 3,
    id: "step-3-posix-control-arbitration-warden",
    label: "3. Test .control Priority Arbitration & ?warden Diagnostics via echo and cat",
    durationMinutes: 6,
    summary:
      "On QNX, use shells launched with on -p60 (ADAS) and on -p10 (IVI). Keep the ADAS descriptor open: the actual QNX client priority caps requested priority, and closing the descriptor releases its lease. Run the following ADAS commands in one shell; attempt the IVI write from the other shell within the lease.",
    commands: [
      'exec 3>"/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=60,lease=60000,as=ADAS_AEB"',
      'echo "0" >&3',
      'echo "110" > "/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=10,lease=1000,as=IVI_EcoMode"',
      'cat "/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?warden,text"',
    ],
    codeSnippet: `# ADAS shell, launched with on -p60 sh:
exec 3>"/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=60,lease=60000,as=ADAS_AEB"
echo "0" >&3
# IVI shell, launched with on -p10 sh:
echo "110" > "/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=10"
# Expected: write returns EBUSY while ADAS fd 3 remains open.
# ?warden returns a JSON envelope; steps[0].wardenPayload holds the diagnostic.`,
    upstreamReferences: [
      "qpp/ioopen.c (OP_MODE_WARDEN & ?priority=N,lease=MS,as=ROLE modifier parsing)",
      "qpp/iowrite.c & qpp/iowrite_text.c (vss_warden_write arbitration hook)",
    ],
  },
  {
    stepNumber: 4,
    id: "step-4-crash-disconnect-lease-rollback",
    label: "4. Verify Holder Crash (io_close_ocb) & Monotonic Lease Rollback",
    durationMinutes: 5,
    summary:
      "Close ADAS fd 3 from step 3 to invoke io_close_ocb and restore the safe default. Reads and writes check CLOCK_MONOTONIC expiry; idle expiry is observed on the next I/O. Separately replay the native C11 crash/standby scenario on the host. QNX target execution remains unverified.",
    commands: [
      "exec 3>&-",
      'cat "/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?warden,text"',
      "./build/vss-warden-cli --preset preset-3-crash-lease-rollback --seed 20261105",
    ],
    codeSnippet: `/* io_close_ocb calls qpp_warden_close(ocb). */
/* The shared C session closes the owner and promotes a live standby or restores default. */
/* qpp_warden_refresh checks CLOCK_MONOTONIC on subsequent reads/writes. */`,
    upstreamReferences: [
      "qpp/ioclose.c (io_close_ocb calls qpp_warden_close)",
      "src/c/qpp_warden.c (CLOCK_MONOTONIC and persistent C session adapter)",
    ],
  },
  {
    stepNumber: 5,
    id: "step-5-shape-1-fast-check-pbt",
    label: "5. Run the Shape 1 fast-check Property-Based Verification Suite (P1..P3)",
    durationMinutes: 5,
    summary:
      "Execute the 3-role Conditional Property-Based Testing (PBT) suite in tests/warden-core-pbt.test.ts using fast-check against the compiled C11 binary and independent TypeScript reference oracle across invariants P1, P2, and P3.",
    commands: [
      "npm test",
      "node --experimental-strip-types --test tests/warden-core-pbt.test.ts",
      "./build/vss-warden-cli --preset preset-1-bounds-float-bug --seed 20261105",
    ],
    codeSnippet: `// Shape 1 Multi-Step State Machine Invariants verified at every step:
// P1_VSS_BOUNDS_AND_UPSTREAM_FIX: min/max/allowed/arraysize + FLOAT 22.5 + VECTOR_UINT32 > 65535
// P2_PRIORITY_ARBITRATION_PREEMPTION: higher priority preempts; lower priority rejected with EBUSY
// P3_DEAD_OWNER_LEASE_RECOVERY: io_close_ocb / TTL expiry promotes standby or VSS default`,
    upstreamReferences: [
      "tests/warden-core-pbt.test.ts (Role 1 concrete examples, Role 2 fc.property P1..P3, Role 3 calibration)",
      "lib/oracle.ts (evaluateVssWardenOracle independent TypeScript state-machine oracle)",
    ],
  },
];
