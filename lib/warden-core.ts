import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  WardenMode,
  WardenOperation,
  WardenSequenceResult,
  WardenTargetKind,
} from "./types.ts";

export interface CanonicalQppPath {
  ok: boolean;
  canonicalPath: string;
  targetKind: WardenTargetKind;
  modifiers: {
    text: boolean;
    priority: number | null;
    leaseMs: number | null;
    role: string | null;
  };
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "..");
const CLI_BINARY_PATH = path.join(REPO_ROOT, "build", "vss-warden-cli");
const C_CORE_HEADER = path.join(REPO_ROOT, "src", "c", "vss_warden_core.h");
const C_CORE_SOURCE = path.join(REPO_ROOT, "src", "c", "vss_warden_core.c");
const C_CLI_SOURCE = path.join(REPO_ROOT, "src", "c", "vss_warden_cli.c");

export function ensureWardenCliBinary(): string {
  const buildDir = path.dirname(CLI_BINARY_PATH);
  mkdirSync(buildDir, { recursive: true });

  let needsBuild = !existsSync(CLI_BINARY_PATH);
  if (!needsBuild) {
    const binMtime = statSync(CLI_BINARY_PATH).mtimeMs;
    const srcMtime = Math.max(
      statSync(C_CORE_HEADER).mtimeMs,
      statSync(C_CORE_SOURCE).mtimeMs,
      statSync(C_CLI_SOURCE).mtimeMs
    );
    if (srcMtime > binMtime) {
      needsBuild = true;
    }
  }

  if (needsBuild) {
    execFileSync(
      "clang",
      [
        "-std=c11",
        "-O2",
        "-Wall",
        "-Wextra",
        C_CORE_SOURCE,
        C_CLI_SOURCE,
        "-o",
        CLI_BINARY_PATH,
      ],
      { cwd: REPO_ROOT, stdio: "pipe" }
    );
  }

  return CLI_BINARY_PATH;
}

export function stripJsoncComments(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;

  while (i < input.length) {
    const c = input[i];
    const next = input[i + 1];

    if (inString) {
      if (c === "\\" && next !== undefined) {
        out += c + next;
        i += 2;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      out += c;
      i++;
    } else {
      if (c === '"') {
        inString = true;
        out += c;
        i++;
      } else if (c === "/" && next === "*") {
        i += 2;
        let closed = false;
        while (i < input.length) {
          if (input[i] === "*" && input[i + 1] === "/") {
            i += 2;
            closed = true;
            break;
          }
          i++;
        }
        if (!closed) {
          throw new SyntaxError("Unterminated C-style block comment in JSONC input");
        }
        out += " ";
      } else if (c === "/" && next === "/") {
        i += 2;
        while (i < input.length && input[i] !== "\n") {
          i++;
        }
      } else {
        out += c;
        i++;
      }
    }
  }

  return out;
}

export function canonicalizeQppPath(rawPath: string): CanonicalQppPath {
  const invalidResult: CanonicalQppPath = {
    ok: false,
    canonicalPath: "",
    targetKind: "VALUE",
    modifiers: {
      text: false,
      priority: null,
      leaseMs: null,
      role: null,
    },
  };

  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    return invalidResult;
  }

  const qParts = rawPath.split("?");
  if (qParts.length > 2) {
    return invalidResult;
  }

  const rawLeft = qParts[0] ?? "";
  const modPart = qParts[1];
  let targetKind: WardenTargetKind = "VALUE";
  let textMode = false;
  let priority: number | null = null;
  let leaseMs: number | null = null;
  let role: string | null = null;

  if (modPart !== undefined) {
    if (modPart.length === 0) {
      return invalidResult;
    }
    for (const tok of modPart.split(",")) {
      if (tok === "text") {
        textMode = true;
      } else if (tok === "control") {
        targetKind = "CONTROL";
      } else if (tok === "warden") {
        targetKind = "WARDEN";
      } else if (tok.startsWith("priority=")) {
        const p = Number.parseInt(tok.slice("priority=".length), 10);
        if (Number.isFinite(p)) priority = p;
      } else if (tok.startsWith("lease=")) {
        const l = Number.parseInt(tok.slice("lease=".length), 10);
        if (Number.isFinite(l)) leaseMs = l;
      } else if (tok.startsWith("as=")) {
        role = tok.slice("as=".length);
      }
    }
  }

  let cleaned = rawLeft.trim();
  if (cleaned.startsWith("/dev/signal/")) {
    cleaned = cleaned.slice("/dev/signal/".length);
  }
  while (cleaned.startsWith("/")) {
    cleaned = cleaned.slice(1);
  }
  while (cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
  }
  if (cleaned.length === 0) {
    return invalidResult;
  }

  if (!cleaned.includes("/")) {
    cleaned = cleaned.replaceAll(".", "/");
  } else {
    const segments = cleaned.split("/");
    const lastIdx = segments.length - 1;
    const leaf = segments[lastIdx] ?? "";
    if (leaf.startsWith(".")) {
      if (leaf.endsWith(".control") && leaf.length > ".control".length + 1) {
        targetKind = "CONTROL";
        segments[lastIdx] = leaf.slice(1, -".control".length);
      } else if (leaf.endsWith(".warden") && leaf.length > ".warden".length + 1) {
        targetKind = "WARDEN";
        segments[lastIdx] = leaf.slice(1, -".warden".length);
      }
    }
    cleaned = segments.join("/");
  }

  const finalSegments = cleaned.split("/");
  if (finalSegments.some((seg) => seg.length === 0)) {
    return invalidResult;
  }

  return {
    ok: true,
    canonicalPath: finalSegments.join("/"),
    targetKind,
    modifiers: {
      text: textMode,
      priority,
      leaseMs,
      role,
    },
  };
}

export interface WardenExecOptions {
  cliBinaryPath?: string;
  timeoutMs?: number;
}

export function runWardenCoreSequence(
  catalogJsonc: string,
  operations: readonly WardenOperation[],
  mode: WardenMode,
  options?: WardenExecOptions
): WardenSequenceResult {
  try {
    const cliBinary = options?.cliBinaryPath ?? ensureWardenCliBinary();
    const timeout = options?.timeoutMs ?? 5000;
    const requestPayload = JSON.stringify({
      mode,
      catalogJsonc,
      operations,
    });

    const stdout = execFileSync(cliBinary, [], {
      input: requestPayload,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout,
    });

    const parsed = JSON.parse(stdout) as WardenSequenceResult;
    return {
      ok: Boolean(parsed.ok),
      status: parsed.status ?? "EINVAL",
      mode: parsed.mode ?? mode,
      errorMessage: parsed.errorMessage ?? null,
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "C engine execution failure";
    return {
      ok: false,
      status: "EINVAL",
      mode,
      errorMessage: message,
      steps: [],
    };
  }
}
