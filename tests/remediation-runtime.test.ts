import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { AUTOMOTIVE_PRESETS } from "../lib/presets.ts";
import { runVerificationPipeline } from "../lib/pipeline.ts";
import { runWardenCoreSequence } from "../lib/warden-core.ts";
import type { WardenSequenceResult } from "../lib/types.ts";

describe("Audit remediation runtime contracts", () => {
  it("uses the seed for actual output and reproduces Studio results with the native CLI", () => {
    for (const preset of AUTOMOTIVE_PRESETS) {
      const replay = (seed: number): string => execFileSync("./build/vss-warden-cli", ["--preset", preset.id, "--seed", String(seed)], { encoding: "utf8" });
      const first = replay(20261105);
      assert.equal(replay(20261105), first);
      assert.notEqual(replay(20261106), first);
      const result = runVerificationPipeline({ ...preset, presetId: preset.id, seed: 20261105 });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.deepEqual(JSON.parse(first), result.guarded);
      assert.equal(result.runtimeEngine, "c11-wasi");
      assert.equal(result.oracle.allPassed, true);
    }
  });

  it("rejects invalid CLI seed values", () => {
    for (const seed of ["-1", "4294967296", "abc"]) {
      assert.throws(() => execFileSync("./build/vss-warden-cli", ["--preset", AUTOMOTIVE_PRESETS[0]!.id, "--seed", seed]));
    }
  });

  it("executes the identical C core in WASI and native mode", () => {
    for (const preset of AUTOMOTIVE_PRESETS) {
      for (const mode of ["guarded", "unguarded"] as const) {
        const native = runWardenCoreSequence(preset.catalogJsonc, preset.operations, mode, { cliBinaryPath: "./build/vss-warden-cli" });
        const wasi = runWardenCoreSequence(preset.catalogJsonc, preset.operations, mode);
        assert.equal(native.ok, true);
        assert.deepEqual(wasi, native);
      }
    }
  });

  it("runs precompiled WASI with an empty PATH and no native binary dependency", () => {
    const preset = AUTOMOTIVE_PRESETS[1]!;
    const result = JSON.parse(execFileSync(process.execPath, ["runtime/run-wasi.mjs"], {
      input: JSON.stringify({ mode: "guarded", catalogJsonc: preset.catalogJsonc, operations: preset.operations }),
      encoding: "utf8",
      env: { PATH: "", NODE_NO_WARNINGS: "1", NODE_ENV: "test" },
    })) as WardenSequenceResult;
    assert.equal(result.ok, true);
    assert.ok(result.steps.some((step) => step.status === "EBUSY"));
  });
});
