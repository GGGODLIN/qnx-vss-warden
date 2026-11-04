import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { POST } from "../app/api/vss-warden/verify/route.ts";
import {
  runVerificationPipeline,
  verifyUpstreamQppPatch,
} from "../lib/pipeline.ts";
import { AUTOMOTIVE_PRESETS } from "../lib/presets.ts";
import type {
  WardenOperation,
  WardenVerifyResponse,
} from "../lib/types.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");

describe("Ticket 02 — Host Verification API, Upstream QPP Patch & Zero-Fuzz Patch Gate", () => {
  it("executes both unguarded and guarded runs via POST /api/vss-warden/verify, returns P1..P3 oracle verdicts, generates POSIX CLI commands, and emits a deterministic replay command", async () => {
    const preset = AUTOMOTIVE_PRESETS[0];
    assert.ok(preset, "Preset 1 must exist");

    const reqBody = {
      presetId: preset.id,
      seed: 20261105,
      requestId: 7,
      catalogJsonc: preset.catalogJsonc,
      operations: preset.operations,
    };

    const req = new Request("http://localhost:3000/api/vss-warden/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqBody),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const body = (await res.json()) as WardenVerifyResponse;

    assert.equal(body.ok, true);
    if (!body.ok) return;

    assert.equal(body.presetId, preset.id);
    assert.equal(body.seed, 20261105);
    assert.equal(body.requestId, 7);
    assert.equal(body.unguarded.ok, true);
    assert.equal(body.guarded.ok, true);
    assert.equal(body.unguarded.steps.length, preset.operations.length);
    assert.equal(body.guarded.steps.length, preset.operations.length);

    assert.equal(body.oracle.allPassed, true, body.oracle.failures.join("; "));
    assert.equal(body.oracle.P1_VSS_BOUNDS_AND_UPSTREAM_FIX, true);
    assert.equal(body.oracle.P2_PRIORITY_ARBITRATION_PREEMPTION, true);
    assert.equal(body.oracle.P3_DEAD_OWNER_LEASE_RECOVERY, true);

    // Concrete domain assertions on unguarded vs guarded steps
    assert.equal(body.unguarded.steps[0]?.committedControlValue, 0);
    assert.equal(body.guarded.steps[0]?.committedControlValue, 22.5);
    assert.equal(body.guarded.steps[0]?.committedHex, "0x41b40000");

    assert.ok(
      body.posixCommands.some((cmd) => cmd.startsWith("echo ") && cmd.includes("/dev/signal/")),
      "Expected copyable POSIX echo command targeting /dev/signal/"
    );
    assert.ok(
      body.posixCommands.some((cmd) => cmd.startsWith("cat ") && cmd.includes("?warden,text")),
      "Expected copyable POSIX cat ?warden,text diagnostic command"
    );
    assert.equal(
      body.cliReplayCommand,
      "./build/vss-warden-cli --preset preset-1-bounds-float-bug --seed 20261105"
    );
  });

  it("applies patches/qpp-vss-warden.patch with zero fuzz (patch -p1 --fuzz=0) to upstream qpp/ files and verifies all 3 upstream bug fixes and warden hooks", () => {
    const report = verifyUpstreamQppPatch();
    assert.equal(report.ok, true, `Patch verification failed: ${report.output}`);
    assert.deepEqual(
      [...report.patchedFiles].sort(),
      [
        "qpp/catalog.c",
        "qpp/ioclose.c",
        "qpp/ioopen.c",
        "qpp/iowrite.c",
        "qpp/iowrite_text.c",
        "qpp/metadata.c",
        "qpp/value.c",
      ]
    );
    assert.equal(report.verifiedFixes.vectorUint32Fixed, true);
    assert.equal(report.verifiedFixes.floatDefaultFixed, true);
    assert.equal(report.verifiedFixes.doubleDefaultFixed, true);
    assert.equal(report.verifiedFixes.metadataNonStringFixed, true);
    assert.equal(report.verifiedFixes.wardenHooksWired, true);
  });

  it("rejects malformed JSON, missing operations array, payload > 512 KB, and operations.length > 500 with HTTP 400 across both route handler and pipeline helper without spawning the C binary", async () => {
    const unspawnableOptions = {
      cliBinaryPath: "/nonexistent/vss-warden-should-never-spawn",
    };

    // 1. Malformed JSON
    const malformedDirect = runVerificationPipeline("{ broken json", unspawnableOptions);
    assert.equal(malformedDirect.ok, false);
    assert.equal(malformedDirect.statusCode, 400);
    if (!malformedDirect.ok) {
      assert.equal(malformedDirect.errorCode, "INVALID_PAYLOAD");
    }

    const malformedRes = await POST(
      new Request("http://localhost:3000/api/vss-warden/verify", {
        method: "POST",
        body: "{ broken json",
      })
    );
    assert.equal(malformedRes.status, 400);
    const malformedHttp = (await malformedRes.json()) as WardenVerifyResponse;
    assert.equal(malformedHttp.ok, false);
    if (!malformedHttp.ok) {
      assert.equal(malformedHttp.errorCode, "INVALID_PAYLOAD");
    }

    // 2. Missing operations array
    const missingOpsPayload = JSON.stringify({
      catalogJsonc: AUTOMOTIVE_PRESETS[0]?.catalogJsonc ?? "{}",
    });
    const missingOpsDirect = runVerificationPipeline(missingOpsPayload, unspawnableOptions);
    assert.equal(missingOpsDirect.ok, false);
    assert.equal(missingOpsDirect.statusCode, 400);
    if (!missingOpsDirect.ok) {
      assert.equal(missingOpsDirect.errorCode, "INVALID_PAYLOAD");
    }

    const missingOpsRes = await POST(
      new Request("http://localhost:3000/api/vss-warden/verify", {
        method: "POST",
        body: missingOpsPayload,
      })
    );
    assert.equal(missingOpsRes.status, 400);
    const missingOpsHttp = (await missingOpsRes.json()) as WardenVerifyResponse;
    assert.equal(missingOpsHttp.ok, false);
    if (!missingOpsHttp.ok) {
      assert.equal(missingOpsHttp.errorCode, "INVALID_PAYLOAD");
    }

    // 3. Payload > 512 KB (524,288 bytes)
    const oversizedPayload = JSON.stringify({
      catalogJsonc: `/* ${"A".repeat(530 * 1024)} */ {}`,
      operations: [
        {
          kind: "OPEN",
          fd: 1,
          path: "Vehicle/Body/Mirrors/Left/Pan",
          pid: 100,
          priority: 10,
          leaseMs: 500,
          role: "ivi",
        },
      ],
    });
    const oversizedDirect = runVerificationPipeline(oversizedPayload, unspawnableOptions);
    assert.equal(oversizedDirect.ok, false);
    assert.equal(oversizedDirect.statusCode, 400);
    if (!oversizedDirect.ok) {
      assert.equal(oversizedDirect.errorCode, "PAYLOAD_TOO_LARGE");
    }

    const oversizedRes = await POST(
      new Request("http://localhost:3000/api/vss-warden/verify", {
        method: "POST",
        body: oversizedPayload,
      })
    );
    assert.equal(oversizedRes.status, 400);
    const oversizedHttp = (await oversizedRes.json()) as WardenVerifyResponse;
    assert.equal(oversizedHttp.ok, false);
    if (!oversizedHttp.ok) {
      assert.equal(oversizedHttp.errorCode, "PAYLOAD_TOO_LARGE");
    }

    // 4. operations.length > 500
    const tooManyOps: WardenOperation[] = Array.from({ length: 501 }, () => ({
      kind: "ADVANCE_CLOCK",
      deltaMs: 10,
    }));
    const tooManyOpsPayload = JSON.stringify({
      catalogJsonc: AUTOMOTIVE_PRESETS[0]?.catalogJsonc ?? "{}",
      operations: tooManyOps,
    });
    const tooManyDirect = runVerificationPipeline(tooManyOpsPayload, unspawnableOptions);
    assert.equal(tooManyDirect.ok, false);
    assert.equal(tooManyDirect.statusCode, 400);
    if (!tooManyDirect.ok) {
      assert.equal(tooManyDirect.errorCode, "PAYLOAD_TOO_LARGE");
    }

    const tooManyRes = await POST(
      new Request("http://localhost:3000/api/vss-warden/verify", {
        method: "POST",
        body: tooManyOpsPayload,
      })
    );
    assert.equal(tooManyRes.status, 400);
    const tooManyHttp = (await tooManyRes.json()) as WardenVerifyResponse;
    assert.equal(tooManyHttp.ok, false);
    if (!tooManyHttp.ok) {
      assert.equal(tooManyHttp.errorCode, "PAYLOAD_TOO_LARGE");
    }
  });

  it("returns a structured ENGINE_EXECUTION_ERROR with diagnostic context when the C binary exits non-zero or times out", () => {
    const preset = AUTOMOTIVE_PRESETS[0]!;
    const validInput = {
      presetId: preset.id,
      seed: 20261105,
      catalogJsonc: preset.catalogJsonc,
      operations: preset.operations,
    };

    // Non-zero exit code (/usr/bin/false exits with 1)
    const nonZeroRes = runVerificationPipeline(validInput, {
      cliBinaryPath: "/usr/bin/false",
      timeoutMs: 1000,
    });
    assert.equal(nonZeroRes.ok, false);
    assert.equal(nonZeroRes.statusCode, 500);
    if (!nonZeroRes.ok) {
      assert.equal(nonZeroRes.errorCode, "ENGINE_EXECUTION_ERROR");
      assert.ok(nonZeroRes.diagnostics, "Expected diagnostics object on non-zero exit");
      assert.equal(nonZeroRes.diagnostics.timedOut, false);
      assert.ok(nonZeroRes.diagnostics.detail.length > 0);
    }

    // Subprocess timeout (/bin/sleep exceeds 25ms timeout)
    const timeoutRes = runVerificationPipeline(validInput, {
      cliBinaryPath: "/bin/cat",
      timeoutMs: 1,
    });
    assert.equal(timeoutRes.ok, false);
    assert.equal(timeoutRes.statusCode, 500);
    if (!timeoutRes.ok) {
      assert.equal(timeoutRes.errorCode, "ENGINE_EXECUTION_ERROR");
      assert.ok(timeoutRes.diagnostics, "Expected diagnostics object on engine error");
      assert.ok(timeoutRes.diagnostics.detail.length > 0);
    }
  });

  it("includes valid top-level Apache-2.0 LICENSE and NOTICE files attributing BlackBerry Limited qnx/qnx-posix-publish-subscribe", () => {
    const licensePath = path.join(REPO_ROOT, "LICENSE");
    const noticePath = path.join(REPO_ROOT, "NOTICE");

    assert.equal(existsSync(licensePath), true, "LICENSE file must exist at repository root");
    assert.equal(existsSync(noticePath), true, "NOTICE file must exist at repository root");

    const licenseContent = readFileSync(licensePath, "utf8");
    const noticeContent = readFileSync(noticePath, "utf8");

    assert.ok(
      licenseContent.includes("Apache License") &&
        licenseContent.includes("Version 2.0, January 2004"),
      "LICENSE must contain Apache License Version 2.0 header"
    );
    assert.ok(
      noticeContent.includes("BlackBerry Limited") &&
        noticeContent.includes("qnx/qnx-posix-publish-subscribe"),
      "NOTICE must attribute BlackBerry Limited and qnx/qnx-posix-publish-subscribe"
    );
  });
});
