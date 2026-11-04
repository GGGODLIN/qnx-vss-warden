"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useReducer } from "react";
import { AUTOMOTIVE_PRESETS } from "../lib/presets.ts";
import {
  buildTimelineChartModel,
  createInitialStudioState,
  studioReducer,
  type TimelinePoint,
} from "../lib/studio-model.ts";
import type {
  WardenAutomotivePreset,
  WardenStepReceipt,
  WardenVerifyResponse,
} from "../lib/types.ts";

interface InvariantBadgeProps {
  code: string;
  label: string;
  passed: boolean;
}

function InvariantBadge({
  code,
  label,
  passed,
}: InvariantBadgeProps): ReactNode {
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs font-mono ${
        passed
          ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
          : "border-rose-500/40 bg-rose-950/40 text-rose-200"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{code}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
            passed
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-rose-500/20 text-rose-300"
          }`}
        >
          {passed ? "PASS" : "FAIL"}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-300">{label}</p>
    </div>
  );
}

interface TimelinePanelProps {
  title: string;
  subtitle: string;
  accentColor: string;
  viewBoxWidth: number;
  viewBoxHeight: number;
  polyline: string;
  points: readonly TimelinePoint[];
  steps: readonly WardenStepReceipt[];
}

function TimelinePanel({
  title,
  subtitle,
  accentColor,
  viewBoxWidth,
  viewBoxHeight,
  polyline,
  points,
  steps,
}: TimelinePanelProps): ReactNode {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-100">{title}</h2>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
        <span className="rounded bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300">
          {steps.length} steps
        </span>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-slate-800/80 bg-slate-950 p-2">
        <svg
          viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
          className="h-48 w-full"
          role="img"
          aria-label={`${title} actuator state timeline`}
        >
          <line
            x1={48}
            y1={24}
            x2={616}
            y2={24}
            stroke="#1e293b"
            strokeDasharray="4 4"
          />
          <line
            x1={48}
            y1={104}
            x2={616}
            y2={104}
            stroke="#1e293b"
            strokeDasharray="4 4"
          />
          <line
            x1={48}
            y1={184}
            x2={616}
            y2={184}
            stroke="#334155"
          />
          {polyline.length > 0 ? (
            <polyline
              fill="none"
              stroke={accentColor}
              strokeWidth={2.5}
              points={polyline}
            />
          ) : null}
          {points.map((pt) => (
            <g key={`${title}-pt-${pt.stepIndex}`}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={pt.status === "EOK" ? 4.5 : 5.5}
                fill={pt.status === "EOK" ? accentColor : "#f43f5e"}
              />
              <title>
                {`Step #${pt.stepIndex} (${pt.opKind}) | ${pt.fullSignalPath} | status=${pt.status} | val=${JSON.stringify(
                  pt.rawCommittedValue
                )} (${pt.committedHex})`}
              </title>
              <text
                x={pt.x}
                y={Math.max(14, pt.y - 8)}
                textAnchor="middle"
                className="fill-slate-300 font-mono text-[9px]"
              >
                {`#${pt.stepIndex}:${pt.status}`}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-3 space-y-2">
        {steps.map((step, idx) => {
          const point = points[idx];
          const displayPath =
            point?.displaySignalPath ?? step.signalPath ?? "Vehicle/Signal";
          const fullPath =
            point?.fullSignalPath ?? step.signalPath ?? "Vehicle/Signal";

          return (
            <div
              key={`${title}-step-${step.stepIndex}`}
              className="rounded border border-slate-800/90 bg-slate-950/70 px-3 py-2 font-mono text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                    #{step.stepIndex} {step.opKind}
                  </span>
                  <span className="text-slate-300" title={fullPath}>
                    {displayPath}
                  </span>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    step.status === "EOK"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-rose-500/20 text-rose-300"
                  }`}
                >
                  {step.status}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <span>
                  committed:{" "}
                  <strong className="text-slate-200">
                    {JSON.stringify(step.committedControlValue)}
                  </strong>{" "}
                  ({step.committedHex})
                </span>
                {step.activeHolder ? (
                  <span className="text-cyan-300">
                    holder: {step.activeHolder.role} (P
                    {step.activeHolder.priority}, pid={step.activeHolder.pid},
                    ttl={step.activeHolder.leaseExpiresMs ?? "none"}ms)
                  </span>
                ) : (
                  <span>holder: none</span>
                )}
              </div>
              {step.lastRejection ? (
                <div className="mt-1 rounded bg-rose-950/50 px-2 py-1 text-[11px] text-rose-300">
                  rejected [{step.lastRejection.errnoCode} /{" "}
                  {step.lastRejection.ruleId}]: {step.lastRejection.reason}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const EMPTY_STEPS: readonly WardenStepReceipt[] = [];

export default function StudioPage(): ReactNode {
  const [state, dispatch] = useReducer(
    studioReducer,
    null,
    createInitialStudioState
  );

  const selectedPreset: WardenAutomotivePreset = useMemo(
    () =>
      AUTOMOTIVE_PRESETS.find((p) => p.id === state.selectedPresetId) ??
      AUTOMOTIVE_PRESETS[0]!,
    [state.selectedPresetId]
  );

  const unguardedSteps = state.lastResponse?.unguarded.steps ?? EMPTY_STEPS;
  const guardedSteps = state.lastResponse?.guarded.steps ?? EMPTY_STEPS;

  const chartModel = useMemo(
    () => buildTimelineChartModel(unguardedSteps, guardedSteps),
    [unguardedSteps, guardedSteps]
  );

  const latestWardenPayload = useMemo(() => {
    for (let i = guardedSteps.length - 1; i >= 0; i--) {
      const step = guardedSteps[i];
      if (step?.wardenPayload) {
        return step.wardenPayload;
      }
    }
    const lastStep = guardedSteps[guardedSteps.length - 1];
    return {
      path: lastStep?.signalPath ?? "Vehicle/Body/Mirrors/Left/Pan",
      datatype: "int8",
      committedControlValue: lastStep?.committedControlValue ?? null,
      activeHolder: lastStep?.activeHolder ?? null,
      lastRejection: lastStep?.lastRejection ?? null,
    };
  }, [guardedSteps]);

  const cliReplayCommand =
    state.lastResponse?.cliReplayCommand ??
    `./build/vss-warden-cli --preset ${selectedPreset.id} --seed ${state.seed}`;

  async function triggerLiveVerification(
    preset: WardenAutomotivePreset,
    nextRequestId: number,
    seed: number
  ): Promise<void> {
    try {
      const res = await fetch("/api/vss-warden/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          presetId: preset.id,
          seed,
          requestId: nextRequestId,
          catalogJsonc: preset.catalogJsonc,
          operations: preset.operations,
        }),
      });
      const data = (await res.json()) as WardenVerifyResponse;
      if (res.ok && data.ok) {
        dispatch({
          type: "VERIFY_SUCCESS",
          requestId: nextRequestId,
          response: data,
        });
      } else if (!data.ok) {
        dispatch({
          type: "VERIFY_ERROR",
          requestId: nextRequestId,
          errorCode: data.errorCode,
          errorMessage: data.errorMessage,
        });
      } else {
        dispatch({
          type: "VERIFY_ERROR",
          requestId: nextRequestId,
          errorCode: "ENGINE_EXECUTION_ERROR",
          errorMessage: `Unexpected HTTP status ${res.status}`,
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Network error while invoking /api/vss-warden/verify";
      dispatch({
        type: "VERIFY_ERROR",
        requestId: nextRequestId,
        errorCode: "ENGINE_EXECUTION_ERROR",
        errorMessage: message,
      });
    }
  }

  function handlePresetClick(preset: WardenAutomotivePreset): void {
    const nextRequestId = state.activeRequestId + 1;
    dispatch({
      type: "SELECT_PRESET",
      presetId: preset.id,
      seed: state.seed,
    });
    void triggerLiveVerification(preset, nextRequestId, state.seed);
  }

  function handleReverifyClick(): void {
    const nextRequestId = state.activeRequestId + 1;
    dispatch({
      type: "START_VERIFY",
      presetId: selectedPreset.id,
      seed: state.seed,
    });
    void triggerLiveVerification(selectedPreset, nextRequestId, state.seed);
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-cyan-500/20 px-2 py-0.5 font-mono text-xs font-semibold text-cyan-300">
                QNX 8.0 QPP + COVESA VSS v3
              </span>
              <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
                Zero-Key C11 Engine
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              VssWarden — Side-by-Side SDV Verification Studio
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Pre-compiled COVESA VSS bounds gatekeeper, mixed-criticality{" "}
              <code className="text-slate-200">.control</code> priority-lease
              arbiter, and Shape 1 property-based verification oracle for{" "}
              <code className="text-slate-200">
                qnx/qnx-posix-publish-subscribe
              </code>
              .
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/codelab"
              className="rounded-lg border border-cyan-500/50 bg-cyan-950/50 px-4 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-900/60"
            >
              Open Interactive QNX 8.0 Codelab &rarr;
            </Link>
            <button
              type="button"
              onClick={handleReverifyClick}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              {state.isLoading
                ? `Verifying (#${state.activeRequestId})...`
                : "Run C11 Engine Verification"}
            </button>
          </div>
        </header>

        {state.errorBanner ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-rose-500/50 bg-rose-950/60 px-4 py-3 text-xs font-mono text-rose-200"
          >
            <strong>Verification Error (req #{state.activeRequestId}):</strong>{" "}
            {state.errorBanner}
          </div>
        ) : null}

        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              1-Click Automotive Presets (Official 9,706-Line signal_catalog.json)
            </h2>
            <span className="font-mono text-xs text-slate-400">
              activeRequestId: #{state.activeRequestId} | seed: {state.seed}
            </span>
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            {AUTOMOTIVE_PRESETS.map((preset) => {
              const isSelected = preset.id === state.selectedPresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePresetClick(preset)}
                  className={`rounded-xl border p-4 text-left transition ${
                    isSelected
                      ? "border-cyan-400 bg-cyan-950/30 shadow-md"
                      : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-cyan-300">
                      {preset.id}
                    </span>
                    {isSelected ? (
                      <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] text-cyan-200">
                        ACTIVE
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-1 text-sm font-bold text-slate-100">
                    {preset.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {preset.description}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-6 grid gap-3 md:grid-cols-3">
          <InvariantBadge
            code="P1_VSS_BOUNDS_AND_UPSTREAM_FIX"
            label="VSS min/max/allowed/arraysize enforced + FLOAT 22.5 & VECTOR_UINT32 > 65535 fixed"
            passed={
              state.lastResponse?.oracle.P1_VSS_BOUNDS_AND_UPSTREAM_FIX ?? true
            }
          />
          <InvariantBadge
            code="P2_PRIORITY_ARBITRATION_PREEMPTION"
            label="Higher QNX priority preempts .control; lower priority blocked with EBUSY"
            passed={
              state.lastResponse?.oracle.P2_PRIORITY_ARBITRATION_PREEMPTION ??
              true
            }
          />
          <InvariantBadge
            code="P3_DEAD_OWNER_LEASE_RECOVERY"
            label="io_close_ocb crash or CLOCK_MONOTONIC lease expiry promotes standby or VSS default"
            passed={
              state.lastResponse?.oracle.P3_DEAD_OWNER_LEASE_RECOVERY ?? true
            }
          />
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <TimelinePanel
            title="Raw QPP (Unguarded)"
            subtitle="Unpatched upstream qnx/qnx-posix-publish-subscribe behavior"
            accentColor="#f97316"
            viewBoxWidth={chartModel.viewBoxWidth}
            viewBoxHeight={chartModel.viewBoxHeight}
            polyline={chartModel.unguardedPolyline}
            points={chartModel.unguardedPoints}
            steps={unguardedSteps}
          />
          <TimelinePanel
            title="VssWarden (Guarded)"
            subtitle="Patched QPP with pre-compiled VSS bounds, priority-lease arbiter & io_close_ocb rollback"
            accentColor="#10b981"
            viewBoxWidth={chartModel.viewBoxWidth}
            viewBoxHeight={chartModel.viewBoxHeight}
            polyline={chartModel.guardedPolyline}
            points={chartModel.guardedPoints}
            steps={guardedSteps}
          />
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
            <h2 className="text-sm font-bold text-slate-100">
              POSIX <code className="text-cyan-300">?warden</code> JSON
              Diagnostic Inspector
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Output returned by{" "}
              <code className="text-slate-200">
                cat /dev/signal/{latestWardenPayload.path}?warden,text
              </code>
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-emerald-300">
              {JSON.stringify(latestWardenPayload, null, 2)}
            </pre>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
            <h2 className="text-sm font-bold text-slate-100">
              Copyable One-Line C CLI Replay &amp; QNX Target POSIX Commands
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Deterministic C11 host binary replay command (`cliReplayCommand`):
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-cyan-500/30 bg-slate-950 p-3 font-mono text-xs text-cyan-300">
              {cliReplayCommand}
            </pre>
            <p className="mt-3 text-xs text-slate-400">
              Equivalent QNX 8.0{" "}
              <code className="text-slate-200">/dev/signal/</code> POSIX shell
              commands:
            </p>
            <div className="mt-2 space-y-1.5">
              {(state.lastResponse?.posixCommands ?? []).map((cmd) => (
                <pre
                  key={cmd}
                  className="overflow-x-auto rounded border border-slate-800 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-200"
                >
                  {cmd}
                </pre>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
