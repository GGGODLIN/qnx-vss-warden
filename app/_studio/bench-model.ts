import type {
  VssDatatype,
  VssSignalValue,
  WardenActiveHolder,
  WardenAutomotivePreset,
  WardenErrno,
  WardenOperation,
  WardenOracleReport,
  WardenStepReceipt,
  WardenVerifySuccessResponse,
} from "../../lib/types.ts";

export type InvariantCode = "P1" | "P2" | "P3";

export type InvariantKey =
  | "P1_VSS_BOUNDS_AND_UPSTREAM_FIX"
  | "P2_PRIORITY_ARBITRATION_PREEMPTION"
  | "P3_DEAD_OWNER_LEASE_RECOVERY";

export type CounterKey = keyof WardenOracleReport["counters"];

export interface InvariantSpec {
  key: InvariantKey;
  code: InvariantCode;
  name: string;
  detail: string;
  counter: CounterKey;
  counterLabel: string;
}

export interface ChannelSpec {
  key: "raw" | "guarded";
  code: string;
  title: string;
  subtitle: string;
}

export interface ScenarioNote {
  focus: InvariantCode;
  hook: string;
}

export type DivergenceKind =
  | "none"
  | "blocked"
  | "upstream-fix"
  | "recovered"
  | "carried";

export interface StepFrame {
  position: number;
  stepIndex: number;
  op: WardenOperation | null;
  raw: WardenStepReceipt;
  guarded: WardenStepReceipt;
  kind: DivergenceKind;
  invariant: InvariantCode | null;
  clockMs: number | null;
}

const EVENT_KINDS: ReadonlySet<DivergenceKind> = new Set([
  "blocked",
  "upstream-fix",
  "recovered",
]);

export function isDivergenceEvent(frame: StepFrame): boolean {
  return EVENT_KINDS.has(frame.kind);
}

function rejectionInvariant(status: WardenErrno): InvariantCode | null {
  if (status === "EBUSY") return "P2";
  if (status === "ERANGE" || status === "EINVAL") return "P1";
  return null;
}

function classifyStep(
  raw: WardenStepReceipt,
  guarded: WardenStepReceipt,
  op: WardenOperation | null,
  previous: StepFrame | null
): Pick<StepFrame, "kind" | "invariant"> {
  const differs =
    raw.committedHex !== guarded.committedHex || raw.status !== guarded.status;
  if (!differs) return { kind: "none", invariant: null };

  if (guarded.status !== "EOK") {
    return { kind: "blocked", invariant: rejectionInvariant(guarded.status) };
  }
  if (op?.kind === "CLOSE" || op?.kind === "ADVANCE_CLOCK") {
    return { kind: "recovered", invariant: "P3" };
  }

  // A read, or a step that leaves both channels exactly where the previous
  // divergence left them, did not cause the gap — it only still shows it.
  const unchangedSincePrevious =
    previous !== null &&
    previous.kind !== "none" &&
    previous.raw.committedHex === raw.committedHex &&
    previous.guarded.committedHex === guarded.committedHex &&
    previous.guarded.signalPath === guarded.signalPath;
  if (op?.kind === "READ_WARDEN" || unchangedSincePrevious) {
    return { kind: "carried", invariant: null };
  }
  return { kind: "upstream-fix", invariant: "P1" };
}

function advanceClock(
  clock: number,
  op: WardenOperation | null
): { clock: number; reading: number | null } {
  if (op === null || op.kind === "OPEN") return { clock, reading: null };
  if (op.kind === "ADVANCE_CLOCK") {
    const next = clock + op.deltaMs;
    return { clock: next, reading: next };
  }
  return { clock: Math.max(clock, op.nowMs), reading: op.nowMs };
}

export function findPreset(
  presets: readonly WardenAutomotivePreset[],
  presetId: string | undefined
): WardenAutomotivePreset | null {
  return presets.find((p) => p.id === presetId) ?? null;
}

export function buildStepFrames(
  response: WardenVerifySuccessResponse | null,
  presets: readonly WardenAutomotivePreset[]
): StepFrame[] {
  if (!response) return [];
  const operations = findPreset(presets, response.presetId)?.operations ?? [];
  const rawSteps = response.unguarded.steps;
  const guardedSteps = response.guarded.steps;
  const count = Math.min(rawSteps.length, guardedSteps.length);

  const frames: StepFrame[] = [];
  let clock = 0;
  for (let position = 0; position < count; position++) {
    const raw = rawSteps[position]!;
    const guarded = guardedSteps[position]!;
    const op = operations[guarded.stepIndex] ?? null;
    const tick = advanceClock(clock, op);
    clock = tick.clock;
    const previous = frames[position - 1] ?? null;
    frames.push({
      position,
      stepIndex: guarded.stepIndex,
      op,
      raw,
      guarded,
      clockMs: tick.reading,
      ...classifyStep(raw, guarded, op, previous),
    });
  }
  return frames;
}

export function firstEventPosition(frames: readonly StepFrame[]): number {
  return (
    frames.find(isDivergenceEvent)?.position ?? Math.max(0, frames.length - 1)
  );
}

export function clampPosition(position: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, position), count - 1);
}

export interface CursorPick {
  presetId: string;
  position: number;
}

/** A pick survives only while its scenario is on screen; otherwise park on the first divergence. */
export function resolveCursor(
  pick: CursorPick | null,
  presetId: string | null,
  frames: readonly StepFrame[]
): number {
  if (pick && pick.presetId === presetId) return clampPosition(pick.position, frames.length);
  return firstEventPosition(frames);
}

export function cursorNarrative(frame: StepFrame | null): string {
  if (!frame) return "No acquisition";
  if (isDivergenceEvent(frame)) return `Δ diverged · ${frame.invariant ?? "?"}`;
  return frame.kind === "carried" ? "Δ carried" : "channels agree";
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4)));
}

export function formatValue(value: VssSignalValue | null): string {
  if (value === null) return "—";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return `"${value}"`;
  return `[${value.map(formatNumber).join(", ")}]`;
}

export interface SourceReference {
  where: string;
  what: string;
}

/** "qpp/value.c:73 (VECTOR_UINT32 capped…)" → location + note, as written in CODELAB_STEPS. */
export function splitReference(reference: string): SourceReference {
  const open = reference.indexOf(" (");
  if (open === -1 || !reference.endsWith(")")) return { where: reference, what: "" };
  return { where: reference.slice(0, open), what: reference.slice(open + 2, -1) };
}

export function devSignalPath(path: string): string {
  return path.startsWith("/dev/signal/") ? path : `/dev/signal/${path}`;
}

export function formatHolder(holder: WardenActiveHolder | null): string {
  if (!holder) return "none";
  return `${holder.role} · P${holder.priority} · pid ${holder.pid}`;
}

export interface OpDescriptor {
  verb: string;
  operand: string;
  call: string;
  detail: string;
  axisNote: string;
}

export function describeOperation(frame: StepFrame): OpDescriptor {
  const { op } = frame;
  if (op === null) {
    return {
      verb: frame.guarded.opKind,
      operand: "",
      call: frame.guarded.opKind.toLowerCase(),
      detail: "",
      axisNote: "",
    };
  }
  switch (op.kind) {
    case "OPEN":
      return {
        verb: "OPEN",
        operand: op.role,
        call: `open("${devSignalPath(op.path)}")`,
        detail: `fd ${op.fd} · pid ${op.pid} · P${op.priority} · lease ${op.leaseMs} ms · as ${op.role}`,
        axisNote: `fd ${op.fd}`,
      };
    case "WRITE":
      return {
        verb: "WRITE",
        operand: formatValue(op.value),
        call: `write(fd ${op.fd}, ${formatValue(op.value)})`,
        detail: `t = ${op.nowMs} ms`,
        axisNote: `${op.nowMs} ms`,
      };
    case "CLOSE":
      return {
        verb: "CLOSE",
        operand: op.reason === "CRASH_DISCONNECT" ? "crash" : "close",
        call: `close(fd ${op.fd})`,
        detail: `${op.reason} → io_close_ocb · t = ${op.nowMs} ms`,
        axisNote: `${op.nowMs} ms`,
      };
    case "ADVANCE_CLOCK":
      return {
        verb: "CLOCK",
        operand: `+${op.deltaMs} ms`,
        call: `clock_advance(+${op.deltaMs} ms)`,
        detail: `CLOCK_MONOTONIC → ${frame.clockMs ?? "?"} ms`,
        axisNote: `+${op.deltaMs} ms`,
      };
    case "READ_WARDEN":
      return {
        verb: "?WARDEN",
        operand: "read",
        call: `read("${devSignalPath(op.path)}")`,
        detail: `t = ${op.nowMs} ms`,
        axisNote: `${op.nowMs} ms`,
      };
  }
}

export interface FrameVerdict {
  headline: string;
  detail: string;
  source: string | null;
}

function promotedOrDefault(holder: WardenActiveHolder | null, fallback: string): string {
  return holder ? `promoted ${holder.role} (P${holder.priority})` : fallback;
}

function explainUpstreamFix(frame: StepFrame): FrameVerdict {
  const { raw, guarded, op } = frame;
  const guardedValue = guarded.committedControlValue;
  if (raw.status !== "EOK") {
    return {
      headline: "Upstream rejected a valid write",
      detail: `Upstream QPP answered ${raw.status} for an in-contract write; the patched build commits ${formatValue(guardedValue)}.`,
      source: Array.isArray(guardedValue)
        ? "qpp/value.c:73 · VECTOR_UINT32 capped at UINT16_MAX"
        : null,
    };
  }
  const floatDefault =
    op?.kind === "OPEN" &&
    typeof guardedValue === "number" &&
    !Number.isInteger(guardedValue);
  return {
    headline: "Upstream decode bug",
    detail: `Upstream QPP stores ${formatValue(raw.committedControlValue)}; the patched build stores ${formatValue(guardedValue)}.`,
    source: floatDefault ? "qpp/value.c:438 · FLOAT default assigned json_l, not json_d" : null,
  };
}

export function explainFrame(frame: StepFrame): FrameVerdict {
  const { raw, guarded, op } = frame;
  const rawValue = formatValue(raw.committedControlValue);
  const guardedValue = formatValue(guarded.committedControlValue);
  const rejection = guarded.lastRejection;

  switch (frame.kind) {
    case "none":
      return {
        headline: "Channels agree",
        detail: `Both channels commit ${guardedValue} (${guarded.committedHex}).`,
        source: null,
      };
    case "blocked":
      if (frame.invariant === "P2") {
        return {
          headline: "Priority preemption held",
          detail: `Raw QPP committed ${rawValue} — last write wins. VssWarden answered ${guarded.status}${rejection ? ` (${rejection.ruleId})` : ""} and kept ${guardedValue} for ${formatHolder(guarded.activeHolder)}.`,
          source: "qpp/iowrite.c:78-90 · blind last-write-wins on .control",
        };
      }
      return {
        headline: "VSS bounds enforced",
        detail: `Raw QPP committed ${rawValue}. VssWarden answered ${guarded.status}${rejection ? ` (${rejection.ruleId})` : ""} and kept ${guardedValue}.`,
        source: "qpp/README.md:187-199 · min/max/allowed/arraysize unused upstream",
      };
    case "upstream-fix":
      return explainUpstreamFix(frame);
    case "recovered":
      if (op?.kind === "CLOSE") {
        return {
          headline: "Dead-owner recovery",
          detail: `${op.reason === "CRASH_DISCONNECT" ? "The holder crashed" : "The holder closed"} and io_close_ocb fired. VssWarden ${promotedOrDefault(guarded.activeHolder, "fell back to the VSS default")} → ${guardedValue}; raw QPP still holds ${rawValue}.`,
          source: "qpp/ioclose.c · no io_close_ocb rollback upstream",
        };
      }
      return {
        headline: "Lease expired",
        detail: `CLOCK_MONOTONIC passed the lease deadline. VssWarden ${promotedOrDefault(guarded.activeHolder, "rolled back to the VSS default")} → ${guardedValue}; raw QPP still holds ${rawValue}.`,
        source: "qpp/main.c:160 · no lease TTL upstream",
      };
    case "carried":
      return {
        headline: "Still diverged",
        detail: `Nothing new was written here; raw QPP still reports ${rawValue} where VssWarden reports ${guardedValue}.`,
        source: null,
      };
  }
}

/** k-th WRITE/READ_WARDEN operation ↔ k-th POSIX command, mirroring how lib/pipeline.ts emits them. */
export function posixCommandPosition(
  frames: readonly StepFrame[],
  position: number
): number | null {
  const target = frames[position];
  if (!target?.op || (target.op.kind !== "WRITE" && target.op.kind !== "READ_WARDEN")) {
    return null;
  }
  return frames
    .slice(0, position)
    .filter((f) => f.op?.kind === "WRITE" || f.op?.kind === "READ_WARDEN").length;
}

// ─── catalog datatypes, for an honest byte view ───────────────────────────────

interface CatalogNode {
  datatype?: unknown;
  children?: Record<string, CatalogNode>;
}

function collectDatatypes(
  node: CatalogNode,
  prefix: string,
  out: Map<string, VssDatatype>
): void {
  if (typeof node.datatype === "string") {
    out.set(prefix, node.datatype as VssDatatype);
  }
  for (const [name, child] of Object.entries(node.children ?? {})) {
    collectDatatypes(child, `${prefix}/${name}`, out);
  }
}

export function catalogDatatypes(catalogJsonc: string): Map<string, VssDatatype> {
  const out = new Map<string, VssDatatype>();
  try {
    const json = catalogJsonc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const root = JSON.parse(json) as Record<string, CatalogNode>;
    for (const [name, node] of Object.entries(root)) {
      collectDatatypes(node, name, out);
    }
  } catch {
    // A catalog the view cannot parse only costs the byte view its datatype label.
  }
  return out;
}

// ─── byte decoding ────────────────────────────────────────────────────────────

export interface ByteView {
  bytes: string[];
  decoded: string;
  bits: string | null;
}

function hexBytes(hex: string): string[] {
  const clean = hex.replace(/^0x/i, "");
  if (!/^[0-9a-f]*$/i.test(clean) || clean.length === 0) return [];
  const even = clean.length % 2 === 0 ? clean : `0${clean}`;
  return even.match(/../g)?.map((b) => b.toUpperCase()) ?? [];
}

function bytesToWord(bytes: readonly string[]): number {
  return Number.parseInt(bytes.join(""), 16) >>> 0;
}

function decodeFloat32(bytes: readonly string[]): string {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, bytesToWord(bytes), false);
  return formatNumber(Number(view.getFloat32(0, false).toPrecision(6)));
}

function decodeInteger(bytes: readonly string[], signed: boolean): string {
  const width = bytes.length * 8;
  const unsigned = BigInt(`0x${bytes.join("") || "0"}`);
  if (!signed) return unsigned.toString();
  return BigInt.asIntN(width, unsigned).toString();
}

function asciiOf(bytes: readonly string[]): string {
  return bytes
    .map((b) => {
      const code = Number.parseInt(b, 16);
      return code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : "·";
    })
    .join("");
}

const SIGNED_INTS: ReadonlySet<VssDatatype> = new Set(["int8", "int16", "int32", "int64"]);
const UNSIGNED_INTS: ReadonlySet<VssDatatype> = new Set(["uint8", "uint16", "uint32", "uint64"]);

export function isSignedInteger(datatype: VssDatatype | null): boolean {
  return datatype !== null && SIGNED_INTS.has(datatype);
}

export function isInteger(datatype: VssDatatype | null): boolean {
  return datatype !== null && (SIGNED_INTS.has(datatype) || UNSIGNED_INTS.has(datatype));
}

/** Positional weights of the set bits; in two's complement the MSB weighs −2^(n−1). */
export function integerFormula(bits: string, signed: boolean): string | null {
  if (bits.length === 0 || bits.length > 16) return null;
  const width = bits.length;
  const weights = [...bits].flatMap((bit, i) => {
    if (bit !== "1") return [];
    const magnitude = 2 ** (width - 1 - i);
    return [signed && i === 0 ? -magnitude : magnitude];
  });
  if (weights.length === 0) return "all bits clear = 0";
  const sum = weights.reduce((acc, w) => acc + w, 0);
  const terms = weights
    .map((w, i) => (i === 0 ? (w < 0 ? `−${-w}` : `${w}`) : w < 0 ? `− ${-w}` : `+ ${w}`))
    .join(" ");
  return `${terms} = ${sum < 0 ? `−${-sum}` : sum}`;
}

export function datatypeLabel(datatype: VssDatatype | null): string {
  if (datatype === "float") return "float · IEEE-754 binary32 · big-endian";
  if (datatype === "double") return "double · IEEE-754 binary64 · big-endian";
  if (datatype === "string") return "string · UTF-8 bytes";
  if (datatype === "uint32[]") return "uint32[] · 4-byte words · big-endian";
  if (datatype && SIGNED_INTS.has(datatype)) return `${datatype} · two's complement`;
  if (datatype) return `${datatype} · unsigned`;
  return "untyped bytes";
}

export function decodeBytes(hex: string, datatype: VssDatatype | null): ByteView {
  const bytes = hexBytes(hex);
  const showBits = bytes.length > 0 && bytes.length <= 4;
  const bits = showBits
    ? bytesToWord(bytes).toString(2).padStart(bytes.length * 8, "0")
    : null;

  if (datatype === "float" && bytes.length === 4) {
    return { bytes, decoded: decodeFloat32(bytes), bits };
  }
  if (datatype === "string") {
    return { bytes, decoded: `"${asciiOf(bytes)}"`, bits: null };
  }
  if (datatype === "uint32[]") {
    const words: string[] = [];
    for (let i = 0; i + 4 <= bytes.length; i += 4) {
      words.push(String(bytesToWord(bytes.slice(i, i + 4))));
    }
    return { bytes, decoded: `[${words.join(", ")}]`, bits: null };
  }
  if (datatype && (SIGNED_INTS.has(datatype) || UNSIGNED_INTS.has(datatype))) {
    return { bytes, decoded: decodeInteger(bytes, SIGNED_INTS.has(datatype)), bits };
  }
  return { bytes, decoded: bytes.length > 0 ? `0x${bytes.join("")}` : "—", bits };
}

export interface Float32Fields {
  sign: string;
  exponent: string;
  mantissa: string;
  formula: string;
}

export function float32Fields(bits: string): Float32Fields | null {
  if (bits.length !== 32) return null;
  const sign = bits.slice(0, 1);
  const exponent = bits.slice(1, 9);
  const mantissa = bits.slice(9);
  const biased = Number.parseInt(exponent, 2);
  const fraction = Number.parseInt(mantissa, 2) / 2 ** 23;
  const signText = sign === "1" ? "−1" : "+1";
  if (biased === 0 && fraction === 0) {
    return { sign, exponent, mantissa, formula: `exponent and mantissa all clear → ${sign === "1" ? "−0.0" : "0.0"}` };
  }
  if (biased === 255) {
    return { sign, exponent, mantissa, formula: fraction === 0 ? "exponent all set → ±Infinity" : "exponent all set → NaN" };
  }
  const significand = biased === 0 ? fraction : 1 + fraction;
  const power = biased === 0 ? -126 : biased - 127;
  const value = Number(((sign === "1" ? -1 : 1) * significand * 2 ** power).toPrecision(6));
  // The significand is a sum of powers of two; 4-decimal rounding would print 1.40625 as 1.4063.
  const exactSignificand = String(Number(significand.toFixed(8)));
  return {
    sign,
    exponent,
    mantissa,
    formula: `(${signText}) × 2^${power} × ${exactSignificand} = ${formatNumber(value)}`,
  };
}

export function datatypeAt(
  frame: StepFrame | null,
  datatypes: ReadonlyMap<string, VssDatatype>
): VssDatatype | null {
  if (!frame) return null;
  return frame.guarded.wardenPayload?.datatype ?? datatypes.get(frame.guarded.signalPath ?? "") ?? null;
}

export interface BitSpan {
  start: number;
  size: number;
}

export function groupSpans(groups: readonly number[]): BitSpan[] {
  const spans: BitSpan[] = [];
  let start = 0;
  for (const size of groups) {
    spans.push({ start, size });
    start += size;
  }
  return spans;
}

function wordFormula(bits: string, datatype: VssDatatype | null, isFloat: boolean): string | null {
  if (isFloat) return float32Fields(bits)?.formula ?? null;
  return isInteger(datatype) ? integerFormula(bits, isSignedInteger(datatype)) : null;
}

export interface MemoryBits {
  raw: string;
  guarded: string;
  groups: number[];
  legend: string[];
  rawFormula: string | null;
  guardedFormula: string | null;
}

export interface MemoryView {
  raw: ByteView;
  guarded: ByteView;
  differs: boolean;
  bits: MemoryBits | null;
}

export function buildMemoryView(frame: StepFrame, datatype: VssDatatype | null): MemoryView {
  const raw = decodeBytes(frame.raw.committedHex, datatype);
  const guarded = decodeBytes(frame.guarded.committedHex, datatype);
  const differs = raw.bytes.join("") !== guarded.bytes.join("");
  // A bit-for-bit comparison only means something when both words are the same width.
  if (raw.bits === null || guarded.bits === null || raw.bits.length !== guarded.bits.length) {
    return { raw, guarded, differs, bits: null };
  }
  const isFloat = datatype === "float" && raw.bits.length === 32;
  const signed = isSignedInteger(datatype);
  return {
    raw,
    guarded,
    differs,
    bits: {
      raw: raw.bits,
      guarded: guarded.bits,
      groups: isFloat ? [1, 8, 23] : [raw.bits.length],
      legend: isFloat
        ? ["sign", "exponent · 8", "mantissa · 23"]
        : [`${raw.bits.length}-bit word · MSB first${signed ? " · MSB weighs negative" : ""}`],
      rawFormula: wordFormula(raw.bits, datatype, isFloat),
      guardedFormula: wordFormula(guarded.bits, datatype, isFloat),
    },
  };
}

// ─── JSON tokens for the receipt view (rendered as text nodes, never as HTML) ──

export type JsonTokenKind = "key" | "string" | "number" | "literal" | "punct";

export interface JsonToken {
  start: number;
  text: string;
  kind: JsonTokenKind;
}

const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      tokens.push({ start: cursor, text: text.slice(cursor, start), kind: "punct" });
    }
    const [whole, str, colon, num, literal] = match;
    if (str !== undefined) {
      tokens.push({ start, text: str, kind: colon ? "key" : "string" });
      if (colon) {
        tokens.push({ start: start + str.length, text: colon, kind: "punct" });
      }
    } else if (num !== undefined) {
      tokens.push({ start, text: num, kind: "number" });
    } else if (literal !== undefined) {
      tokens.push({ start, text: literal, kind: "literal" });
    }
    cursor = start + whole.length;
  }
  if (cursor < text.length) {
    tokens.push({ start: cursor, text: text.slice(cursor), kind: "punct" });
  }
  return tokens;
}
