import type { ReactNode } from "react";
import type { TimelinePoint } from "../../lib/studio-model.ts";
import type { WardenStepReceipt } from "../../lib/types.ts";
import {
  type ChannelSpec,
  describeOperation,
  formatNumber,
  formatValue,
  isDivergenceEvent,
  pad2,
  type StepFrame,
} from "./bench-model.ts";

// Mirrors the private plot box in lib/studio-model.ts so the graticule frames
// exactly the coordinates buildTimelineChartModel() hands us.
const VIEW_W = 640;
const VIEW_H = 220;
const LEFT = 48;
const RIGHT = 616;
const TOP = 24;
const BOTTOM = 184;
const MID_X = (LEFT + RIGHT) / 2;
const MID_Y = (TOP + BOTTOM) / 2;

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

const GRID_MAJOR = [
  ...Array.from({ length: 9 }, (_, i) => `M ${r2(LEFT + (i + 1) * 56.8)} ${TOP} V ${BOTTOM}`),
  ...Array.from({ length: 7 }, (_, j) => `M ${LEFT} ${TOP + (j + 1) * 20} H ${RIGHT}`),
].join(" ");

const GRID_MINOR = [
  ...Array.from({ length: 49 }, (_, k) => {
    const x = r2(LEFT + (k + 1) * 11.36);
    return `M ${x} ${MID_Y - 2.5} V ${MID_Y + 2.5}`;
  }),
  ...Array.from({ length: 39 }, (_, k) => {
    const y = TOP + (k + 1) * 4;
    return `M ${MID_X - 2.5} ${y} H ${MID_X + 2.5}`;
  }),
].join(" ");

function tracePath(points: readonly TimelinePoint[]): string {
  const first = points[0];
  if (!first) return "";
  const steps = points.map((pt) => `H ${r2(pt.x)} V ${r2(pt.y)}`).join(" ");
  return `M ${LEFT} ${r2(first.y)} ${steps} H ${RIGHT}`;
}

function valueToY(value: number, valueMin: number, valueMax: number): number {
  const span = Math.max(1, valueMax - valueMin);
  const y = BOTTOM - ((value - valueMin) / span) * (BOTTOM - TOP);
  return r2(Math.min(BOTTOM, Math.max(TOP, y)));
}

function receiptFor(frame: StepFrame, key: ChannelSpec["key"]): WardenStepReceipt {
  return key === "raw" ? frame.raw : frame.guarded;
}

interface MarkerLabel {
  text: string;
  tone: "fault" | "channel";
  dashed: boolean;
  clamp: boolean;
}

function markerFor(frame: StepFrame, key: ChannelSpec["key"]): MarkerLabel | null {
  if (key === "raw") {
    if (isDivergenceEvent(frame)) {
      return { text: frame.invariant ?? "Δ", tone: "fault", dashed: false, clamp: false };
    }
    if (frame.kind === "carried") {
      return { text: "Δ", tone: "fault", dashed: true, clamp: false };
    }
    return null;
  }
  if (frame.guarded.status !== "EOK") {
    return { text: frame.guarded.status, tone: "channel", dashed: false, clamp: true };
  }
  if (frame.kind === "recovered") {
    const text =
      frame.op?.kind === "ADVANCE_CLOCK"
        ? "ROLLBACK"
        : frame.guarded.activeHolder
          ? "PROMOTE"
          : "DEFAULT";
    return { text, tone: "channel", dashed: false, clamp: false };
  }
  if (frame.kind === "upstream-fix") {
    return { text: "FIXED", tone: "channel", dashed: false, clamp: false };
  }
  return null;
}

interface MarkerGlyphProps {
  marker: MarkerLabel;
  x: number;
  y: number;
}

function MarkerGlyph({ marker, x, y }: MarkerGlyphProps): ReactNode {
  // Tags sit beside the sample, never centred on it: a value change draws a
  // vertical edge exactly at x, and a centred tag would sit on that edge.
  const nearRight = x > RIGHT - 44;
  const tone = marker.tone === "fault" ? " is-fault" : "";
  return (
    <>
      {marker.clamp ? (
        <path
          className="scope-clamp"
          d={`M ${x - 7} ${y - 6} H ${x + 7} M ${x - 7} ${y - 6} V ${y - 2} M ${x + 7} ${y - 6} V ${y - 2}`}
        />
      ) : (
        <circle
          className={`scope-ring${tone}`}
          cx={x}
          cy={y}
          r={7}
          strokeDasharray={marker.dashed ? "2 2.5" : undefined}
        />
      )}
      <text
        className={`scope-tag${tone}`}
        x={nearRight ? x - 9 : x + 9}
        y={y - 12 >= TOP + 4 ? y - 9 : y + 16}
        textAnchor={nearRight ? "end" : "start"}
      >
        {marker.text}
      </text>
    </>
  );
}

interface StepGlyphProps {
  frame: StepFrame;
  point: TimelinePoint;
  channelKey: ChannelSpec["key"];
  isCursor: boolean;
}

function StepGlyph({ frame, point, channelKey, isCursor }: StepGlyphProps): ReactNode {
  const marker = markerFor(frame, channelKey);
  const x = r2(point.x);
  const y = r2(point.y);
  const ok = receiptFor(frame, channelKey).status === "EOK";
  return (
    <g>
      {marker ? <MarkerGlyph marker={marker} x={x} y={y} /> : null}
      <circle className={ok ? "scope-dot" : "scope-dot is-fault"} cx={x} cy={y} r={isCursor ? 3.4 : 2.6} />
    </g>
  );
}

interface AxisProps {
  frames: readonly StepFrame[];
  points: readonly TimelinePoint[];
  cursor: number;
}

function TimeAxis({ frames, points, cursor }: AxisProps): ReactNode {
  return (
    <g>
      {frames.map((frame) => {
        const point = points[frame.position];
        if (!point) return null;
        const op = describeOperation(frame);
        const active = frame.position === cursor;
        return (
          <g key={`axis-${frame.stepIndex}`} className={active ? "scope-axis is-active" : "scope-axis"}>
            <text x={r2(point.x)} y={200} textAnchor="middle" className="scope-axis-verb">
              {op.verb}
            </text>
            <text x={r2(point.x)} y={211} textAnchor="middle" className="scope-axis-note">
              {op.axisNote}
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface CursorProps {
  frame: StepFrame;
  point: TimelinePoint;
}

function CursorMark({ frame, point }: CursorProps): ReactNode {
  const x = r2(point.x);
  const flagX = Math.min(RIGHT - 14, Math.max(LEFT + 14, x));
  return (
    <g className="scope-cursor" aria-hidden="true">
      <line x1={x} y1={19} x2={x} y2={BOTTOM} />
      <rect x={flagX - 15} y={6} width={30} height={13} rx={2} />
      <text x={flagX} y={15.6} textAnchor="middle">
        {`#${pad2(frame.stepIndex)}`}
      </text>
      <circle cx={x} cy={r2(point.y)} r={9.5} />
    </g>
  );
}

interface HitLayerProps {
  frames: readonly StepFrame[];
  points: readonly TimelinePoint[];
  onSelect: (position: number) => void;
}

function HitLayer({ frames, points, onSelect }: HitLayerProps): ReactNode {
  return (
    <div className="scope-hits" aria-hidden="true">
      {frames.map((frame) => {
        const x = points[frame.position]?.x ?? 0;
        const prev = points[frame.position - 1]?.x;
        const next = points[frame.position + 1]?.x;
        const left = prev === undefined ? LEFT - 12 : (prev + x) / 2;
        const right = next === undefined ? RIGHT + 12 : (x + next) / 2;
        return (
          <button
            key={`hit-${frame.stepIndex}`}
            type="button"
            tabIndex={-1}
            className="scope-hit"
            style={{
              left: `${((left / VIEW_W) * 100).toFixed(3)}%`,
              width: `${(((right - left) / VIEW_W) * 100).toFixed(3)}%`,
            }}
            onClick={() => onSelect(frame.position)}
          />
        );
      })}
    </div>
  );
}

interface ReadoutProps {
  frame: StepFrame | null;
  channelKey: ChannelSpec["key"];
}

function ScopeReadout({ frame, channelKey }: ReadoutProps): ReactNode {
  if (!frame) {
    return (
      <dl className="scope-readout">
        <div>
          <dt>Cursor</dt>
          <dd>—</dd>
        </div>
      </dl>
    );
  }
  const receipt = receiptFor(frame, channelKey);
  const holder = receipt.activeHolder;
  return (
    <dl className="scope-readout">
      <div>
        <dt>Cursor</dt>
        <dd>{`#${pad2(frame.stepIndex)} ${describeOperation(frame).verb}`}</dd>
      </div>
      <div>
        <dt>Value</dt>
        <dd className="readout-value">{formatValue(receipt.committedControlValue)}</dd>
      </div>
      <div>
        <dt>Hex</dt>
        <dd>{receipt.committedHex}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd className={receipt.status === "EOK" ? "readout-ok" : "readout-errno"}>{receipt.status}</dd>
      </div>
      <div>
        <dt>Holder</dt>
        <dd>{holder ? `${holder.role} · P${holder.priority}` : "—"}</dd>
      </div>
    </dl>
  );
}

export interface ScopeScreenProps {
  channel: ChannelSpec;
  frames: readonly StepFrame[];
  points: readonly TimelinePoint[];
  valueMin: number;
  valueMax: number;
  cursor: number;
  isLoading: boolean;
  onSelect: (position: number) => void;
}

export function ScopeScreen({
  channel,
  frames,
  points,
  valueMin,
  valueMax,
  cursor,
  isLoading,
  onSelect,
}: ScopeScreenProps): ReactNode {
  const key = channel.key;
  const cursorFrame = frames[cursor] ?? null;
  const cursorPoint = points[cursor] ?? null;
  const line = tracePath(points);
  const zeroY = valueToY(0, valueMin, valueMax);
  const channelNumber = channel.code.replace(/\D/g, "");
  const summary = cursorFrame
    ? `${channel.title}: ${frames.length} steps; cursor at step ${cursorFrame.stepIndex}, committed ${formatValue(receiptFor(cursorFrame, key).committedControlValue)} with ${receiptFor(cursorFrame, key).status}.`
    : `${channel.title}: no acquisition yet.`;

  return (
    <figure className={`scope scope--${key}`} aria-busy={isLoading}>
      <figcaption className="scope-head">
        <span className="scope-ch">{channel.code}</span>
        <span className="scope-title">{channel.title}</span>
        <span className="scope-sub">{channel.subtitle}</span>
      </figcaption>
      <div className="scope-glass">
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={summary}>
          <defs>
            <linearGradient id={`vw-fill-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="scope-fill-top" />
              <stop offset="1" className="scope-fill-bottom" />
            </linearGradient>
            <filter id={`vw-glow-${key}`} x="-10%" y="-30%" width="120%" height="160%">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
          </defs>
          <rect className="scope-frame" x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} />
          <path className="scope-grid" d={GRID_MAJOR} />
          <path className="scope-grid-minor" d={GRID_MINOR} />
          <g className="scope-yaxis">
            <text x={42} y={TOP + 3} textAnchor="end">{formatNumber(valueMax)}</text>
            <text x={42} y={MID_Y + 3} textAnchor="end">{formatNumber((valueMax + valueMin) / 2)}</text>
            <text x={42} y={BOTTOM + 3} textAnchor="end">{formatNumber(valueMin)}</text>
          </g>
          <path
            className="scope-ground"
            d={`M ${VIEW_W - 6} ${zeroY - 5} H ${RIGHT + 8} L ${RIGHT + 3} ${zeroY} L ${RIGHT + 8} ${zeroY + 5} H ${VIEW_W - 6} Z`}
          />
          <text className="scope-ground-label" x={VIEW_W - 9.5} y={zeroY + 2.6} textAnchor="middle">
            {channelNumber}
          </text>
          {line ? (
            <>
              <path className="scope-area" d={`${line} V ${BOTTOM} H ${LEFT} Z`} fill={`url(#vw-fill-${key})`} />
              <path className="scope-trace-glow" d={line} filter={`url(#vw-glow-${key})`} />
              <path className="scope-trace" d={line} />
            </>
          ) : (
            <path className="scope-trace is-idle" d={`M ${LEFT} ${zeroY} H ${RIGHT}`} />
          )}
          {cursorFrame && cursorPoint ? <CursorMark frame={cursorFrame} point={cursorPoint} /> : null}
          {frames.map((frame) => {
            const point = points[frame.position];
            return point ? (
              <StepGlyph
                key={`glyph-${frame.stepIndex}`}
                frame={frame}
                point={point}
                channelKey={key}
                isCursor={frame.position === cursor}
              />
            ) : null;
          })}
          <TimeAxis frames={frames} points={points} cursor={cursor} />
        </svg>
        <HitLayer frames={frames} points={points} onSelect={onSelect} />
        {frames.length === 0 && !isLoading ? (
          <p className="scope-overlay">No acquisition — press RUN</p>
        ) : null}
        {isLoading ? <p className="scope-overlay is-acquiring">Acquiring</p> : null}
      </div>
      <ScopeReadout frame={cursorFrame} channelKey={key} />
    </figure>
  );
}
