"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { AUTOMOTIVE_PRESETS } from "../../lib/presets.ts";
import {
  buildTimelineChartModel,
  createInitialStudioState,
  type StudioAction,
  type StudioState,
  studioReducer,
  type TimelineChartModel,
} from "../../lib/studio-model.ts";
import type {
  VssDatatype,
  WardenAutomotivePreset,
  WardenOracleReport,
  WardenStepOracleVerdict,
  WardenStepReceipt,
  WardenVerifyResponse,
  WardenVerifySuccessResponse,
} from "../../lib/types.ts";
import {
  buildStepFrames,
  catalogDatatypes,
  type ChannelSpec,
  clampPosition,
  type CursorPick,
  cursorNarrative,
  datatypeAt,
  describeOperation,
  findPreset,
  type InvariantCode,
  type InvariantSpec,
  pad2,
  posixCommandPosition,
  resolveCursor,
  type ScenarioNote,
  type StepFrame,
} from "./bench-model.ts";
import { ByteInspector, ReplayConsole, StepDossier, WardenReceipt } from "./inspectors.tsx";
import { ScopeScreen } from "./scope.tsx";
import { useCopy } from "./use-copy.ts";

const EMPTY_STEPS: readonly WardenStepReceipt[] = [];
const EMPTY_VERDICTS: readonly WardenStepOracleVerdict[] = [];
const INVARIANT_CODES: readonly InvariantCode[] = ["P1", "P2", "P3"];
const VERDICT_FIELD: Record<InvariantCode, "p1Passed" | "p2Passed" | "p3Passed"> = {
  P1: "p1Passed",
  P2: "p2Passed",
  P3: "p3Passed",
};

function uniqueRoles(preset: WardenAutomotivePreset): string[] {
  const roles = preset.operations.flatMap((op) => (op.kind === "OPEN" ? [`${op.role} · P${op.priority}`] : []));
  return [...new Set(roles)];
}

interface ScenarioDeckProps {
  selectedId: string;
  loadedId: string | null;
  isLoading: boolean;
  notes: Readonly<Record<string, ScenarioNote>>;
  onPick: (preset: WardenAutomotivePreset) => void;
}

function ScenarioDeck({ selectedId, loadedId, isLoading, notes, onPick }: ScenarioDeckProps): ReactNode {
  return (
    <div className="deck" role="group" aria-label="Scenarios">
      {AUTOMOTIVE_PRESETS.map((preset, order) => {
        const note = notes[preset.id];
        const selected = preset.id === selectedId;
        const status = selected ? (isLoading ? "arming" : loadedId === preset.id ? "loaded" : "selected") : "standby";
        const roles = uniqueRoles(preset);
        return (
          <button
            key={preset.id}
            type="button"
            className="cartridge"
            data-status={status}
            aria-pressed={selected}
            onClick={() => onPick(preset)}
          >
            <span className="cartridge-top">
              <span className="cartridge-led" aria-hidden="true" />
              <span className="cartridge-index">{`SCN-${pad2(order + 1)}`}</span>
              {note ? <span className="cartridge-focus">{note.focus}</span> : null}
            </span>
            <span className="cartridge-title">{preset.title}</span>
            <span className="cartridge-hook">{note?.hook ?? preset.description}</span>
            <span className="cartridge-foot">
              <span className="cartridge-roles">
                {roles.slice(0, 2).join("  ")}
                {roles.length > 2 ? `  +${roles.length - 2}` : ""}
              </span>
              <span className="cartridge-ops">{`${preset.operations.length} ops`}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

type EnginePhase = "idle" | "ready" | "verifying" | "fault";

const PHASE_LABEL: Record<EnginePhase, string> = {
  idle: "Standby",
  ready: "Ready",
  verifying: "Verifying",
  fault: "Fault",
};

function enginePhase(state: StudioState): EnginePhase {
  if (state.isLoading) return "verifying";
  if (state.errorBanner) return "fault";
  return state.lastResponse ? "ready" : "idle";
}

function EngineBlock({ state, onRun }: { state: StudioState; onRun: () => void }): ReactNode {
  const phase = enginePhase(state);
  return (
    <div className="engine" data-phase={phase}>
      <p className="engine-status">
        <span className="caps">C11 engine</span>
        <span className="engine-led" aria-hidden="true" />
        <span className="engine-phase">{PHASE_LABEL[phase]}</span>
      </p>
      <dl className="engine-regs">
        <div>
          <dt>Request</dt>
          <dd>{`#${String(state.activeRequestId).padStart(4, "0")}`}</dd>
        </div>
        <div>
          <dt>Seed</dt>
          <dd>{state.seed}</dd>
        </div>
      </dl>
      <button type="button" className="run-button" onClick={onRun}>
        <span className="run-glyph" aria-hidden="true" />
        {state.isLoading ? `Verifying #${state.activeRequestId}` : "Run verification"}
      </button>
      {state.errorBanner ? (
        <p role="alert" className="engine-fault">
          {`req #${state.activeRequestId} · ${state.errorBanner}`}
        </p>
      ) : null}
    </div>
  );
}

interface AnnunciatorProps {
  invariants: readonly InvariantSpec[];
  oracle: WardenOracleReport | null;
  focus: InvariantCode | null;
}

function Annunciator({ invariants, oracle, focus }: AnnunciatorProps): ReactNode {
  const total = oracle?.stepVerdicts.length ?? 0;
  return (
    <ul className="annunciator" aria-label="Safety invariants">
      {invariants.map((spec) => {
        const state = oracle ? (oracle[spec.key] ? "pass" : "fail") : "idle";
        const held = oracle ? oracle.stepVerdicts.filter((v) => v[VERDICT_FIELD[spec.code]]).length : 0;
        const count = oracle?.counters[spec.counter];
        return (
          <li key={spec.key} className="lamp-tile" data-state={state} data-focus={focus === spec.code}>
            <span className="lamp" aria-hidden="true" />
            <span className="lamp-text">
              <span className="lamp-name">
                <span className="lamp-short">{spec.code}</span>
                {spec.name}
              </span>
              <span className="lamp-key">{spec.key}</span>
              <span className="lamp-detail">{spec.detail}</span>
            </span>
            <span className="lamp-reg">
              <span className="lamp-count">{count === undefined ? "--" : pad2(count)}</span>
              <span className="lamp-count-label">{spec.counterLabel}</span>
              <span className="lamp-state">
                {state === "pass" ? `held ${held}/${total}` : state === "fail" ? "violated" : "standby"}
              </span>
            </span>
          </li>
        );
      })}
      <li className="oracle-tile" data-state={oracle ? (oracle.allPassed ? "pass" : "fail") : "idle"}>
        <span className="caps">Independent oracle</span>
        <span className="oracle-verdict">{oracle ? (oracle.allPassed ? "All pass" : "Failing") : "Awaiting run"}</span>
        <span className="oracle-meta">
          {oracle ? `${total * 3} step checks · ${oracle.failures.length} failures` : "TypeScript state machine"}
        </span>
      </li>
    </ul>
  );
}

interface StepCellProps {
  frame: StepFrame;
  selected: boolean;
  verdict: WardenStepOracleVerdict | undefined;
  register: (position: number, el: HTMLButtonElement | null) => void;
  onSelect: (position: number) => void;
}

function StepCell({ frame, selected, verdict, register, onSelect }: StepCellProps): ReactNode {
  const op = describeOperation(frame);
  const flag = frame.invariant ?? (frame.kind === "carried" ? "Δ" : "");
  return (
    <button
      type="button"
      ref={(el) => register(frame.position, el)}
      className="step-cell"
      data-kind={frame.kind}
      aria-pressed={selected}
      tabIndex={selected ? 0 : -1}
      aria-label={`Step ${frame.stepIndex}: ${op.verb} ${op.operand}. Raw ${frame.raw.status}, guarded ${frame.guarded.status}${flag ? `, divergence ${flag}` : ""}`}
      onClick={() => onSelect(frame.position)}
    >
      <span className="cell-top">
        <span className="cell-index">{`#${pad2(frame.stepIndex)}`}</span>
        {flag ? <span className="cell-flag">{flag}</span> : null}
      </span>
      <span className="cell-verb">{op.verb}</span>
      <span className="cell-operand" title={op.operand}>
        {op.operand || "—"}
      </span>
      <span className="cell-foot">
        <span className="cell-leds" aria-hidden="true">
          <span className="cell-led" data-ch="raw" data-ok={frame.raw.status === "EOK"} />
          <span className="cell-led" data-ch="guarded" data-ok={frame.guarded.status === "EOK"} />
        </span>
        <span className="cell-pips" aria-hidden="true">
          {INVARIANT_CODES.map((code) => (
            <span key={code} className="cell-pip" data-ok={verdict ? verdict[VERDICT_FIELD[code]] : undefined} />
          ))}
        </span>
      </span>
    </button>
  );
}

interface StepScrubberProps {
  frames: readonly StepFrame[];
  cursor: number;
  verdicts: readonly WardenStepOracleVerdict[];
  onSelect: (position: number) => void;
}

function StepScrubber({ frames, cursor, verdicts, onSelect }: StepScrubberProps): ReactNode {
  const cells = useRef(new Map<number, HTMLButtonElement>());
  const register = useCallback((position: number, el: HTMLButtonElement | null) => {
    if (el) cells.current.set(position, el);
    else cells.current.delete(position);
  }, []);
  const verdictByStep = useMemo(() => new Map(verdicts.map((v) => [v.stepIndex, v])), [verdicts]);

  function move(target: number): void {
    const next = clampPosition(target, frames.length);
    onSelect(next);
    cells.current.get(next)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const moves: Record<string, number> = {
      ArrowRight: cursor + 1,
      ArrowDown: cursor + 1,
      ArrowLeft: cursor - 1,
      ArrowUp: cursor - 1,
      Home: 0,
      End: frames.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    move(target);
  }

  const cursorFrame = frames[cursor] ?? null;
  return (
    <div className="scrubber">
      <div className="scrubber-head">
        <span className="caps">Step scrubber</span>
        <span className="scrubber-state" data-kind={cursorFrame?.kind ?? "none"}>
          {cursorNarrative(cursorFrame)}
        </span>
        <span className="scrubber-hint">← → scrub · click any column on either screen</span>
        <span className="scrubber-nav">
          <button type="button" aria-label="Previous step" disabled={cursor <= 0} onClick={() => move(cursor - 1)}>
            ‹
          </button>
          <span className="scrubber-count">{frames.length ? `${pad2(cursor + 1)} / ${pad2(frames.length)}` : "-- / --"}</span>
          <button
            type="button"
            aria-label="Next step"
            disabled={cursor >= frames.length - 1}
            onClick={() => move(cursor + 1)}
          >
            ›
          </button>
        </span>
      </div>
      <div
        className="scrubber-track"
        role="toolbar"
        aria-label="Engine steps"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        style={{ "--steps": Math.max(frames.length, 1) } as CSSProperties}
      >
        {frames.map((frame) => (
          <StepCell
            key={`cell-${frame.stepIndex}`}
            frame={frame}
            selected={frame.position === cursor}
            verdict={verdictByStep.get(frame.stepIndex)}
            register={register}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function Legend(): ReactNode {
  return (
    <ul className="legend" aria-label="Legend">
      <li>
        <span className="legend-trace is-raw" aria-hidden="true" />
        upstream QPP
      </li>
      <li>
        <span className="legend-trace is-guarded" aria-hidden="true" />
        VssWarden
      </li>
      <li>
        <span className="legend-ring" aria-hidden="true" />
        raw diverges
      </li>
      <li>
        <span className="legend-clamp" aria-hidden="true" />
        warden rejects
      </li>
    </ul>
  );
}

function verifyError(requestId: number, errorMessage: string, errorCode = "ENGINE_EXECUTION_ERROR"): StudioAction {
  return { type: "VERIFY_ERROR", requestId, errorCode, errorMessage };
}

async function readFailure(res: Response, requestId: number): Promise<StudioAction> {
  // The route answers 400/500 with a JSON error envelope; surface its message when it parses.
  const body = (await res.json().catch(() => null)) as WardenVerifyResponse | null;
  if (body && !body.ok) return verifyError(requestId, body.errorMessage, body.errorCode);
  return verifyError(requestId, `Unexpected HTTP status ${res.status}`);
}

async function requestVerification(
  preset: WardenAutomotivePreset,
  requestId: number,
  seed: number
): Promise<StudioAction> {
  try {
    const res = await fetch("/api/vss-warden/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        presetId: preset.id,
        seed,
        requestId,
        catalogJsonc: preset.catalogJsonc,
        operations: preset.operations,
      }),
    });
    if (!res.ok) return await readFailure(res, requestId);
    const data = (await res.json()) as WardenVerifyResponse;
    return data.ok
      ? { type: "VERIFY_SUCCESS", requestId, response: data }
      : verifyError(requestId, data.errorMessage, data.errorCode);
  } catch (err: unknown) {
    return verifyError(
      requestId,
      err instanceof Error ? err.message : "Network error while invoking /api/vss-warden/verify"
    );
  }
}

interface Verification {
  state: StudioState;
  selectedPreset: WardenAutomotivePreset;
  pick: (preset: WardenAutomotivePreset) => void;
  run: () => void;
}

function useVerification(initialResponse: WardenVerifySuccessResponse | null): Verification {
  const [state, dispatch] = useReducer(studioReducer, initialResponse, createInitialStudioState);
  const selectedPreset = findPreset(AUTOMOTIVE_PRESETS, state.selectedPresetId) ?? AUTOMOTIVE_PRESETS[0]!;

  function launch(preset: WardenAutomotivePreset, action: StudioAction): void {
    dispatch(action);
    // The reducer has just moved activeRequestId to this id, so any answer
    // still in flight for an older id is dropped by studioReducer.
    void requestVerification(preset, state.activeRequestId + 1, state.seed).then(dispatch);
  }

  return {
    state,
    selectedPreset,
    pick: (preset) => launch(preset, { type: "SELECT_PRESET", presetId: preset.id, seed: state.seed }),
    run: () => launch(selectedPreset, { type: "START_VERIFY", presetId: selectedPreset.id, seed: state.seed }),
  };
}

interface BenchModel {
  chart: TimelineChartModel;
  frames: StepFrame[];
  datatypes: ReadonlyMap<string, VssDatatype>;
  loadedId: string | null;
  oracle: WardenOracleReport | null;
  verdicts: readonly WardenStepOracleVerdict[];
  posixCommands: readonly string[];
  cliReplayCommand: string | null;
}

function deriveBench(response: WardenVerifySuccessResponse | null): BenchModel {
  if (!response) {
    return {
      chart: buildTimelineChartModel(EMPTY_STEPS, EMPTY_STEPS),
      frames: [],
      datatypes: new Map(),
      loadedId: null,
      oracle: null,
      verdicts: EMPTY_VERDICTS,
      posixCommands: [],
      cliReplayCommand: null,
    };
  }
  return {
    chart: buildTimelineChartModel(response.unguarded.steps, response.guarded.steps),
    frames: buildStepFrames(response, AUTOMOTIVE_PRESETS),
    datatypes: catalogDatatypes(findPreset(AUTOMOTIVE_PRESETS, response.presetId)?.catalogJsonc ?? ""),
    loadedId: response.presetId,
    oracle: response.oracle,
    verdicts: response.oracle.stepVerdicts,
    posixCommands: response.posixCommands,
    cliReplayCommand: response.cliReplayCommand,
  };
}

export interface ArbitrationBenchProps {
  initialResponse: WardenVerifySuccessResponse | null;
  channels: { raw: ChannelSpec; guarded: ChannelSpec };
  invariants: readonly InvariantSpec[];
  scenarioNotes: Readonly<Record<string, ScenarioNote>>;
}

export function ArbitrationBench({ initialResponse, channels, invariants, scenarioNotes }: ArbitrationBenchProps): ReactNode {
  const { state, selectedPreset, pick, run } = useVerification(initialResponse);
  const [cursorPick, setCursorPick] = useState<CursorPick | null>(null);
  const copier = useCopy();

  const bench = useMemo(() => deriveBench(state.lastResponse), [state.lastResponse]);
  const { chart, frames, loadedId } = bench;
  const cursor = resolveCursor(cursorPick, loadedId, frames);
  const cursorFrame = frames[cursor] ?? null;
  const cliReplayCommand =
    bench.cliReplayCommand ?? `./build/vss-warden-cli --preset ${selectedPreset.id} --seed ${state.seed}`;

  function handlePick(preset: WardenAutomotivePreset): void {
    setCursorPick(null);
    pick(preset);
  }

  const selectStep = useCallback(
    (position: number) => {
      if (loadedId) setCursorPick({ presetId: loadedId, position });
    },
    [loadedId]
  );

  return (
    <div className="studio">
      <section className="bench" aria-labelledby="bench-title">
        <header className="bench-head">
          <div className="bench-id">
            <h2 id="bench-title" className="bench-title">
              Arbitration bench
            </h2>
            <p className="bench-sub">Two channels · one operation sequence · upstream QPP vs patched QPP</p>
          </div>
          <Legend />
        </header>
        <div className="bench-controls">
          <ScenarioDeck
            selectedId={state.selectedPresetId}
            loadedId={loadedId}
            isLoading={state.isLoading}
            notes={scenarioNotes}
            onPick={handlePick}
          />
          <EngineBlock state={state} onRun={run} />
        </div>
        <div className="bench-scopes">
          <ScopeScreen
            channel={channels.raw}
            frames={frames}
            points={chart.unguardedPoints}
            valueMin={chart.valueMin}
            valueMax={chart.valueMax}
            cursor={cursor}
            isLoading={state.isLoading}
            onSelect={selectStep}
          />
          <ScopeScreen
            channel={channels.guarded}
            frames={frames}
            points={chart.guardedPoints}
            valueMin={chart.valueMin}
            valueMax={chart.valueMax}
            cursor={cursor}
            isLoading={state.isLoading}
            onSelect={selectStep}
          />
        </div>
        <StepScrubber
          frames={frames}
          cursor={cursor}
          verdicts={bench.verdicts}
          onSelect={selectStep}
        />
        <Annunciator invariants={invariants} oracle={bench.oracle} focus={cursorFrame?.invariant ?? null} />
      </section>
      <div className="readouts">
        <StepDossier frame={cursorFrame} total={frames.length} channels={channels} />
        <ByteInspector frame={cursorFrame} datatype={datatypeAt(cursorFrame, bench.datatypes)} channels={channels} />
        <WardenReceipt frame={cursorFrame} frames={frames} onJump={selectStep} />
      </div>
      <ReplayConsole
        cliReplayCommand={cliReplayCommand}
        posixCommands={bench.posixCommands}
        activeCommand={posixCommandPosition(frames, cursor)}
        copier={copier}
      />
    </div>
  );
}
