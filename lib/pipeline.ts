import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateVssWardenOracle } from "./oracle.ts";
import type {
  QppPatchVerificationReport,
  WardenOperation,
  WardenVerifyResponse,
} from "./types.ts";
import {
  canonicalizeQppPath,
  runWardenCoreSequence,
  type WardenExecOptions,
} from "./warden-core.ts";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "..");
const PATCH_FILE_PATH = path.join(REPO_ROOT, "patches", "qpp-vss-warden.patch");
const UPSTREAM_QPP_DIR = path.join(REPO_ROOT, "vendor", "qpp-upstream", "qpp");

const MAX_PAYLOAD_BYTES = 512 * 1024;
const MAX_OPERATION_STEPS = 500;

const UPSTREAM_QPP_FILES = [
  "catalog.c",
  "ioclose.c",
  "ioopen.c",
  "iowrite.c",
  "iowrite_text.c",
  "metadata.c",
  "value.c",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildPosixCliCommands(operations: readonly WardenOperation[]): string[] {
  const fdToPath = new Map<number, string>();
  const commands: string[] = [];
  let firstCanonicalPath = "Vehicle/Body/Mirrors/Left/Pan";
  let hasWardenCat = false;

  for (const op of operations) {
    if (op.kind === "OPEN") {
      fdToPath.set(op.fd, op.path);
      const canon = canonicalizeQppPath(op.path);
      if (canon.ok && firstCanonicalPath === "Vehicle/Body/Mirrors/Left/Pan") {
        firstCanonicalPath = canon.canonicalPath;
      }
    } else if (op.kind === "WRITE") {
      const openedPath = fdToPath.get(op.fd) ?? `${firstCanonicalPath}?control,text`;
      const normalizedPath = openedPath.startsWith("/dev/signal/")
        ? openedPath
        : `/dev/signal/${openedPath}`;
      const valueText = Array.isArray(op.value)
        ? op.value.join(",")
        : String(op.value);
      commands.push(`echo "${valueText}" > "${normalizedPath}"`);
    } else if (op.kind === "READ_WARDEN") {
      const normalizedPath = op.path.startsWith("/dev/signal/")
        ? op.path
        : `/dev/signal/${op.path}`;
      commands.push(`cat "${normalizedPath}"`);
      if (normalizedPath.includes("warden")) {
        hasWardenCat = true;
      }
    }
  }

  if (!hasWardenCat) {
    commands.push(`cat "/dev/signal/${firstCanonicalPath}?warden,text"`);
  }

  return commands;
}

export function runVerificationPipeline(
  rawInput: unknown,
  options?: WardenExecOptions
): WardenVerifyResponse {
  let parsedObj: Record<string, unknown>;

  if (typeof rawInput === "string") {
    const byteLen = Buffer.byteLength(rawInput, "utf8");
    if (byteLen > MAX_PAYLOAD_BYTES) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: "PAYLOAD_TOO_LARGE",
        errorMessage: `Request body size (${byteLen} bytes) exceeds 512 KB cap (${MAX_PAYLOAD_BYTES} bytes)`,
      };
    }
    try {
      const parsed: unknown = JSON.parse(rawInput);
      if (!isRecord(parsed)) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: "INVALID_PAYLOAD",
          errorMessage: "Request JSON root must be an object",
        };
      }
      parsedObj = parsed;
    } catch {
      return {
        ok: false,
        statusCode: 400,
        errorCode: "INVALID_PAYLOAD",
        errorMessage: "Malformed JSON request body",
      };
    }
  } else if (isRecord(rawInput)) {
    const serialized = JSON.stringify(rawInput);
    const byteLen = Buffer.byteLength(serialized, "utf8");
    if (byteLen > MAX_PAYLOAD_BYTES) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: "PAYLOAD_TOO_LARGE",
        errorMessage: `Request payload size (${byteLen} bytes) exceeds 512 KB cap (${MAX_PAYLOAD_BYTES} bytes)`,
      };
    }
    parsedObj = rawInput;
  } else {
    return {
      ok: false,
      statusCode: 400,
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "Request payload must be a JSON string or object",
    };
  }

  const requestId =
    typeof parsedObj.requestId === "number" && Number.isFinite(parsedObj.requestId)
      ? Math.trunc(parsedObj.requestId)
      : undefined;

  if (
    typeof parsedObj.catalogJsonc !== "string" ||
    parsedObj.catalogJsonc.trim().length === 0
  ) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "Missing or empty catalogJsonc string",
      requestId,
    };
  }

  if (!Array.isArray(parsedObj.operations)) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "Missing required operations array",
      requestId,
    };
  }

  if (parsedObj.operations.length > MAX_OPERATION_STEPS) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: "PAYLOAD_TOO_LARGE",
      errorMessage: `operations.length (${parsedObj.operations.length}) exceeds maximum of ${MAX_OPERATION_STEPS} steps`,
      requestId,
    };
  }

  if (
    parsedObj.operations.length === 0 ||
    !parsedObj.operations.every(isRecord)
  ) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "operations must be a non-empty array of operation objects",
      requestId,
    };
  }

  const catalogJsonc = parsedObj.catalogJsonc;
  const operations = parsedObj.operations as unknown as WardenOperation[];
  const presetId =
    typeof parsedObj.presetId === "string" ? parsedObj.presetId : "custom";
  const seed =
    typeof parsedObj.seed === "number" && Number.isFinite(parsedObj.seed)
      ? Math.trunc(parsedObj.seed)
      : 0;

  const unguarded = runWardenCoreSequence(
    catalogJsonc,
    operations,
    "unguarded",
    options
  );
  const guarded = runWardenCoreSequence(
    catalogJsonc,
    operations,
    "guarded",
    options
  );

  if (!unguarded.ok || !guarded.ok) {
    const detail =
      guarded.errorMessage ??
      unguarded.errorMessage ??
      "C engine returned a non-zero exit code or failed to execute batch";
    const timedOut =
      detail.includes("ETIMEDOUT") || detail.toLowerCase().includes("timed out");
    return {
      ok: false,
      statusCode: 500,
      errorCode: "ENGINE_EXECUTION_ERROR",
      errorMessage: detail,
      requestId,
      diagnostics: {
        timedOut,
        detail,
      },
    };
  }

  const oracle = evaluateVssWardenOracle(
    catalogJsonc,
    operations,
    unguarded,
    guarded
  );
  const posixCommands = buildPosixCliCommands(operations);
  const cliReplayCommand = `./build/vss-warden-cli --preset ${presetId} --seed ${seed}`;

  return {
    ok: true,
    statusCode: 200,
    presetId,
    seed,
    requestId,
    unguarded,
    guarded,
    oracle,
    posixCommands,
    cliReplayCommand,
  };
}

export function verifyUpstreamQppPatch(): QppPatchVerificationReport {
  if (!existsSync(PATCH_FILE_PATH)) {
    return {
      ok: false,
      patchPath: PATCH_FILE_PATH,
      patchedFiles: [],
      verifiedFixes: {
        vectorUint32Fixed: false,
        floatDefaultFixed: false,
        doubleDefaultFixed: false,
        metadataNonStringFixed: false,
        wardenHooksWired: false,
      },
      output: `Patch file not found at ${PATCH_FILE_PATH}`,
    };
  }

  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "qpp-vss-warden-patch-"));
  const tmpQppDir = path.join(tmpRoot, "qpp");
  mkdirSync(tmpQppDir, { recursive: true });

  try {
    for (const fileName of UPSTREAM_QPP_FILES) {
      const src = path.join(UPSTREAM_QPP_DIR, fileName);
      const dst = path.join(tmpQppDir, fileName);
      copyFileSync(src, dst);
    }

    const patchOutput = execFileSync(
      "patch",
      ["-p1", "--fuzz=0", "-d", tmpRoot, "-i", PATCH_FILE_PATH],
      { encoding: "utf8", stdio: "pipe" }
    );

    const patchedValueC = readFileSync(path.join(tmpQppDir, "value.c"), "utf8");
    const patchedMetadataC = readFileSync(path.join(tmpQppDir, "metadata.c"), "utf8");
    const patchedCatalogC = readFileSync(path.join(tmpQppDir, "catalog.c"), "utf8");
    const patchedIoopenC = readFileSync(path.join(tmpQppDir, "ioopen.c"), "utf8");
    const patchedIowriteC = readFileSync(path.join(tmpQppDir, "iowrite.c"), "utf8");
    const patchedIowriteTextC = readFileSync(
      path.join(tmpQppDir, "iowrite_text.c"),
      "utf8"
    );
    const patchedIocloseC = readFileSync(path.join(tmpQppDir, "ioclose.c"), "utf8");

    const vectorUint32Fixed = patchedValueC.includes(
      '[VECTOR_UINT32] = {0, UINT32_MAX, sizeof(uint32_t), "uint32[]"}'
    );
    const floatDefaultFixed = patchedValueC.includes(
      "((float *)data_ptr)[idx] = (float)json_d;"
    );
    const doubleDefaultFixed = patchedValueC.includes(
      "((double *)data_ptr)[idx] = (double)json_d;"
    );
    const metadataNonStringFixed =
      patchedMetadataC.includes("json_decoder_position_property(decoder, attribute)") &&
      patchedMetadataC.includes("json_encoder_add_from_decoder(encoder, NULL, decoder, NULL)");
    const wardenHooksWired =
      patchedCatalogC.includes('#include "vss_warden_core.h"') &&
      patchedIoopenC.includes("OP_MODE_WARDEN") &&
      patchedIowriteC.includes("vss_warden_canonicalize_path") &&
      patchedIowriteTextC.includes("vss_warden_canonicalize_path") &&
      patchedIocloseC.includes("vss_warden_canonicalize_path");

    const allFixesVerified =
      vectorUint32Fixed &&
      floatDefaultFixed &&
      doubleDefaultFixed &&
      metadataNonStringFixed &&
      wardenHooksWired;

    return {
      ok: allFixesVerified,
      patchPath: PATCH_FILE_PATH,
      patchedFiles: UPSTREAM_QPP_FILES.map((fn) => `qpp/${fn}`),
      verifiedFixes: {
        vectorUint32Fixed,
        floatDefaultFixed,
        doubleDefaultFixed,
        metadataNonStringFixed,
        wardenHooksWired,
      },
      output: patchOutput.trim(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to apply patch";
    return {
      ok: false,
      patchPath: PATCH_FILE_PATH,
      patchedFiles: [],
      verifiedFixes: {
        vectorUint32Fixed: false,
        floatDefaultFixed: false,
        doubleDefaultFixed: false,
        metadataNonStringFixed: false,
        wardenHooksWired: false,
      },
      output: message,
    };
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
