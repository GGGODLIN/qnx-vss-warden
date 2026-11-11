import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { evaluateVssWardenOracle } from "../lib/oracle.ts";
import { AUTOMOTIVE_PRESETS } from "../lib/presets.ts";
import type {
  VssSignalValue,
  WardenOperation,
  WardenStepReceipt,
} from "../lib/types.ts";
import {
  canonicalizeQppPath,
  runWardenCoreSequence as executeCore,
} from "../lib/warden-core.ts";

const runWardenCoreSequence: typeof executeCore = (catalog, operations, mode) =>
  executeCore(catalog, operations, mode, { cliBinaryPath: "./build/vss-warden-cli" });

const UPSTREAM_HEADER_COMMENT = `/*
 * Copyright (c) 2025, BlackBerry Limited. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * Official QPP signal_catalog.json header comment block (lines 1-57).
 */`;

describe("Ticket 01 — VssWarden Portable C11 Core & Shape 1 Conditional PBT Suite", () => {
  describe("Role 1: Concrete Capability Examples", () => {
    it("executes all 3 built-in COVESA VSS v3 automotive presets and proves P1, P2, and P3 against Raw QPP", () => {
      assert.equal(AUTOMOTIVE_PRESETS.length, 3);

      const preset1 = AUTOMOTIVE_PRESETS[0];
      assert.ok(preset1, "Preset 1 must exist");
      const u1 = runWardenCoreSequence(preset1.catalogJsonc, preset1.operations, "unguarded");
      const g1 = runWardenCoreSequence(preset1.catalogJsonc, preset1.operations, "guarded");
      assert.equal(u1.ok, true);
      assert.equal(g1.ok, true);
      const oracle1 = evaluateVssWardenOracle(preset1.catalogJsonc, preset1.operations, u1, g1);
      assert.equal(oracle1.allPassed, true, oracle1.failures.join("; "));
      assert.equal(oracle1.P1_VSS_BOUNDS_AND_UPSTREAM_FIX, true);

      // Step 0 opens FLOAT signal (default: 22.5): Raw QPP corrupts to 0 (0x00000000), VssWarden preserves 22.5 (0x41b40000)
      assert.equal(u1.steps[0]?.committedControlValue, 0);
      assert.equal(u1.steps[0]?.committedHex, "0x00000000");
      assert.equal(g1.steps[0]?.committedControlValue, 22.5);
      assert.equal(g1.steps[0]?.committedHex, "0x41b40000");

      // Mirror Pan [-100, 100]: valid write -35 succeeds, out-of-range 120 rejected with ERANGE in guarded
      const mirrorRejectStep = g1.steps.find(
        (s) => s.status === "ERANGE" && s.lastRejection?.ruleId === "VSS_MIN_MAX"
      );
      assert.ok(mirrorRejectStep, "Expected ERANGE VSS_MIN_MAX rejection in Preset 1");
      assert.equal(mirrorRejectStep.committedControlValue, -35);

      // Wiping Mode allowed enum: invalid write "HYPER_TURBO" rejected with EINVAL in guarded
      const enumRejectStep = g1.steps.find(
        (s) => s.status === "EINVAL" && s.lastRejection?.ruleId === "VSS_ALLOWED_ENUM"
      );
      assert.ok(enumRejectStep, "Expected EINVAL VSS_ALLOWED_ENUM rejection in Preset 1");
      assert.equal(enumRejectStep.committedControlValue, "FAST");

      // VECTOR_UINT32 > 65535: Raw QPP fails with ERANGE (qpp/value.c:73), VssWarden succeeds with EOK
      const dtcStepIdx = preset1.operations.findIndex(
        (op) => op.kind === "WRITE" && Array.isArray(op.value)
      );
      assert.ok(dtcStepIdx >= 0, "Preset 1 must include a VECTOR_UINT32 write");
      assert.equal(u1.steps[dtcStepIdx]?.status, "ERANGE");
      assert.equal(g1.steps[dtcStepIdx]?.status, "EOK");
      assert.deepEqual(g1.steps[dtcStepIdx]?.committedControlValue, [70000, 4000000000]);

      const preset2 = AUTOMOTIVE_PRESETS[1];
      assert.ok(preset2, "Preset 2 must exist");
      const u2 = runWardenCoreSequence(preset2.catalogJsonc, preset2.operations, "unguarded");
      const g2 = runWardenCoreSequence(preset2.catalogJsonc, preset2.operations, "guarded");
      const oracle2 = evaluateVssWardenOracle(preset2.catalogJsonc, preset2.operations, u2, g2);
      assert.equal(oracle2.allPassed, true, oracle2.failures.join("; "));
      assert.equal(oracle2.P2_PRIORITY_ARBITRATION_PREEMPTION, true);

      const hijackStep = g2.steps.find((s) => s.status === "EBUSY");
      assert.ok(hijackStep, "Preset 2 must contain an EBUSY rejection step");
      assert.equal(hijackStep.lastRejection?.ruleId, "PRIORITY_PREEMPTED");
      assert.equal(hijackStep.activeHolder?.priority, 60);

      const preset3 = AUTOMOTIVE_PRESETS[2];
      assert.ok(preset3, "Preset 3 must exist");
      const u3 = runWardenCoreSequence(preset3.catalogJsonc, preset3.operations, "unguarded");
      const g3 = runWardenCoreSequence(preset3.catalogJsonc, preset3.operations, "guarded");
      const oracle3 = evaluateVssWardenOracle(preset3.catalogJsonc, preset3.operations, u3, g3);
      assert.equal(oracle3.allPassed, true, oracle3.failures.join("; "));
      assert.equal(oracle3.P3_DEAD_OWNER_LEASE_RECOVERY, true);
      assert.ok(oracle3.counters.leaseRecoveredCount >= 2);
    });

    it("strips C-style /* ... */ header comments and resolves all 4 QPP path notations to the same canonical actuator node", () => {
      const catalogWithComments = `${UPSTREAM_HEADER_COMMENT}
      {
        /* Nested COVESA VSS v3 branch hierarchy */
        "Vehicle": {
          "type": "branch",
          "children": {
            "Body": {
              "type": "branch",
              "children": {
                "Mirrors": {
                  "type": "branch",
                  "children": {
                    "Left": {
                      "type": "branch",
                      "children": {
                        "Pan": {
                          "datatype": "int8",
                          "type": "actuator",
                          "min": -100,
                          "max": 100,
                          "default": 0,
                          "description": "Mirror pan /* keep inside string */"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`;

      const notations = [
        "Vehicle.Body.Mirrors.Left.Pan",
        "Vehicle/Body/Mirrors/Left/Pan",
        "Vehicle/Body/Mirrors/Left/.Pan.control",
        "Vehicle/Body/Mirrors/Left/Pan?control,text",
      ];

      for (const rawPath of notations) {
        const parsed = canonicalizeQppPath(rawPath);
        assert.equal(parsed.ok, true, `Failed to canonicalize ${rawPath}`);
        assert.equal(parsed.canonicalPath, "Vehicle/Body/Mirrors/Left/Pan");
      }

      const operations: WardenOperation[] = [
        {
          kind: "OPEN",
          fd: 1,
          path: "Vehicle.Body.Mirrors.Left.Pan",
          pid: 1001,
          priority: 10,
          leaseMs: 500,
          role: "ivi",
        },
        {
          kind: "OPEN",
          fd: 2,
          path: "Vehicle/Body/Mirrors/Left/Pan",
          pid: 1002,
          priority: 20,
          leaseMs: 500,
          role: "comfort",
        },
        {
          kind: "OPEN",
          fd: 3,
          path: "Vehicle/Body/Mirrors/Left/.Pan.control",
          pid: 1003,
          priority: 40,
          leaseMs: 500,
          role: "adas",
        },
        {
          kind: "OPEN",
          fd: 4,
          path: "Vehicle/Body/Mirrors/Left/Pan?control,text",
          pid: 1004,
          priority: 15,
          leaseMs: 500,
          role: "cabin",
        },
        { kind: "WRITE", fd: 1, value: 15, nowMs: 10 },
        { kind: "WRITE", fd: 2, value: 30, nowMs: 20 },
        { kind: "WRITE", fd: 3, value: -45, nowMs: 30 },
        { kind: "WRITE", fd: 4, value: 10, nowMs: 40 },
        {
          kind: "READ_WARDEN",
          path: "Vehicle/Body/Mirrors/Left/Pan?warden,text",
          nowMs: 45,
        },
      ];

      const unguarded = runWardenCoreSequence(catalogWithComments, operations, "unguarded");
      const guarded = runWardenCoreSequence(catalogWithComments, operations, "guarded");
      const verdict = evaluateVssWardenOracle(catalogWithComments, operations, unguarded, guarded);

      assert.equal(verdict.allPassed, true, verdict.failures.join("; "));
      assert.equal(guarded.steps[6]?.status, "EOK");
      assert.equal(guarded.steps[6]?.committedControlValue, -45);
      // fd 4 (priority 15) must be blocked by fd 3 (priority 40) on the same canonical node
      assert.equal(guarded.steps[7]?.status, "EBUSY");
      assert.equal(guarded.steps[7]?.committedControlValue, -45);
      assert.equal(guarded.steps[8]?.wardenPayload?.path, "Vehicle/Body/Mirrors/Left/Pan");
      assert.equal(guarded.steps[8]?.wardenPayload?.activeHolder?.fd, 3);
      assert.equal(guarded.steps[8]?.wardenPayload?.lastRejection?.ruleId, "PRIORITY_PREEMPTED");
    });

    it("enforces arraysize (EINVAL) and vector element range (ERANGE) while preserving pre-seeded state", () => {
      const catalogJsonc = JSON.stringify({
        "Vehicle/OBD/DTCList": {
          datatype: "uint32[]",
          type: "actuator",
          arraysize: 2,
          min: 0,
          max: 4294967295,
          default: [100],
        },
      });

      const ops: WardenOperation[] = [
        {
          kind: "OPEN",
          fd: 1,
          path: "Vehicle/OBD/DTCList",
          pid: 200,
          priority: 30,
          leaseMs: 500,
          role: "diagnostics",
        },
        // Pre-seed state with valid write (> 65535)
        { kind: "WRITE", fd: 1, value: [70000, 140000], nowMs: 10 },
        // Exceed arraysize (3 > 2) -> EINVAL VSS_ARRAY_SIZE
        { kind: "WRITE", fd: 1, value: [1, 2, 3], nowMs: 20 },
      ];

      const guarded = runWardenCoreSequence(catalogJsonc, ops, "guarded");
      assert.equal(guarded.ok, true);
      assert.equal(guarded.steps[1]?.status, "EOK");
      assert.deepEqual(guarded.steps[1]?.committedControlValue, [70000, 140000]);

      assert.equal(guarded.steps[2]?.status, "EINVAL");
      assert.equal(guarded.steps[2]?.lastRejection?.ruleId, "VSS_ARRAY_SIZE");
      assert.deepEqual(guarded.steps[2]?.committedControlValue, [70000, 140000]);
    });

    it("returns structured error statuses for empty catalog, malformed JSONC, unknown path (ENOENT), and closed FD (EBADF)", () => {
      const sampleOps: WardenOperation[] = [
        {
          kind: "OPEN",
          fd: 1,
          path: "Vehicle/Body/Mirrors/Left/Pan",
          pid: 100,
          priority: 10,
          leaseMs: 200,
          role: "ivi",
        },
      ];

      const emptyRes = runWardenCoreSequence("   /* only comments */  ", sampleOps, "guarded");
      assert.equal(emptyRes.ok, false);
      assert.equal(emptyRes.status, "EINVAL");

      const malformedRes = runWardenCoreSequence("{ \"Vehicle\": { broken json ", sampleOps, "guarded");
      assert.equal(malformedRes.ok, false);
      assert.equal(malformedRes.status, "EINVAL");

      const validCatalog = JSON.stringify({
        "Vehicle/Body/Mirrors/Left/Pan": {
          datatype: "int8",
          type: "actuator",
          min: -100,
          max: 100,
          default: 0,
        },
      });

      const errorOps: WardenOperation[] = [
        {
          kind: "OPEN",
          fd: 1,
          path: "Vehicle/NonExistent/Actuator",
          pid: 101,
          priority: 20,
          leaseMs: 300,
          role: "adas",
        },
        {
          kind: "OPEN",
          fd: 2,
          path: "Vehicle/Body/Mirrors/Left/Pan",
          pid: 102,
          priority: 20,
          leaseMs: 300,
          role: "adas",
        },
        { kind: "WRITE", fd: 2, value: 40, nowMs: 10 },
        { kind: "CLOSE", fd: 2, reason: "NORMAL_CLOSE", nowMs: 20 },
        // Write to closed FD 2 -> EBADF
        { kind: "WRITE", fd: 2, value: 50, nowMs: 30 },
        // Write to never-opened FD 99 -> EBADF
        { kind: "WRITE", fd: 99, value: 10, nowMs: 40 },
        // Close already-closed FD 2 -> EBADF
        { kind: "CLOSE", fd: 2, reason: "NORMAL_CLOSE", nowMs: 50 },
      ];

      const res = runWardenCoreSequence(validCatalog, errorOps, "guarded");
      assert.equal(res.ok, true);
      assert.equal(res.steps[0]?.status, "ENOENT");
      assert.equal(res.steps[1]?.status, "EOK");
      assert.equal(res.steps[2]?.status, "EOK");
      assert.equal(res.steps[3]?.status, "EOK");
      assert.equal(res.steps[3]?.committedControlValue, 0);
      assert.equal(res.steps[4]?.status, "EBADF");
      assert.equal(res.steps[5]?.status, "EBADF");
      assert.equal(res.steps[6]?.status, "EBADF");
    });
  });

  describe("Role 2: Safety Property Guardians (Shape 1 Multi-Step State Machine)", () => {
    it("maintains P1, P2, and P3 after every individual step across 1..30 generated operations and verifies reachability witnesses", () => {
      type SchemaVariant = "INT8" | "FLOAT" | "STRING" | "UINT32_ARRAY";

      const schemaVariantArb = fc.constantFrom<SchemaVariant>(
        "INT8",
        "FLOAT",
        "STRING",
        "UINT32_ARRAY"
      );

      interface RawStepAction {
        actionType: "OPEN" | "WRITE_VALID" | "WRITE_INVALID" | "CLOSE" | "ADVANCE_CLOCK" | "READ_WARDEN";
        fdSlot: number;
        notationIdx: number;
        priority: number;
        leaseMs: number;
        deltaMs: number;
        intVal: number;
        badIntVal: number;
        floatHalfSteps: number;
        badFloatVal: number;
        enumVal: string;
        badEnumVal: string;
        uint32Arr: number[];
        badUint32Arr: number[];
        closeReason: "NORMAL_CLOSE" | "CRASH_DISCONNECT";
      }

      const rawActionArb: fc.Arbitrary<RawStepAction> = fc.record({
        actionType: fc.constantFrom(
          "OPEN",
          "WRITE_VALID",
          "WRITE_INVALID",
          "CLOSE",
          "ADVANCE_CLOCK",
          "READ_WARDEN"
        ),
        fdSlot: fc.integer({ min: 1, max: 4 }),
        notationIdx: fc.integer({ min: 0, max: 3 }),
        priority: fc.integer({ min: 1, max: 63 }),
        leaseMs: fc.integer({ min: 50, max: 2000 }),
        deltaMs: fc.integer({ min: 10, max: 1000 }),
        intVal: fc.integer({ min: -100, max: 100 }),
        badIntVal: fc.oneof(
          fc.integer({ min: -500, max: -101 }),
          fc.integer({ min: 101, max: 500 })
        ),
        floatHalfSteps: fc.integer({ min: -80, max: 250 }),
        badFloatVal: fc.oneof(
          fc.constant(-95.5),
          fc.constant(180.25)
        ),
        enumVal: fc.constantFrom("OFF", "SLOW", "MEDIUM", "FAST"),
        badEnumVal: fc.constantFrom("INVALID_MODE", "TURBO", "BROKEN"),
        uint32Arr: fc.array(fc.integer({ min: 0, max: 4294967295 }), {
          minLength: 1,
          maxLength: 3,
        }),
        badUint32Arr: fc.constant([10, 20, 30, 40]),
        closeReason: fc.constantFrom("NORMAL_CLOSE", "CRASH_DISCONNECT"),
      });

      const scenarioArb = fc.record({
        variant: schemaVariantArb,
        rawSteps: fc.array(rawActionArb, { minLength: 1, maxLength: 26 }),
      });

      let totalAppliedCount = 0;
      let totalBoundsRejectedCount = 0;
      let totalPriorityBlockedCount = 0;
      let totalLeaseRecoveredCount = 0;

      const buildScenario = (
        variant: SchemaVariant,
        rawSteps: RawStepAction[]
      ): { catalogJsonc: string; operations: WardenOperation[] } => {
        const basePath = "Vehicle/Body/TestActuator/Target";
        const notations = [
          "Vehicle.Body.TestActuator.Target",
          "Vehicle/Body/TestActuator/Target",
          "Vehicle/Body/TestActuator/.Target.control",
          "Vehicle/Body/TestActuator/Target?control,text",
        ];

        let catalogObj: Record<string, unknown>;
        if (variant === "INT8") {
          catalogObj = {
            [basePath]: {
              datatype: "int8",
              type: "actuator",
              min: -100,
              max: 100,
              default: 0,
            },
          };
        } else if (variant === "FLOAT") {
          catalogObj = {
            [basePath]: {
              datatype: "float",
              type: "actuator",
              min: -40.0,
              max: 125.0,
              default: 22.5,
            },
          };
        } else if (variant === "STRING") {
          catalogObj = {
            [basePath]: {
              datatype: "string",
              type: "actuator",
              allowed: ["OFF", "SLOW", "MEDIUM", "FAST"],
              default: "OFF",
            },
          };
        } else {
          catalogObj = {
            [basePath]: {
              datatype: "uint32[]",
              type: "actuator",
              arraysize: 3,
              min: 0,
              max: 4294967295,
              default: [70000],
            },
          };
        }

        const pickValidValue = (step: RawStepAction): VssSignalValue => {
          if (variant === "INT8") return step.intVal;
          if (variant === "FLOAT") return step.floatHalfSteps * 0.5;
          if (variant === "STRING") return step.enumVal;
          return step.uint32Arr;
        };

        const pickInvalidValue = (step: RawStepAction): VssSignalValue => {
          if (variant === "INT8") return step.badIntVal;
          if (variant === "FLOAT") return step.badFloatVal;
          if (variant === "STRING") return step.badEnumVal;
          return step.badUint32Arr;
        };

        const operations: WardenOperation[] = [];
        const openSlotToFd = new Map<number, number>();
        let nextFd = 1;
        let nowMs = 10;

        const seedFd1 = nextFd++;
        openSlotToFd.set(1, seedFd1);
        operations.push({
          kind: "OPEN",
          fd: seedFd1,
          path: notations[0] ?? basePath,
          pid: 1001,
          priority: 20,
          leaseMs: 300,
          role: "comfort",
        });

        const seedFd2 = nextFd++;
        openSlotToFd.set(2, seedFd2);
        operations.push({
          kind: "OPEN",
          fd: seedFd2,
          path: notations[1] ?? basePath,
          pid: 1002,
          priority: 50,
          leaseMs: 250,
          role: "adas",
        });

        for (const step of rawSteps) {
          if (operations.length >= 30) break;
          nowMs += 15;
          const notation = notations[step.notationIdx % notations.length] ?? basePath;

          if (step.actionType === "OPEN") {
            const existingFd = openSlotToFd.get(step.fdSlot);
            if (existingFd !== undefined && operations.length + 1 < 30) {
              operations.push({
                kind: "CLOSE",
                fd: existingFd,
                reason: "NORMAL_CLOSE",
                nowMs,
              });
              openSlotToFd.delete(step.fdSlot);
              nowMs += 5;
            }
            if (operations.length < 30) {
              const fd = nextFd++;
              openSlotToFd.set(step.fdSlot, fd);
              operations.push({
                kind: "OPEN",
                fd,
                path: notation,
                pid: 1000 + fd,
                priority: step.priority,
                leaseMs: step.leaseMs,
                role: step.priority >= 40 ? "adas" : "ivi",
              });
            }
          } else if (step.actionType === "WRITE_VALID") {
            const fd = openSlotToFd.get(step.fdSlot) ?? seedFd1;
            operations.push({
              kind: "WRITE",
              fd,
              value: pickValidValue(step),
              nowMs,
            });
          } else if (step.actionType === "WRITE_INVALID") {
            const fd = openSlotToFd.get(step.fdSlot) ?? seedFd1;
            operations.push({
              kind: "WRITE",
              fd,
              value: pickInvalidValue(step),
              nowMs,
            });
          } else if (step.actionType === "CLOSE") {
            const fd = openSlotToFd.get(step.fdSlot);
            if (fd !== undefined) {
              operations.push({
                kind: "CLOSE",
                fd,
                reason: step.closeReason,
                nowMs,
              });
              openSlotToFd.delete(step.fdSlot);
            } else {
              operations.push({
                kind: "WRITE",
                fd: seedFd2,
                value: pickValidValue(step),
                nowMs,
              });
            }
          } else if (step.actionType === "ADVANCE_CLOCK") {
            operations.push({
              kind: "ADVANCE_CLOCK",
              deltaMs: step.deltaMs,
            });
            nowMs += step.deltaMs;
          } else {
            operations.push({
              kind: "READ_WARDEN",
              path: `${basePath}?warden,text`,
              nowMs,
            });
          }
        }

        return {
          catalogJsonc: `${UPSTREAM_HEADER_COMMENT}\n${JSON.stringify(catalogObj)}`,
          operations: operations.slice(0, 30),
        };
      };

      fc.assert(
        fc.property(scenarioArb, ({ variant, rawSteps }) => {
          const { catalogJsonc, operations } = buildScenario(variant, rawSteps);
          const unguarded = runWardenCoreSequence(catalogJsonc, operations, "unguarded");
          const guarded = runWardenCoreSequence(catalogJsonc, operations, "guarded");
          if (!unguarded.ok || !guarded.ok) {
            return false;
          }

          const report = evaluateVssWardenOracle(
            catalogJsonc,
            operations,
            unguarded,
            guarded
          );

          if (report.stepVerdicts.length !== operations.length) {
            return false;
          }

          for (const stepVerdict of report.stepVerdicts) {
            if (!stepVerdict.p1Passed || !stepVerdict.p2Passed || !stepVerdict.p3Passed) {
              return false;
            }
          }

          if (
            !report.P1_VSS_BOUNDS_AND_UPSTREAM_FIX ||
            !report.P2_PRIORITY_ARBITRATION_PREEMPTION ||
            !report.P3_DEAD_OWNER_LEASE_RECOVERY
          ) {
            return false;
          }

          totalAppliedCount += report.counters.appliedCount;
          totalBoundsRejectedCount += report.counters.boundsRejectedCount;
          totalPriorityBlockedCount += report.counters.priorityBlockedCount;
          totalLeaseRecoveredCount += report.counters.leaseRecoveredCount;
          return true;
        }),
        { numRuns: 100, seed: 20261105 }
      );

      assert.ok(totalAppliedCount > 0, `Expected appliedCount > 0, got ${totalAppliedCount}`);
      assert.ok(
        totalBoundsRejectedCount > 0,
        `Expected boundsRejectedCount > 0, got ${totalBoundsRejectedCount}`
      );
      assert.ok(
        totalPriorityBlockedCount > 0,
        `Expected priorityBlockedCount > 0, got ${totalPriorityBlockedCount}`
      );
      assert.ok(
        totalLeaseRecoveredCount > 0,
        `Expected leaseRecoveredCount > 0, got ${totalLeaseRecoveredCount}`
      );
    });
  });

  describe("Role 3: Oracle Calibration & Counterexample Replay", () => {
    const calibrationCatalog = JSON.stringify({
      "Vehicle/ADAS/CruiseControl/SpeedSet": {
        datatype: "int8",
        type: "actuator",
        min: 0,
        max: 120,
        default: 0,
      },
    });

    const calibrationOps: WardenOperation[] = [
      {
        kind: "OPEN",
        fd: 1,
        path: "Vehicle/ADAS/CruiseControl/SpeedSet",
        pid: 100,
        priority: 30,
        leaseMs: 400,
        role: "cruise",
      },
      {
        kind: "OPEN",
        fd: 2,
        path: "Vehicle/ADAS/CruiseControl/SpeedSet",
        pid: 200,
        priority: 60,
        leaseMs: 300,
        role: "aeb",
      },
      {
        kind: "OPEN",
        fd: 3,
        path: "Vehicle/ADAS/CruiseControl/SpeedSet",
        pid: 300,
        priority: 10,
        leaseMs: 400,
        role: "ivi",
      },
      // Step 3 (P1 valid apply): fd 1 (P30) writes 80 -> EOK
      { kind: "WRITE", fd: 1, value: 80, nowMs: 10 },
      // Step 4 (P1 bounds violation): fd 1 writes 125 (> max 120) -> ERANGE
      { kind: "WRITE", fd: 1, value: 125, nowMs: 20 },
      // Step 5 (P2 preemption): fd 2 (P60) writes 20 -> EOK, preempts fd 1
      { kind: "WRITE", fd: 2, value: 20, nowMs: 30 },
      // Step 6 (P2 lower-priority block): fd 3 (P10) writes 100 -> EBUSY
      { kind: "WRITE", fd: 3, value: 100, nowMs: 40 },
      // Step 7 (P3 crash recovery): fd 2 closes (CRASH_DISCONNECT) -> rolls back to standby fd 1 (value 80)
      { kind: "CLOSE", fd: 2, reason: "CRASH_DISCONNECT", nowMs: 50 },
    ];

    it("calibrates P1 individually: mutating a bounds-rejected step causes P1 === false while P2 === true and P3 === true", () => {
      const unguarded = runWardenCoreSequence(calibrationCatalog, calibrationOps, "unguarded");
      const guarded = runWardenCoreSequence(calibrationCatalog, calibrationOps, "guarded");

      const mutatedGuardedSteps: WardenStepReceipt[] = guarded.steps.map((step, idx) =>
        idx === 4
          ? {
              ...step,
              status: "EOK",
              committedControlValue: 125,
              lastRejection: null,
            }
          : step
      );

      const report = evaluateVssWardenOracle(calibrationCatalog, calibrationOps, unguarded, {
        ...guarded,
        steps: mutatedGuardedSteps,
      });
      assert.equal(report.P1_VSS_BOUNDS_AND_UPSTREAM_FIX, false);
      assert.equal(report.P2_PRIORITY_ARBITRATION_PREEMPTION, true);
      assert.equal(report.P3_DEAD_OWNER_LEASE_RECOVERY, true);
      assert.equal(report.allPassed, false);
    });

    it("calibrates P2 individually: mutating a priority-blocked step causes P2 === false while P1 === true and P3 === true", () => {
      const unguarded = runWardenCoreSequence(calibrationCatalog, calibrationOps, "unguarded");
      const guarded = runWardenCoreSequence(calibrationCatalog, calibrationOps, "guarded");

      const mutatedGuardedSteps: WardenStepReceipt[] = guarded.steps.map((step, idx) =>
        idx === 6
          ? {
              ...step,
              status: "EOK",
              committedControlValue: 100,
              lastRejection: null,
            }
          : step
      );

      const report = evaluateVssWardenOracle(calibrationCatalog, calibrationOps, unguarded, {
        ...guarded,
        steps: mutatedGuardedSteps,
      });
      assert.equal(report.P1_VSS_BOUNDS_AND_UPSTREAM_FIX, true);
      assert.equal(report.P2_PRIORITY_ARBITRATION_PREEMPTION, false);
      assert.equal(report.P3_DEAD_OWNER_LEASE_RECOVERY, true);
      assert.equal(report.allPassed, false);
    });

    it("calibrates P3 individually: mutating a dead-owner lease recovery step causes P3 === false while P1 === true and P2 === true", () => {
      const unguarded = runWardenCoreSequence(calibrationCatalog, calibrationOps, "unguarded");
      const guarded = runWardenCoreSequence(calibrationCatalog, calibrationOps, "guarded");

      const mutatedGuardedSteps: WardenStepReceipt[] = guarded.steps.map((step, idx) =>
        idx === 7
          ? {
              ...step,
              committedControlValue: 20,
              activeHolder: {
                fd: 2,
                role: "aeb",
                pid: 200,
                priority: 60,
                leaseExpiresMs: 330,
              },
            }
          : step
      );

      const report = evaluateVssWardenOracle(calibrationCatalog, calibrationOps, unguarded, {
        ...guarded,
        steps: mutatedGuardedSteps,
      });
      assert.equal(report.P1_VSS_BOUNDS_AND_UPSTREAM_FIX, true);
      assert.equal(report.P2_PRIORITY_ARBITRATION_PREEMPTION, true);
      assert.equal(report.P3_DEAD_OWNER_LEASE_RECOVERY, false);
      assert.equal(report.allPassed, false);
    });

    it("replays a pinned shrunken counterexample sequence (preemption -> holder crash -> standby promotion -> TTL expiry -> low-priority recovery)", () => {
      const shrunkCatalog = JSON.stringify({
        "Vehicle/Body/Mirrors/Left/Pan": {
          datatype: "int8",
          type: "actuator",
          min: -100,
          max: 100,
          default: 0,
        },
      });

      const shrunkActions: WardenOperation[] = [
        {
          kind: "OPEN",
          fd: 1,
          path: "Vehicle.Body.Mirrors.Left.Pan",
          pid: 110,
          priority: 30,
          leaseMs: 300,
          role: "driver_assist",
        },
        {
          kind: "OPEN",
          fd: 2,
          path: "Vehicle/Body/Mirrors/Left/.Pan.control",
          pid: 120,
          priority: 60,
          leaseMs: 200,
          role: "safety_override",
        },
        {
          kind: "OPEN",
          fd: 3,
          path: "Vehicle/Body/Mirrors/Left/Pan?control,text",
          pid: 130,
          priority: 10,
          leaseMs: 400,
          role: "cabin_memory",
        },
        { kind: "WRITE", fd: 1, value: -40, nowMs: 100 },
        { kind: "WRITE", fd: 2, value: 85, nowMs: 150 },
        { kind: "CLOSE", fd: 2, reason: "CRASH_DISCONNECT", nowMs: 200 },
        { kind: "ADVANCE_CLOCK", deltaMs: 250 },
        { kind: "WRITE", fd: 3, value: 25, nowMs: 460 },
      ];

      const unguarded = runWardenCoreSequence(shrunkCatalog, shrunkActions, "unguarded");
      const guarded = runWardenCoreSequence(shrunkCatalog, shrunkActions, "guarded");
      const verdict = evaluateVssWardenOracle(shrunkCatalog, shrunkActions, unguarded, guarded);

      assert.equal(verdict.allPassed, true, verdict.failures.join("; "));
      assert.equal(guarded.steps[3]?.committedControlValue, -40);
      assert.equal(guarded.steps[4]?.committedControlValue, 85);
      assert.equal(guarded.steps[5]?.committedControlValue, -40);
      assert.equal(guarded.steps[5]?.activeHolder?.fd, 1);
      assert.equal(guarded.steps[6]?.committedControlValue, 0);
      assert.equal(guarded.steps[6]?.activeHolder, null);
      assert.equal(guarded.steps[7]?.status, "EOK");
      assert.equal(guarded.steps[7]?.committedControlValue, 25);
      assert.equal(guarded.steps[7]?.activeHolder?.fd, 3);
    });

    it("releases previous signal lease on re-OPEN of an active fd, escapes <0x20 control chars, and handles non-numeric ?priority=abc identically", () => {
      const catalog = JSON.stringify({
        "Vehicle/SigA": { datatype: "int8", type: "actuator", min: 0, max: 100, default: 0 },
        "Vehicle/SigB": { datatype: "string", type: "actuator", default: "IDLE" },
      });
      const actions: WardenOperation[] = [
        { kind: "OPEN", fd: 1, path: "  Vehicle/SigA?priority=abc  ", pid: 100, priority: 60, leaseMs: 1000, role: "adas\u0001ctrl" },
        { kind: "WRITE", fd: 1, value: 50, nowMs: 100 },
        { kind: "OPEN", fd: 1, path: "Vehicle/SigB", pid: 100, priority: 60, leaseMs: 1000, role: "adas\u0001ctrl" },
        { kind: "OPEN", fd: 2, path: "Vehicle/SigA", pid: 200, priority: 10, leaseMs: 500, role: "ivi" },
        { kind: "WRITE", fd: 2, value: 25, nowMs: 150 },
      ];
      const unguarded = runWardenCoreSequence(catalog, actions, "unguarded");
      const guarded = runWardenCoreSequence(catalog, actions, "guarded");
      const verdict = evaluateVssWardenOracle(catalog, actions, unguarded, guarded);

      assert.equal(verdict.allPassed, true, verdict.failures.join("; "));
      assert.equal(guarded.steps[1]?.activeHolder?.priority, 60);
      assert.equal(guarded.steps[4]?.status, "EOK");
      assert.equal(guarded.steps[4]?.committedControlValue, 25);
    });
  });
});
