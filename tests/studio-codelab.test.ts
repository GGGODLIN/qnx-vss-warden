import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runVerificationPipeline } from "../lib/pipeline.ts";
import { AUTOMOTIVE_PRESETS } from "../lib/presets.ts";
import {
  buildTimelineChartModel,
  CODELAB_STEPS,
  createInitialStudioState,
  studioReducer,
} from "../lib/studio-model.ts";
import type { WardenStepReceipt } from "../lib/types.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");

describe("Ticket 03 — Side-by-Side SDV Verification Studio UI, Race-Safe Reducer, Interactive <google-codelab> & Reproducible Build Pack", () => {
  it("Item 1: Studio state & UI support 1-click switching across all 3 automotive presets with side-by-side Raw QPP vs VssWarden SVG timelines, P1..P3 invariant badges, ?warden JSON inspector, and copyable C CLI replay command", () => {
    assert.equal(AUTOMOTIVE_PRESETS.length, 3);
    assert.deepEqual(
      AUTOMOTIVE_PRESETS.map((p) => p.title),
      [
        "Mirror Pan & Wiper Bounds + Float Bug",
        "ADAS P60 vs IVI P10 Actuator Hijack",
        "ADAS Holder Crash & Lease Rollback",
      ]
    );

    const preset1Res = runVerificationPipeline({
      presetId: AUTOMOTIVE_PRESETS[0]!.id,
      seed: 20261105,
      requestId: 1,
      catalogJsonc: AUTOMOTIVE_PRESETS[0]!.catalogJsonc,
      operations: AUTOMOTIVE_PRESETS[0]!.operations,
    });
    assert.equal(preset1Res.ok, true);
    if (!preset1Res.ok) return;

    const initialState = createInitialStudioState(preset1Res);
    assert.equal(initialState.selectedPresetId, "preset-1-bounds-float-bug");
    assert.equal(initialState.activeRequestId, 1);
    assert.equal(initialState.isLoading, false);
    assert.equal(initialState.errorBanner, null);
    assert.ok(initialState.lastResponse);
    assert.equal(
      initialState.lastResponse.oracle.P1_VSS_BOUNDS_AND_UPSTREAM_FIX,
      true
    );
    assert.equal(
      initialState.lastResponse.oracle.P2_PRIORITY_ARBITRATION_PREEMPTION,
      true
    );
    assert.equal(
      initialState.lastResponse.oracle.P3_DEAD_OWNER_LEASE_RECOVERY,
      true
    );
    assert.ok(
      initialState.lastResponse.unguarded.steps.length > 0,
      "Expected unguarded steps in studio state"
    );
    assert.ok(
      initialState.lastResponse.guarded.steps.length > 0,
      "Expected guarded steps in studio state"
    );
    assert.equal(
      initialState.lastResponse.unguarded.steps[0]?.committedControlValue,
      0
    );
    assert.equal(
      initialState.lastResponse.guarded.steps[0]?.committedControlValue,
      22.5
    );
    assert.equal(
      initialState.lastResponse.guarded.steps[0]?.committedHex,
      "0x41b40000"
    );
    assert.ok(
      initialState.lastResponse.cliReplayCommand.includes(
        "./build/vss-warden-cli --preset preset-1-bounds-float-bug"
      )
    );

    // Check that all 3 presets transition cleanly via runVerificationPipeline + studioReducer
    for (const preset of AUTOMOTIVE_PRESETS) {
      const res = runVerificationPipeline({
        presetId: preset.id,
        seed: 20261105,
        requestId: 1,
        catalogJsonc: preset.catalogJsonc,
        operations: preset.operations,
      });
      assert.equal(res.ok, true);
      if (!res.ok) continue;

      const presetState = createInitialStudioState(res);
      assert.equal(presetState.selectedPresetId, preset.id);
      assert.equal(presetState.lastResponse?.presetId, preset.id);
      assert.equal(presetState.lastResponse?.oracle.allPassed, true);
      assert.ok(
        presetState.lastResponse?.cliReplayCommand.includes(
          `--preset ${preset.id}`
        )
      );
    }

    const pageSource = readFileSync(
      path.join(REPO_ROOT, "app", "page.tsx"),
      "utf8"
    );
    assert.ok(
      pageSource.includes("Raw QPP (Unguarded)") &&
        pageSource.includes("VssWarden (Guarded)"),
      "Studio UI must render side-by-side Raw QPP (Unguarded) and VssWarden (Guarded) panels"
    );
    assert.ok(
      pageSource.includes("P1_VSS_BOUNDS_AND_UPSTREAM_FIX") &&
        pageSource.includes("P2_PRIORITY_ARBITRATION_PREEMPTION") &&
        pageSource.includes("P3_DEAD_OWNER_LEASE_RECOVERY"),
      "Studio UI must render P1..P3 invariant badges"
    );
    assert.ok(
      pageSource.includes("?warden") && pageSource.includes("cliReplayCommand"),
      "Studio UI must render the ?warden JSON diagnostic inspector and copyable C CLI replay command"
    );
  });

  it("Item 2 (Failure F1): Switching presets while an earlier verification request is in flight increments activeRequestId and ignores stale responses or errors from the previous preset", () => {
    const state0 = createInitialStudioState();
    assert.equal(state0.activeRequestId, 1);

    // User clicks Preset 1 verification -> requestId becomes 2
    const state1 = studioReducer(state0, {
      type: "SELECT_PRESET",
      presetId: "preset-1-bounds-float-bug",
      seed: 1001,
    });
    const staleRequestId = state1.activeRequestId;
    assert.equal(staleRequestId, 2);
    assert.equal(state1.isLoading, true);

    // Before request 2 finishes, user switches to Preset 2 -> requestId becomes 3
    const state2 = studioReducer(state1, {
      type: "SELECT_PRESET",
      presetId: "preset-2-adas-vs-ivi-hijack",
      seed: 2002,
    });
    const currentRequestId = state2.activeRequestId;
    assert.equal(currentRequestId, 3);
    assert.equal(state2.selectedPresetId, "preset-2-adas-vs-ivi-hijack");
    assert.equal(state2.seed, 2002);

    const preset1Live = runVerificationPipeline({
      presetId: "preset-1-bounds-float-bug",
      seed: 1001,
      requestId: staleRequestId,
      catalogJsonc: AUTOMOTIVE_PRESETS[0]!.catalogJsonc,
      operations: AUTOMOTIVE_PRESETS[0]!.operations,
    });
    assert.equal(preset1Live.ok, true);
    if (!preset1Live.ok) return;

    // Late success response from Preset 1 (requestId: 2) arrives after Preset 2 is active (requestId: 3)
    const afterStaleSuccess = studioReducer(state2, {
      type: "VERIFY_SUCCESS",
      requestId: staleRequestId,
      response: preset1Live,
    });
    assert.equal(afterStaleSuccess.activeRequestId, 3);
    assert.equal(
      afterStaleSuccess.selectedPresetId,
      "preset-2-adas-vs-ivi-hijack"
    );
    assert.equal(afterStaleSuccess.lastResponse, null);
    assert.equal(afterStaleSuccess.isLoading, true);

    // Late error response from Preset 1 (requestId: 2) arrives -> must NOT overwrite errorBanner or state
    const afterStaleError = studioReducer(afterStaleSuccess, {
      type: "VERIFY_ERROR",
      requestId: staleRequestId,
      errorCode: "ENGINE_EXECUTION_ERROR",
      errorMessage: "Stale Preset 1 timeout error",
    });
    assert.equal(afterStaleError.errorBanner, null);
    assert.equal(
      afterStaleError.selectedPresetId,
      "preset-2-adas-vs-ivi-hijack"
    );
    assert.equal(afterStaleError.isLoading, true);

    // Now the current Preset 2 response (requestId: 3) arrives -> accepted
    const preset2Live = runVerificationPipeline({
      presetId: "preset-2-adas-vs-ivi-hijack",
      seed: 2002,
      requestId: currentRequestId,
      catalogJsonc: AUTOMOTIVE_PRESETS[1]!.catalogJsonc,
      operations: AUTOMOTIVE_PRESETS[1]!.operations,
    });
    assert.equal(preset2Live.ok, true);
    if (!preset2Live.ok) return;

    const afterCurrentSuccess = studioReducer(afterStaleError, {
      type: "VERIFY_SUCCESS",
      requestId: currentRequestId,
      response: preset2Live,
    });
    assert.equal(afterCurrentSuccess.isLoading, false);
    assert.equal(afterCurrentSuccess.errorBanner, null);
    assert.equal(
      afterCurrentSuccess.lastResponse?.presetId,
      "preset-2-adas-vs-ivi-hijack"
    );
    assert.equal(afterCurrentSuccess.lastResponse?.seed, 2002);

    // Verify that if the active request errors, errorBanner is set, and a late success from an earlier request still cannot clear or overwrite it
    const state3 = studioReducer(afterCurrentSuccess, {
      type: "SELECT_PRESET",
      presetId: "preset-3-crash-lease-rollback",
      seed: 3003,
    });
    assert.equal(state3.activeRequestId, 4);

    const state3Error = studioReducer(state3, {
      type: "VERIFY_ERROR",
      requestId: 4,
      errorCode: "ENGINE_EXECUTION_ERROR",
      errorMessage: "Active request engine failure",
    });
    assert.equal(state3Error.isLoading, false);
    assert.equal(state3Error.errorBanner, "Active request engine failure");

    const afterLateSuccessOnError = studioReducer(state3Error, {
      type: "VERIFY_SUCCESS",
      requestId: 3,
      response: preset2Live,
    });
    assert.equal(
      afterLateSuccessOnError.errorBanner,
      "Active request engine failure"
    );
    assert.equal(
      afterLateSuccessOnError.selectedPresetId,
      "preset-3-crash-lease-rollback"
    );
  });

  it("Item 3 (Failure F2): buildTimelineChartModel clamps extreme or non-finite numeric values to finite SVG viewBox coordinates and truncates > 32 char VSS paths while preserving fullSignalPath metadata", () => {
    const deepVssPath =
      "Vehicle/Cabin/HVAC/Station/Row1/Driver/Temperature/Actuator/TargetCelsius";
    assert.ok(deepVssPath.length > 32, "Fixture path must exceed 32 characters");

    const syntheticUnguarded: WardenStepReceipt[] = [
      {
        stepIndex: 0,
        opKind: "OPEN",
        status: "EOK",
        signalPath: deepVssPath,
        committedControlValue: Number.NaN,
        committedHex: "0x00000000",
        activeHolder: null,
        lastRejection: null,
      },
      {
        stepIndex: 1,
        opKind: "WRITE",
        status: "EOK",
        signalPath: deepVssPath,
        committedControlValue: Number.POSITIVE_INFINITY,
        committedHex: "0x7f800000",
        activeHolder: null,
        lastRejection: null,
      },
      {
        stepIndex: 2,
        opKind: "WRITE",
        status: "EOK",
        signalPath: "Vehicle/Body/Mirrors/Left/Pan",
        committedControlValue: -999999999,
        committedHex: "0xc479f99a",
        activeHolder: null,
        lastRejection: null,
      },
    ];

    const syntheticGuarded: WardenStepReceipt[] = [
      {
        stepIndex: 0,
        opKind: "OPEN",
        status: "EOK",
        signalPath: deepVssPath,
        committedControlValue: 22.5,
        committedHex: "0x41b40000",
        activeHolder: null,
        lastRejection: null,
      },
      {
        stepIndex: 1,
        opKind: "WRITE",
        status: "ERANGE",
        signalPath: deepVssPath,
        committedControlValue: 1e308,
        committedHex: "0x41b40000",
        activeHolder: null,
        lastRejection: {
          errnoCode: "ERANGE",
          ruleId: "VSS_MIN_MAX",
          reason: "Exceeds max",
        },
      },
      {
        stepIndex: 2,
        opKind: "WRITE",
        status: "ERANGE",
        signalPath: "Vehicle/Body/Mirrors/Left/Pan",
        committedControlValue: Number.NEGATIVE_INFINITY,
        committedHex: "0x00",
        activeHolder: null,
        lastRejection: null,
      },
    ];

    const model = buildTimelineChartModel(syntheticUnguarded, syntheticGuarded);
    assert.ok(model.viewBoxWidth > 0 && model.viewBoxHeight > 0);
    assert.equal(model.unguardedPoints.length, 3);
    assert.equal(model.guardedPoints.length, 3);

    for (const pt of [...model.unguardedPoints, ...model.guardedPoints]) {
      assert.equal(
        Number.isFinite(pt.x),
        true,
        `Expected finite x coordinate, got ${pt.x}`
      );
      assert.equal(
        Number.isFinite(pt.y),
        true,
        `Expected finite y coordinate, got ${pt.y}`
      );
      assert.equal(
        Number.isFinite(pt.numericValue),
        true,
        `Expected finite numericValue, got ${pt.numericValue}`
      );
      assert.ok(
        pt.x >= 0 && pt.x <= model.viewBoxWidth,
        `x (${pt.x}) must be clamped inside viewBoxWidth (${model.viewBoxWidth})`
      );
      assert.ok(
        pt.y >= 0 && pt.y <= model.viewBoxHeight,
        `y (${pt.y}) must be clamped inside viewBoxHeight (${model.viewBoxHeight})`
      );
      assert.ok(
        pt.displaySignalPath.length <= 32,
        `displaySignalPath "${pt.displaySignalPath}" length (${pt.displaySignalPath.length}) must be <= 32`
      );
    }

    const deepPoint = model.guardedPoints[0]!;
    assert.equal(deepPoint.fullSignalPath, deepVssPath);
    assert.ok(deepPoint.displaySignalPath.length <= 32);
    assert.ok(
      deepPoint.displaySignalPath.includes("..."),
      `Truncated path "${deepPoint.displaySignalPath}" must include "..."`
    );

    const shortPoint = model.guardedPoints[2]!;
    assert.equal(shortPoint.fullSignalPath, "Vehicle/Body/Mirrors/Left/Pan");
    assert.equal(shortPoint.displaySignalPath, "Vehicle/Body/Mirrors/Left/Pan");

    assert.ok(
      !model.unguardedPolyline.includes("NaN") &&
        !model.unguardedPolyline.includes("Infinity") &&
        !model.guardedPolyline.includes("NaN") &&
        !model.guardedPolyline.includes("Infinity") &&
        model.guardedPolyline.length > 0
    );
  });

  it("Item 4: /codelab renders an interactive step-by-step QNX 8.0 <google-codelab> tutorial covering the 3 upstream QPP gaps, applying patches/qpp-vss-warden.patch, .control arbitration via echo and cat ?warden,text, and Shape 1 fast-check PBT", () => {
    assert.ok(
      CODELAB_STEPS.length >= 5,
      `Expected at least 5 codelab steps, got ${CODELAB_STEPS.length}`
    );

    const allSummariesAndSnippets = CODELAB_STEPS.map(
      (s) =>
        `${s.label}\n${s.summary}\n${s.commands.join("\n")}\n${s.codeSnippet}\n${s.upstreamReferences.join("\n")}`
    ).join("\n\n");

    // 1. 3 upstream QPP gaps
    assert.ok(
      allSummariesAndSnippets.includes("qpp/value.c") &&
        allSummariesAndSnippets.includes("qpp/metadata.c") &&
        allSummariesAndSnippets.includes("qpp/iowrite.c"),
      "Codelab steps must reference the 3 upstream QPP gaps across value.c, metadata.c, and iowrite.c"
    );

    // 2. Applying patches/qpp-vss-warden.patch
    assert.ok(
      allSummariesAndSnippets.includes("patches/qpp-vss-warden.patch") &&
        allSummariesAndSnippets.includes("--fuzz=0"),
      "Codelab steps must walk through applying patches/qpp-vss-warden.patch with --fuzz=0"
    );

    // 3. Testing .control arbitration via echo and cat ?warden,text
    assert.ok(
      allSummariesAndSnippets.includes("echo ") &&
        allSummariesAndSnippets.includes(".control") &&
        allSummariesAndSnippets.includes("?warden,text"),
      "Codelab steps must demonstrate testing .control arbitration via echo and cat ?warden,text"
    );

    // 4. Running Shape 1 fast-check PBT suite
    assert.ok(
      allSummariesAndSnippets.includes("fast-check") &&
        allSummariesAndSnippets.includes("warden-core-pbt.test.ts"),
      "Codelab steps must walk through running the Shape 1 fast-check PBT suite"
    );

    const codelabPageSource = readFileSync(
      path.join(REPO_ROOT, "app", "codelab", "page.tsx"),
      "utf8"
    );
    assert.ok(
      codelabPageSource.includes("google-codelab") &&
        codelabPageSource.includes("google-codelab-step"),
      "app/codelab/page.tsx must render <google-codelab> and <google-codelab-step> elements"
    );
  });

  it("Item 5: README.md documents QNX 8.0 (qcc / meson) and Host (clang + npm test) build/run instructions, exact upstream qpp/ file and line references, and category/bonus prize mapping", () => {
    const readme = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");

    // QNX 8.0 & Host build/run instructions
    assert.ok(readme.includes("qcc"), "README must document QNX 8.0 qcc compiler");
    assert.ok(readme.includes("meson"), "README must document meson build instructions");
    assert.ok(readme.includes("clang"), "README must document Host clang build");
    assert.ok(
      readme.includes("npm test"),
      "README must document npm test verification"
    );
    assert.ok(
      readme.includes("patches/qpp-vss-warden.patch"),
      "README must reference patches/qpp-vss-warden.patch"
    );

    // Exact upstream qpp/ file and line references
    assert.ok(
      readme.includes("qpp/README.md") &&
        readme.includes("187") &&
        readme.includes("224"),
      "README must cite qpp/README.md lines 187-199 and line 224"
    );
    assert.ok(
      readme.includes("qpp/value.c") &&
        readme.includes("73") &&
        readme.includes("438"),
      "README must cite qpp/value.c line 73 and lines 434-447 (438)"
    );
    assert.ok(
      readme.includes("qpp/metadata.c") && readme.includes("54"),
      "README must cite qpp/metadata.c lines 54-59"
    );
    assert.ok(
      readme.includes("qpp/iowrite.c") && readme.includes("qpp/iowrite_text.c"),
      "README must cite qpp/iowrite.c and qpp/iowrite_text.c"
    );

    // Category and bonus prize mapping
    assert.ok(
      readme.includes("Automotive & Mobility"),
      "README must document Primary Category: Automotive & Mobility"
    );
    assert.ok(
      readme.includes("Best Use of QNX-specific Technologies"),
      "README must document Bonus Prize: Best Use of QNX-specific Technologies"
    );
    assert.ok(
      readme.includes("Best Codelab / Tutorial"),
      "README must document Bonus Prize: Best Codelab / Tutorial"
    );
  });
});
