export type WardenMode = "unguarded" | "guarded";

export type WardenErrno =
  | "EOK"
  | "ERANGE"
  | "EINVAL"
  | "EBUSY"
  | "EBADF"
  | "ENOENT";

export type WardenRuleId =
  | "VSS_MIN_MAX"
  | "VSS_ALLOWED_ENUM"
  | "VSS_ARRAY_SIZE"
  | "PRIORITY_PREEMPTED";

export type WardenTargetKind = "VALUE" | "CONTROL" | "WARDEN";

export type VssDatatype =
  | "int8"
  | "int16"
  | "int32"
  | "int64"
  | "uint8"
  | "uint16"
  | "uint32"
  | "uint64"
  | "float"
  | "double"
  | "string"
  | "uint32[]";

export type VssNodeType = "actuator" | "branch";

export type VssPrimitiveValue = number | string;
export type VssSignalValue = VssPrimitiveValue | number[];

export interface VssSignalSpec {
  path: string;
  datatype: VssDatatype;
  type: VssNodeType;
  default: VssSignalValue;
  min?: number;
  max?: number;
  allowed?: Array<string | number>;
  arraysize?: number;
}

export interface VssCatalogNodeInput {
  datatype?: VssDatatype;
  type?: VssNodeType;
  default?: VssSignalValue;
  min?: number;
  max?: number;
  allowed?: Array<string | number>;
  arraysize?: number;
  children?: Record<string, VssCatalogNodeInput>;
}

export type WardenOperation =
  | {
      kind: "OPEN";
      fd: number;
      path: string;
      pid: number;
      priority: number;
      leaseMs: number;
      role: string;
    }
  | {
      kind: "WRITE";
      fd: number;
      value: VssSignalValue;
      nowMs: number;
    }
  | {
      kind: "CLOSE";
      fd: number;
      reason: "NORMAL_CLOSE" | "CRASH_DISCONNECT";
      nowMs: number;
    }
  | {
      kind: "ADVANCE_CLOCK";
      deltaMs: number;
    }
  | {
      kind: "READ_WARDEN";
      path: string;
      nowMs: number;
    };

export interface WardenActiveHolder {
  fd: number;
  role: string;
  pid: number;
  priority: number;
  leaseExpiresMs: number | null;
}

export interface WardenRejectionInfo {
  errnoCode: WardenErrno;
  ruleId: WardenRuleId;
  reason: string;
}

export interface WardenDiagnosticPayload {
  path: string;
  datatype: VssDatatype;
  committedControlValue: VssSignalValue | null;
  activeHolder: WardenActiveHolder | null;
  lastRejection: WardenRejectionInfo | null;
}

export interface WardenStepReceipt {
  stepIndex: number;
  opKind: WardenOperation["kind"];
  status: WardenErrno;
  signalPath?: string;
  committedControlValue: VssSignalValue | null;
  committedHex: string;
  activeHolder: WardenActiveHolder | null;
  lastRejection: WardenRejectionInfo | null;
  wardenPayload?: WardenDiagnosticPayload | null;
}

export interface WardenSequenceResult {
  ok: boolean;
  status: WardenErrno;
  mode: WardenMode;
  errorMessage: string | null;
  steps: WardenStepReceipt[];
}

export interface WardenStepOracleVerdict {
  stepIndex: number;
  opKind: WardenOperation["kind"];
  expectedGuarded: WardenStepReceipt;
  expectedUnguarded: WardenStepReceipt;
  p1Passed: boolean;
  p2Passed: boolean;
  p3Passed: boolean;
  failureReason: string | null;
}

export interface WardenReachabilityCounters {
  appliedCount: number;
  boundsRejectedCount: number;
  priorityBlockedCount: number;
  leaseRecoveredCount: number;
}

export interface WardenOracleReport {
  allPassed: boolean;
  P1_VSS_BOUNDS_AND_UPSTREAM_FIX: boolean;
  P2_PRIORITY_ARBITRATION_PREEMPTION: boolean;
  P3_DEAD_OWNER_LEASE_RECOVERY: boolean;
  stepVerdicts: WardenStepOracleVerdict[];
  counters: WardenReachabilityCounters;
  failures: string[];
}

export interface WardenAutomotivePreset {
  id: string;
  title: string;
  description: string;
  catalogJsonc: string;
  operations: WardenOperation[];
}

export type WardenVerifyErrorCode =
  | "INVALID_PAYLOAD"
  | "PAYLOAD_TOO_LARGE"
  | "ENGINE_EXECUTION_ERROR";

export interface WardenVerifyDiagnostics {
  timedOut?: boolean;
  detail: string;
}

export interface WardenVerifySuccessResponse {
  ok: true;
  statusCode: 200;
  presetId: string;
  seed: number;
  requestId?: number;
  unguarded: WardenSequenceResult;
  guarded: WardenSequenceResult;
  oracle: WardenOracleReport;
  posixCommands: string[];
  cliReplayCommand: string;
  runtimeEngine: "c11-wasi" | "native-c11";
}

export interface WardenVerifyErrorResponse {
  ok: false;
  statusCode: 400 | 500;
  errorCode: WardenVerifyErrorCode;
  errorMessage: string;
  requestId?: number;
  diagnostics?: WardenVerifyDiagnostics;
}

export type WardenVerifyResponse =
  | WardenVerifySuccessResponse
  | WardenVerifyErrorResponse;

export interface QppPatchVerificationReport {
  ok: boolean;
  patchPath: string;
  patchedFiles: string[];
  verifiedFixes: {
    vectorUint32Fixed: boolean;
    floatDefaultFixed: boolean;
    doubleDefaultFixed: boolean;
    metadataNonStringFixed: boolean;
    wardenHooksWired: boolean;
  };
  output: string;
}

