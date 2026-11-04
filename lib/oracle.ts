import type {
  VssCatalogNodeInput,
  VssDatatype,
  VssNodeType,
  VssSignalSpec,
  VssSignalValue,
  WardenActiveHolder,
  WardenErrno,
  WardenMode,
  WardenOperation,
  WardenOracleReport,
  WardenReachabilityCounters,
  WardenRejectionInfo,
  WardenRuleId,
  WardenSequenceResult,
  WardenStepOracleVerdict,
  WardenStepReceipt,
} from "./types.ts";
import { canonicalizeQppPath, stripJsoncComments } from "./warden-core.ts";

interface OracleOcbState {
  fd: number;
  signalPath: string;
  pid: number;
  priority: number;
  leaseMs: number;
  role: string;
  isOpen: boolean;
  hasStandby: boolean;
  standbyValue: VssSignalValue;
  standbyExpiresMs: number;
  standbySeq: number;
}

interface OracleSignalState {
  spec: VssSignalSpec;
  defaultValue: VssSignalValue;
  committedValue: VssSignalValue;
  activeHolder: WardenActiveHolder | null;
  lastRejection: WardenRejectionInfo | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatCommittedHex(
  datatype: VssDatatype,
  value: VssSignalValue | null
): string {
  if (value === null) {
    return "0x00";
  }

  if (datatype === "int8" || datatype === "uint8") {
    const n = typeof value === "number" ? Math.trunc(value) & 0xff : 0;
    return `0x${n.toString(16).padStart(2, "0")}`;
  }

  if (datatype === "int16" || datatype === "uint16") {
    const n = typeof value === "number" ? Math.trunc(value) & 0xffff : 0;
    return `0x${n.toString(16).padStart(4, "0")}`;
  }

  if (datatype === "int32" || datatype === "uint32") {
    const n = typeof value === "number" ? Math.trunc(value) >>> 0 : 0;
    return `0x${n.toString(16).padStart(8, "0")}`;
  }

  if (datatype === "int64" || datatype === "uint64") {
    const n = typeof value === "number" ? BigInt(Math.trunc(value)) : 0n;
    const unsigned = BigInt.asUintN(64, n);
    return `0x${unsigned.toString(16).padStart(16, "0")}`;
  }

  if (datatype === "float") {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, typeof value === "number" ? value : 0, false);
    return `0x${view.getUint32(0, false).toString(16).padStart(8, "0")}`;
  }

  if (datatype === "double") {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setFloat64(0, typeof value === "number" ? value : 0, false);
    return `0x${view.getBigUint64(0, false).toString(16).padStart(16, "0")}`;
  }

  if (datatype === "string") {
    const s = typeof value === "string" ? value : "";
    if (s.length === 0) return "0x00";
    const bytes = Buffer.from(s, "utf8");
    return `0x${bytes.toString("hex")}`;
  }

  if (datatype === "uint32[]") {
    if (!Array.isArray(value) || value.length === 0) return "0x00";
    const hexParts = value.map((el) => ((Math.trunc(el) >>> 0).toString(16).padStart(8, "0")));
    return `0x${hexParts.join("")}`;
  }

  return "0x00";
}

function normalizeFloatValue(datatype: VssDatatype, val: number): number {
  if (datatype === "float") {
    const f = Math.fround(val);
    return Object.is(f, -0) ? 0 : Number(f.toPrecision(6));
  }
  return Object.is(val, -0) ? 0 : val;
}

export function parseCatalogSpecs(catalogJsonc: string): VssSignalSpec[] {
  const stripped = stripJsoncComments(catalogJsonc).trim();
  if (stripped.length === 0) {
    throw new SyntaxError("Empty catalog input");
  }
  const parsed: unknown = JSON.parse(stripped);
  if (!isRecord(parsed)) {
    throw new SyntaxError("Catalog root must be a JSON object");
  }

  const specs: VssSignalSpec[] = [];

  const walk = (prefix: string, obj: Record<string, unknown>): void => {
    for (const [key, rawNode] of Object.entries(obj)) {
      if (!isRecord(rawNode)) continue;
      const fullPath = prefix.length > 0 ? `${prefix}/${key}` : key;
      const nodeType = typeof rawNode.type === "string" ? rawNode.type : undefined;
      const children = isRecord(rawNode.children) ? rawNode.children : undefined;

      if (nodeType === "branch" && children) {
        walk(fullPath, children);
      } else if (typeof rawNode.datatype === "string") {
        const canon = canonicalizeQppPath(fullPath);
        if (!canon.ok) continue;
        const dt = rawNode.datatype as VssDatatype;
        const nType = (nodeType ?? "actuator") as VssNodeType;
        let defVal: VssSignalValue = 0;
        if (rawNode.default !== undefined) {
          defVal = rawNode.default as VssSignalValue;
        } else if (dt === "string") {
          defVal = "";
        } else if (dt.endsWith("[]")) {
          defVal = [];
        }

        const spec: VssSignalSpec = {
          path: canon.canonicalPath,
          datatype: dt,
          type: nType,
          default:
            typeof defVal === "number" ? normalizeFloatValue(dt, defVal) : defVal,
        };
        if (typeof rawNode.min === "number") {
          spec.min = rawNode.min;
        }
        if (typeof rawNode.max === "number") {
          spec.max = rawNode.max;
        }
        if (typeof rawNode.arraysize === "number") {
          spec.arraysize = rawNode.arraysize;
        }
        if (Array.isArray(rawNode.allowed)) {
          spec.allowed = rawNode.allowed.filter(
            (x): x is string | number => typeof x === "string" || typeof x === "number"
          );
        }
        specs.push(spec);
      } else if (children) {
        walk(fullPath, children);
      }
    }
  };

  walk("", parsed as Record<string, VssCatalogNodeInput>);
  return specs;
}

function getNativeBounds(datatype: VssDatatype): {
  min: number;
  max: number;
  isInteger: boolean;
} {
  switch (datatype) {
    case "int8":
      return { min: -128, max: 127, isInteger: true };
    case "int16":
      return { min: -32768, max: 32767, isInteger: true };
    case "int32":
      return { min: -2147483648, max: 2147483647, isInteger: true };
    case "int64":
      return { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER, isInteger: true };
    case "uint8":
      return { min: 0, max: 255, isInteger: true };
    case "uint16":
      return { min: 0, max: 65535, isInteger: true };
    case "uint32":
    case "uint32[]":
      return { min: 0, max: 4294967295, isInteger: true };
    case "uint64":
      return { min: 0, max: Number.MAX_SAFE_INTEGER, isInteger: true };
    default:
      return { min: -3.402823466e38, max: 3.402823466e38, isInteger: false };
  }
}

interface ReferenceStepMeta {
  receipt: WardenStepReceipt;
  invariantBucket: "P1" | "P2" | "P3";
  applied: boolean;
  boundsRejected: boolean;
  priorityBlocked: boolean;
  leaseRecovered: boolean;
}

function runReferenceSimulationWithMeta(
  specs: readonly VssSignalSpec[],
  operations: readonly WardenOperation[],
  mode: WardenMode
): ReferenceStepMeta[] {
  const signals = new Map<string, OracleSignalState>();
  const signalOrder: string[] = [];

  for (const spec of specs) {
    const loadedDefault: VssSignalValue =
      mode === "unguarded" && (spec.datatype === "float" || spec.datatype === "double")
        ? 0
        : Array.isArray(spec.default)
          ? [...spec.default]
          : spec.default;

    signals.set(spec.path, {
      spec,
      defaultValue: loadedDefault,
      committedValue: Array.isArray(loadedDefault) ? [...loadedDefault] : loadedDefault,
      activeHolder: null,
      lastRejection: null,
    });
    signalOrder.push(spec.path);
  }

  const ocbs = new Map<number, OracleOcbState>();
  let currentClockMs = 0;
  let lastTouchedSignalPath = signalOrder[0] ?? "";
  let seqCounter = 0;
  const justRecoveredOnSignal = new Set<string>();

  const findBestStandby = (sigPath: string): OracleOcbState | null => {
    let best: OracleOcbState | null = null;
    for (const ocb of ocbs.values()) {
      if (!ocb.isOpen || ocb.signalPath !== sigPath || !ocb.hasStandby) {
        continue;
      }
      if (ocb.standbyExpiresMs <= currentClockMs) {
        ocb.hasStandby = false;
        continue;
      }
      if (
        best === null ||
        ocb.priority > best.priority ||
        (ocb.priority === best.priority && ocb.standbySeq > best.standbySeq)
      ) {
        best = ocb;
      }
    }
    return best;
  };

  const releaseAndRecoverSignal = (sigState: OracleSignalState): void => {
    const best = findBestStandby(sigState.spec.path);
    if (best !== null) {
      sigState.activeHolder = {
        fd: best.fd,
        role: best.role,
        pid: best.pid,
        priority: best.priority,
        leaseExpiresMs: best.standbyExpiresMs,
      };
      sigState.committedValue = Array.isArray(best.standbyValue)
        ? [...best.standbyValue]
        : best.standbyValue;
      best.hasStandby = false;
    } else {
      sigState.activeHolder = null;
      sigState.committedValue = Array.isArray(sigState.defaultValue)
        ? [...sigState.defaultValue]
        : sigState.defaultValue;
    }
    justRecoveredOnSignal.add(sigState.spec.path);
  };

  const expireLeasesUpToClock = (): { expiredPaths: string[] } => {
    const expiredPaths: string[] = [];
    if (mode !== "guarded") return { expiredPaths };

    for (const ocb of ocbs.values()) {
      if (ocb.hasStandby && currentClockMs >= ocb.standbyExpiresMs) {
        ocb.hasStandby = false;
      }
    }

    for (const sigPath of signalOrder) {
      const sigState = signals.get(sigPath);
      if (
        sigState &&
        sigState.activeHolder !== null &&
        sigState.activeHolder.leaseExpiresMs !== null &&
        currentClockMs >= sigState.activeHolder.leaseExpiresMs
      ) {
        expiredPaths.push(sigPath);
        releaseAndRecoverSignal(sigState);
      }
    }
    return { expiredPaths };
  };

  const buildReceipt = (
    stepIndex: number,
    opKind: WardenOperation["kind"],
    status: WardenErrno,
    sigState: OracleSignalState | undefined,
    includeWardenPayload: boolean
  ): WardenStepReceipt => {
    if (!sigState) {
      return {
        stepIndex,
        opKind,
        status,
        committedControlValue: null,
        committedHex: "0x00",
        activeHolder: null,
        lastRejection: null,
      };
    }

    const committedValue = Array.isArray(sigState.committedValue)
      ? [...sigState.committedValue]
      : sigState.committedValue;
    const committedHex = formatCommittedHex(sigState.spec.datatype, committedValue);
    const activeHolder = sigState.activeHolder ? { ...sigState.activeHolder } : null;
    const lastRejection = sigState.lastRejection ? { ...sigState.lastRejection } : null;

    const receipt: WardenStepReceipt = {
      stepIndex,
      opKind,
      status,
      signalPath: sigState.spec.path,
      committedControlValue: committedValue,
      committedHex,
      activeHolder,
      lastRejection,
    };

    if (includeWardenPayload) {
      receipt.wardenPayload = {
        path: sigState.spec.path,
        datatype: sigState.spec.datatype,
        committedControlValue: committedValue,
        activeHolder,
        lastRejection,
      };
    }

    return receipt;
  };

  const results: ReferenceStepMeta[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]!;

    if (op.kind === "OPEN") {
      const pinfo = canonicalizeQppPath(op.path);
      if (!pinfo.ok || op.fd < 0) {
        results.push({
          receipt: buildReceipt(i, "OPEN", "EINVAL", undefined, false),
          invariantBucket: "P1",
          applied: false,
          boundsRejected: false,
          priorityBlocked: false,
          leaseRecovered: false,
        });
        continue;
      }

      const sigState = signals.get(pinfo.canonicalPath);
      if (!sigState) {
        results.push({
          receipt: buildReceipt(i, "OPEN", "ENOENT", undefined, false),
          invariantBucket: "P1",
          applied: false,
          boundsRejected: false,
          priorityBlocked: false,
          leaseRecovered: false,
        });
        continue;
      }

      const prevOcb = ocbs.get(op.fd);
      if (prevOcb && prevOcb.isOpen && mode === "guarded") {
        const prevSig = signals.get(prevOcb.signalPath);
        if (prevSig && prevSig.activeHolder && prevSig.activeHolder.fd === op.fd) {
          releaseAndRecoverSignal(prevSig);
        }
      }

      ocbs.set(op.fd, {
        fd: op.fd,
        signalPath: pinfo.canonicalPath,
        pid: op.pid,
        priority: pinfo.modifiers.priority ?? op.priority,
        leaseMs: pinfo.modifiers.leaseMs ?? op.leaseMs,
        role: pinfo.modifiers.role ?? op.role,
        isOpen: true,
        hasStandby: false,
        standbyValue: sigState.defaultValue,
        standbyExpiresMs: 0,
        standbySeq: 0,
      });

      lastTouchedSignalPath = pinfo.canonicalPath;
      results.push({
        receipt: buildReceipt(i, "OPEN", "EOK", sigState, false),
        invariantBucket: "P1",
        applied: false,
        boundsRejected: false,
        priorityBlocked: false,
        leaseRecovered: false,
      });
    } else if (op.kind === "WRITE") {
      if (op.nowMs > currentClockMs) {
        currentClockMs = op.nowMs;
      }
      const { expiredPaths } = expireLeasesUpToClock();
      const ocb = ocbs.get(op.fd);
      if (!ocb || !ocb.isOpen) {
        const assocSig = ocb ? signals.get(ocb.signalPath) : undefined;
        results.push({
          receipt: buildReceipt(i, "WRITE", "EBADF", assocSig, false),
          invariantBucket: "P1",
          applied: false,
          boundsRejected: false,
          priorityBlocked: false,
          leaseRecovered: false,
        });
        continue;
      }

      const sigState = signals.get(ocb.signalPath)!;
      lastTouchedSignalPath = sigState.spec.path;
      const recoveredBeforeWrite =
        expiredPaths.includes(sigState.spec.path) ||
        justRecoveredOnSignal.has(sigState.spec.path);

      if (mode === "unguarded") {
        const dt = sigState.spec.datatype;
        if (dt === "uint32[]") {
          if (!Array.isArray(op.value) || op.value.length === 0) {
            results.push({
              receipt: buildReceipt(i, "WRITE", "EINVAL", sigState, false),
              invariantBucket: "P1",
              applied: false,
              boundsRejected: true,
              priorityBlocked: false,
              leaseRecovered: false,
            });
            continue;
          }
          const hasOutOfUint16 = op.value.some(
            (el) => typeof el !== "number" || !Number.isFinite(el) || el < 0 || el > 65535
          );
          if (hasOutOfUint16) {
            results.push({
              receipt: buildReceipt(i, "WRITE", "ERANGE", sigState, false),
              invariantBucket: "P1",
              applied: false,
              boundsRejected: true,
              priorityBlocked: false,
              leaseRecovered: false,
            });
            continue;
          }
          sigState.committedValue = op.value.map((el) => Math.trunc(el) >>> 0);
          results.push({
            receipt: buildReceipt(i, "WRITE", "EOK", sigState, false),
            invariantBucket: "P1",
            applied: true,
            boundsRejected: false,
            priorityBlocked: false,
            leaseRecovered: false,
          });
          continue;
        } else if (dt === "string") {
          if (typeof op.value !== "string") {
            results.push({
              receipt: buildReceipt(i, "WRITE", "EINVAL", sigState, false),
              invariantBucket: "P1",
              applied: false,
              boundsRejected: true,
              priorityBlocked: false,
              leaseRecovered: false,
            });
            continue;
          }
          sigState.committedValue = op.value;
          results.push({
            receipt: buildReceipt(i, "WRITE", "EOK", sigState, false),
            invariantBucket: "P1",
            applied: true,
            boundsRejected: false,
            priorityBlocked: false,
            leaseRecovered: false,
          });
          continue;
        } else {
          if (typeof op.value !== "number" || !Number.isFinite(op.value)) {
            results.push({
              receipt: buildReceipt(i, "WRITE", "EINVAL", sigState, false),
              invariantBucket: "P1",
              applied: false,
              boundsRejected: true,
              priorityBlocked: false,
              leaseRecovered: false,
            });
            continue;
          }
          const nat = getNativeBounds(dt);
          if (op.value < nat.min || op.value > nat.max) {
            results.push({
              receipt: buildReceipt(i, "WRITE", "ERANGE", sigState, false),
              invariantBucket: "P1",
              applied: false,
              boundsRejected: true,
              priorityBlocked: false,
              leaseRecovered: false,
            });
            continue;
          }
          sigState.committedValue = normalizeFloatValue(dt, op.value);
          results.push({
            receipt: buildReceipt(i, "WRITE", "EOK", sigState, false),
            invariantBucket: "P1",
            applied: true,
            boundsRejected: false,
            priorityBlocked: false,
            leaseRecovered: false,
          });
          continue;
        }
      }

      const setRejection = (
        errnoCode: WardenErrno,
        ruleId: WardenRuleId,
        reason: string
      ): void => {
        sigState.lastRejection = {
          errnoCode,
          ruleId,
          reason,
        };
      };

      const dt = sigState.spec.datatype;
      let normalizedWriteVal: VssSignalValue = op.value;

      if (dt === "uint32[]") {
        if (
          !Array.isArray(op.value) ||
          op.value.length === 0 ||
          (sigState.spec.arraysize !== undefined &&
            op.value.length > sigState.spec.arraysize)
        ) {
          setRejection(
            "EINVAL",
            "VSS_ARRAY_SIZE",
            "Vector length violates VSS arraysize constraint"
          );
          results.push({
            receipt: buildReceipt(i, "WRITE", "EINVAL", sigState, false),
            invariantBucket: "P1",
            applied: false,
            boundsRejected: true,
            priorityBlocked: false,
            leaseRecovered: false,
          });
          continue;
        }

        const effMin = Math.max(0, sigState.spec.min ?? 0);
        const effMax = Math.min(4294967295, sigState.spec.max ?? 4294967295);
        let elemErr: WardenErrno | null = null;
        for (const el of op.value) {
          if (typeof el !== "number" || !Number.isFinite(el) || !Number.isInteger(el)) {
            elemErr = "EINVAL";
            break;
          }
          if (el < effMin || el > effMax) {
            elemErr = "ERANGE";
            break;
          }
        }
        if (elemErr !== null) {
          setRejection(
            elemErr,
            "VSS_MIN_MAX",
            "Vector element out of VSS [min, max] or uint32 bounds"
          );
          results.push({
            receipt: buildReceipt(i, "WRITE", elemErr, sigState, false),
            invariantBucket: "P1",
            applied: false,
            boundsRejected: true,
            priorityBlocked: false,
            leaseRecovered: false,
          });
          continue;
        }
        normalizedWriteVal = op.value.map((el) => Math.trunc(el) >>> 0);
      } else if (dt === "string") {
        if (typeof op.value !== "string") {
          setRejection("EINVAL", "VSS_ALLOWED_ENUM", "Expected string value");
          results.push({
            receipt: buildReceipt(i, "WRITE", "EINVAL", sigState, false),
            invariantBucket: "P1",
            applied: false,
            boundsRejected: true,
            priorityBlocked: false,
            leaseRecovered: false,
          });
          continue;
        }
        if (
          sigState.spec.allowed &&
          sigState.spec.allowed.length > 0 &&
          !sigState.spec.allowed.includes(op.value)
        ) {
          setRejection(
            "EINVAL",
            "VSS_ALLOWED_ENUM",
            "Value is not in VSS allowed enum list"
          );
          results.push({
            receipt: buildReceipt(i, "WRITE", "EINVAL", sigState, false),
            invariantBucket: "P1",
            applied: false,
            boundsRejected: true,
            priorityBlocked: false,
            leaseRecovered: false,
          });
          continue;
        }
      } else {
        if (typeof op.value !== "number" || !Number.isFinite(op.value)) {
          setRejection("EINVAL", "VSS_MIN_MAX", "Expected finite numeric value");
          results.push({
            receipt: buildReceipt(i, "WRITE", "EINVAL", sigState, false),
            invariantBucket: "P1",
            applied: false,
            boundsRejected: true,
            priorityBlocked: false,
            leaseRecovered: false,
          });
          continue;
        }
        const nat = getNativeBounds(dt);
        if (nat.isInteger && !Number.isInteger(op.value)) {
          setRejection("EINVAL", "VSS_MIN_MAX", "Non-integer value for integer signal");
          results.push({
            receipt: buildReceipt(i, "WRITE", "EINVAL", sigState, false),
            invariantBucket: "P1",
            applied: false,
            boundsRejected: true,
            priorityBlocked: false,
            leaseRecovered: false,
          });
          continue;
        }
        const effMin =
          sigState.spec.min !== undefined ? Math.max(nat.min, sigState.spec.min) : nat.min;
        const effMax =
          sigState.spec.max !== undefined ? Math.min(nat.max, sigState.spec.max) : nat.max;
        if (op.value < effMin || op.value > effMax) {
          setRejection(
            "ERANGE",
            "VSS_MIN_MAX",
            "Value violates compiled VSS [min, max] bounds"
          );
          results.push({
            receipt: buildReceipt(i, "WRITE", "ERANGE", sigState, false),
            invariantBucket: "P1",
            applied: false,
            boundsRejected: true,
            priorityBlocked: false,
            leaseRecovered: false,
          });
          continue;
        }
        if (
          sigState.spec.allowed &&
          sigState.spec.allowed.length > 0 &&
          !sigState.spec.allowed.includes(op.value)
        ) {
          setRejection("EINVAL", "VSS_ALLOWED_ENUM", "Numeric value not in allowed list");
          results.push({
            receipt: buildReceipt(i, "WRITE", "EINVAL", sigState, false),
            invariantBucket: "P1",
            applied: false,
            boundsRejected: true,
            priorityBlocked: false,
            leaseRecovered: false,
          });
          continue;
        }
        normalizedWriteVal = normalizeFloatValue(dt, op.value);
      }

      const hadActiveHolder = sigState.activeHolder !== null;
      if (sigState.activeHolder !== null) {
        if (
          ocb.fd !== sigState.activeHolder.fd &&
          ocb.priority <= sigState.activeHolder.priority
        ) {
          setRejection(
            "EBUSY",
            "PRIORITY_PREEMPTED",
            "Actuator locked by higher or equal priority active holder"
          );
          results.push({
            receipt: buildReceipt(i, "WRITE", "EBUSY", sigState, false),
            invariantBucket: "P2",
            applied: false,
            boundsRejected: false,
            priorityBlocked: true,
            leaseRecovered: false,
          });
          continue;
        }

        if (
          ocb.fd !== sigState.activeHolder.fd &&
          ocb.priority > sigState.activeHolder.priority
        ) {
          const prevOcb = ocbs.get(sigState.activeHolder.fd);
          if (
            prevOcb &&
            prevOcb.isOpen &&
            sigState.activeHolder.leaseExpiresMs !== null &&
            sigState.activeHolder.leaseExpiresMs > currentClockMs
          ) {
            prevOcb.hasStandby = true;
            prevOcb.standbyValue = Array.isArray(sigState.committedValue)
              ? [...sigState.committedValue]
              : sigState.committedValue;
            prevOcb.standbyExpiresMs = sigState.activeHolder.leaseExpiresMs;
            prevOcb.standbySeq = ++seqCounter;
          }
        }
      }

      sigState.committedValue = Array.isArray(normalizedWriteVal)
        ? [...normalizedWriteVal]
        : normalizedWriteVal;
      sigState.activeHolder = {
        fd: ocb.fd,
        role: ocb.role,
        pid: ocb.pid,
        priority: ocb.priority,
        leaseExpiresMs: currentClockMs + ocb.leaseMs,
      };
      ocb.hasStandby = false;
      justRecoveredOnSignal.delete(sigState.spec.path);

      const bucket: "P1" | "P2" | "P3" = recoveredBeforeWrite
        ? "P3"
        : hadActiveHolder
          ? "P2"
          : "P1";

      results.push({
        receipt: buildReceipt(i, "WRITE", "EOK", sigState, false),
        invariantBucket: bucket,
        applied: true,
        boundsRejected: false,
        priorityBlocked: false,
        leaseRecovered: expiredPaths.length > 0,
      });
    } else if (op.kind === "CLOSE") {
      if (op.nowMs > currentClockMs) {
        currentClockMs = op.nowMs;
      }
      const { expiredPaths } = expireLeasesUpToClock();
      const ocb = ocbs.get(op.fd);
      if (!ocb || !ocb.isOpen) {
        const assocSig = ocb ? signals.get(ocb.signalPath) : undefined;
        results.push({
          receipt: buildReceipt(i, "CLOSE", "EBADF", assocSig, false),
          invariantBucket: "P1",
          applied: false,
          boundsRejected: false,
          priorityBlocked: false,
          leaseRecovered: false,
        });
        continue;
      }

      const sigState = signals.get(ocb.signalPath)!;
      lastTouchedSignalPath = sigState.spec.path;
      ocb.isOpen = false;
      ocb.hasStandby = false;

      let recoveredOnClose = expiredPaths.length > 0;
      if (
        mode === "guarded" &&
        sigState.activeHolder !== null &&
        sigState.activeHolder.fd === ocb.fd
      ) {
        releaseAndRecoverSignal(sigState);
        recoveredOnClose = true;
      }

      results.push({
        receipt: buildReceipt(i, "CLOSE", "EOK", sigState, false),
        invariantBucket: "P3",
        applied: false,
        boundsRejected: false,
        priorityBlocked: false,
        leaseRecovered: recoveredOnClose,
      });
    } else if (op.kind === "ADVANCE_CLOCK") {
      if (op.deltaMs > 0) {
        currentClockMs += op.deltaMs;
      }
      const { expiredPaths } = expireLeasesUpToClock();
      const targetPath = expiredPaths[0] ?? lastTouchedSignalPath;
      if (targetPath.length > 0) {
        lastTouchedSignalPath = targetPath;
      }
      const sigState = signals.get(targetPath);

      results.push({
        receipt: buildReceipt(i, "ADVANCE_CLOCK", "EOK", sigState, false),
        invariantBucket: "P3",
        applied: false,
        boundsRejected: false,
        priorityBlocked: false,
        leaseRecovered: expiredPaths.length > 0,
      });
    } else {
      if (op.nowMs > currentClockMs) {
        currentClockMs = op.nowMs;
      }
      const { expiredPaths } = expireLeasesUpToClock();
      const pinfo = canonicalizeQppPath(op.path);
      if (!pinfo.ok) {
        results.push({
          receipt: buildReceipt(i, "READ_WARDEN", "EINVAL", undefined, false),
          invariantBucket: "P1",
          applied: false,
          boundsRejected: false,
          priorityBlocked: false,
          leaseRecovered: false,
        });
        continue;
      }
      const sigState = signals.get(pinfo.canonicalPath);
      if (!sigState) {
        results.push({
          receipt: buildReceipt(i, "READ_WARDEN", "ENOENT", undefined, false),
          invariantBucket: "P1",
          applied: false,
          boundsRejected: false,
          priorityBlocked: false,
          leaseRecovered: false,
        });
        continue;
      }
      lastTouchedSignalPath = sigState.spec.path;
      results.push({
        receipt: buildReceipt(i, "READ_WARDEN", "EOK", sigState, true),
        invariantBucket: expiredPaths.length > 0 ? "P3" : "P1",
        applied: false,
        boundsRejected: false,
        priorityBlocked: false,
        leaseRecovered: expiredPaths.length > 0,
      });
    }
  }

  return results;
}

function valuesEqual(a: VssSignalValue | null, b: VssSignalValue | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 1e-4;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, idx) => v === b[idx]);
  }
  return false;
}

function holdersEqual(
  a: WardenActiveHolder | null,
  b: WardenActiveHolder | null
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.fd === b.fd &&
    a.role === b.role &&
    a.pid === b.pid &&
    a.priority === b.priority &&
    a.leaseExpiresMs === b.leaseExpiresMs
  );
}

export function evaluateVssWardenOracle(
  catalogJsonc: string,
  operations: readonly WardenOperation[],
  unguardedTrace: WardenSequenceResult,
  guardedTrace: WardenSequenceResult
): WardenOracleReport {
  let specs: VssSignalSpec[];
  try {
    specs = parseCatalogSpecs(catalogJsonc);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Invalid catalog";
    return {
      allPassed: false,
      P1_VSS_BOUNDS_AND_UPSTREAM_FIX: false,
      P2_PRIORITY_ARBITRATION_PREEMPTION: false,
      P3_DEAD_OWNER_LEASE_RECOVERY: false,
      stepVerdicts: [],
      counters: {
        appliedCount: 0,
        boundsRejectedCount: 0,
        priorityBlockedCount: 0,
        leaseRecoveredCount: 0,
      },
      failures: [msg],
    };
  }

  const guardedMeta = runReferenceSimulationWithMeta(specs, operations, "guarded");
  const unguardedMeta = runReferenceSimulationWithMeta(specs, operations, "unguarded");

  const actualGuarded = guardedTrace.steps;
  const actualUnguarded = unguardedTrace.steps;

  let p1Overall = true;
  let p2Overall = true;
  let p3Overall = true;
  const failures: string[] = [];
  const stepVerdicts: WardenStepOracleVerdict[] = [];

  const counters: WardenReachabilityCounters = {
    appliedCount: 0,
    boundsRejectedCount: 0,
    priorityBlockedCount: 0,
    leaseRecoveredCount: 0,
  };

  if (actualGuarded.length !== operations.length) {
    p1Overall = false;
    failures.push(
      `Guarded step count mismatch: expected ${operations.length}, got ${actualGuarded.length}`
    );
  }

  for (let i = 0; i < operations.length; i++) {
    const gMeta = guardedMeta[i]!;
    const uMeta = unguardedMeta[i]!;
    const expectedG = gMeta.receipt;
    const expectedU = uMeta.receipt;
    const actualG = actualGuarded[i];
    const actualU = actualUnguarded[i];

    if (gMeta.applied) counters.appliedCount++;
    if (gMeta.boundsRejected) counters.boundsRejectedCount++;
    if (gMeta.priorityBlocked) counters.priorityBlockedCount++;
    if (gMeta.leaseRecovered) counters.leaseRecoveredCount++;

    let stepOk = true;
    let reason: string | null = null;

    if (!actualG) {
      stepOk = false;
      reason = `Missing guarded receipt at step ${i}`;
    } else {
      if (actualG.status !== expectedG.status) {
        stepOk = false;
        reason = `Step ${i} (${expectedG.opKind}) status mismatch: expected ${expectedG.status}, got ${actualG.status}`;
      } else if (!valuesEqual(actualG.committedControlValue, expectedG.committedControlValue)) {
        stepOk = false;
        reason = `Step ${i} (${expectedG.opKind}) committedControlValue mismatch: expected ${JSON.stringify(expectedG.committedControlValue)}, got ${JSON.stringify(actualG.committedControlValue)}`;
      } else if (actualG.committedHex !== expectedG.committedHex) {
        stepOk = false;
        reason = `Step ${i} (${expectedG.opKind}) committedHex mismatch: expected ${expectedG.committedHex}, got ${actualG.committedHex}`;
      } else if (!holdersEqual(actualG.activeHolder, expectedG.activeHolder)) {
        stepOk = false;
        reason = `Step ${i} (${expectedG.opKind}) activeHolder mismatch: expected ${JSON.stringify(expectedG.activeHolder)}, got ${JSON.stringify(actualG.activeHolder)}`;
      } else if (
        (expectedG.lastRejection?.ruleId ?? null) !== (actualG.lastRejection?.ruleId ?? null)
      ) {
        stepOk = false;
        reason = `Step ${i} (${expectedG.opKind}) lastRejection.ruleId mismatch: expected ${expectedG.lastRejection?.ruleId ?? "null"}, got ${actualG.lastRejection?.ruleId ?? "null"}`;
      }
    }

    if (stepOk && actualU) {
      if (
        actualU.status !== expectedU.status ||
        !valuesEqual(actualU.committedControlValue, expectedU.committedControlValue)
      ) {
        stepOk = false;
        reason = `Step ${i} unguarded reference mismatch: expected (${expectedU.status}, ${JSON.stringify(expectedU.committedControlValue)}), got (${actualU.status}, ${JSON.stringify(actualU.committedControlValue)})`;
      }
    }

    const p1Passed = gMeta.invariantBucket === "P1" ? stepOk : true;
    const p2Passed = gMeta.invariantBucket === "P2" ? stepOk : true;
    const p3Passed = gMeta.invariantBucket === "P3" ? stepOk : true;

    if (!p1Passed) p1Overall = false;
    if (!p2Passed) p2Overall = false;
    if (!p3Passed) p3Overall = false;
    if (reason !== null) {
      failures.push(reason);
    }

    stepVerdicts.push({
      stepIndex: i,
      opKind: operations[i]!.kind,
      expectedGuarded: expectedG,
      expectedUnguarded: expectedU,
      p1Passed,
      p2Passed,
      p3Passed,
      failureReason: reason,
    });
  }

  return {
    allPassed: p1Overall && p2Overall && p3Overall,
    P1_VSS_BOUNDS_AND_UPSTREAM_FIX: p1Overall,
    P2_PRIORITY_ARBITRATION_PREEMPTION: p2Overall,
    P3_DEAD_OWNER_LEASE_RECOVERY: p3Overall,
    stepVerdicts,
    counters,
    failures,
  };
}
