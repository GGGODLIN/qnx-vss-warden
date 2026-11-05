import type { ReactNode } from "react";
import type { VssDatatype, WardenStepReceipt } from "../../lib/types.ts";
import {
  buildMemoryView,
  type ByteView,
  type ChannelSpec,
  datatypeLabel,
  describeOperation,
  devSignalPath,
  explainFrame,
  formatHolder,
  formatValue,
  groupSpans,
  type MemoryBits,
  pad2,
  type StepFrame,
  tokenizeJson,
} from "./bench-model.ts";
import { CopyButton } from "./copy-button.tsx";
import type { CopyControl } from "./use-copy.ts";

interface Channels {
  raw: ChannelSpec;
  guarded: ChannelSpec;
}

function PanelHead({ id, title, meta }: { id: string; title: string; meta: string }): ReactNode {
  return (
    <header className="panel-head">
      <h3 id={id} className="panel-title">
        {title}
      </h3>
      <span className="panel-meta">{meta}</span>
    </header>
  );
}

interface OutcomeProps {
  channel: ChannelSpec;
  receipt: WardenStepReceipt;
}

function Outcome({ channel, receipt }: OutcomeProps): ReactNode {
  const rejection = receipt.lastRejection;
  return (
    <li className={`outcome outcome--${channel.key}`}>
      <span className="outcome-ch">{channel.code}</span>
      <span className="outcome-main">
        <span className="outcome-value">{formatValue(receipt.committedControlValue)}</span>
        <span className="outcome-hex">{receipt.committedHex}</span>
      </span>
      <span className={receipt.status === "EOK" ? "outcome-status" : "outcome-status is-errno"}>{receipt.status}</span>
      <span className="outcome-holder">
        {channel.key === "raw"
          ? "no arbitration · no holder tracking"
          : `holder ${formatHolder(receipt.activeHolder)}${rejection ? ` · last ${rejection.errnoCode} ${rejection.ruleId}` : ""}`}
      </span>
    </li>
  );
}

export interface StepDossierProps {
  frame: StepFrame | null;
  total: number;
  channels: Channels;
}

export function StepDossier({ frame, total, channels }: StepDossierProps): ReactNode {
  if (!frame) {
    return (
      <section className="panel dossier" aria-labelledby="dossier-title">
        <PanelHead id="dossier-title" title="Step dossier" meta="—" />
        <p className="panel-empty">Run the engine to inspect a step.</p>
      </section>
    );
  }
  const op = describeOperation(frame);
  const verdict = explainFrame(frame);
  return (
    <section className="panel dossier" aria-labelledby="dossier-title">
      <PanelHead id="dossier-title" title="Step dossier" meta={`#${pad2(frame.stepIndex)} of ${pad2(total)}`} />
      <p className="dossier-call">
        <span className="dossier-verb">{op.verb}</span>
        <code>{op.call}</code>
      </p>
      <p className="dossier-detail">{op.detail}</p>
      <ul className="outcomes">
        <Outcome channel={channels.raw} receipt={frame.raw} />
        <Outcome channel={channels.guarded} receipt={frame.guarded} />
      </ul>
      <div className="verdict" data-kind={frame.kind}>
        <p className="verdict-head">
          {frame.invariant ? <span className="verdict-code">{frame.invariant}</span> : null}
          {verdict.headline}
        </p>
        <p className="verdict-detail">{verdict.detail}</p>
        {verdict.source ? <p className="verdict-source">{verdict.source}</p> : null}
      </div>
    </section>
  );
}

interface Cell {
  offset: number;
  value: string;
  diff: boolean;
}

function cellsOf(view: ByteView, other: ByteView): Cell[] {
  return view.bytes.map((value, offset) => ({ offset, value, diff: other.bytes[offset] !== value }));
}

function bitCellsOf(bits: string, other: string): Cell[] {
  return [...bits].map((value, offset) => ({ offset, value, diff: other[offset] !== value }));
}

interface HexRowProps {
  channel: ChannelSpec;
  view: ByteView;
  other: ByteView;
}

function HexRow({ channel, view, other }: HexRowProps): ReactNode {
  return (
    <div className={`hexrow hexrow--${channel.key}`}>
      <span className="hexrow-ch">{channel.code}</span>
      <span className="hexrow-off">+00</span>
      <span className="hexrow-bytes">
        {cellsOf(view, other).map((cell) => (
          <span key={cell.offset} className={cell.diff ? "hexbyte is-diff" : "hexbyte"}>
            {cell.value}
          </span>
        ))}
      </span>
      <span className="hexrow-decoded">= {view.decoded}</span>
    </div>
  );
}

interface BitRowProps {
  channel: ChannelSpec;
  bits: string;
  other: string;
  groups: readonly number[];
}

function BitRow({ channel, bits, other, groups }: BitRowProps): ReactNode {
  const cells = bitCellsOf(bits, other);
  const spans = groupSpans(groups);
  return (
    <div className={`bits-row bits-row--${channel.key}`}>
      <span className="hexrow-ch">{channel.code}</span>
      <span className={bits.length <= 16 ? "bits-cells is-short" : "bits-cells"}>
        {spans.map((group) => (
          <span key={group.start} className="bit-group">
            {cells.slice(group.start, group.start + group.size).map((cell) => (
              <span
                key={cell.offset}
                className={`bit${cell.value === "1" ? " is-set" : ""}${cell.diff ? " is-diff" : ""}`}
              >
                {cell.value}
              </span>
            ))}
          </span>
        ))}
      </span>
    </div>
  );
}

interface BitsPanelProps {
  bits: MemoryBits;
  channels: Channels;
}

function BitsPanel({ bits, channels }: BitsPanelProps): ReactNode {
  return (
    <div className="bits">
      <p className="bits-legend">
        {bits.legend.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </p>
      <BitRow channel={channels.raw} bits={bits.raw} other={bits.guarded} groups={bits.groups} />
      <BitRow channel={channels.guarded} bits={bits.guarded} other={bits.raw} groups={bits.groups} />
      {bits.rawFormula && bits.guardedFormula ? (
        <dl className="bits-formula">
          <div>
            <dt>{channels.raw.code}</dt>
            <dd>{bits.rawFormula}</dd>
          </div>
          <div>
            <dt>{channels.guarded.code}</dt>
            <dd>{bits.guardedFormula}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

export interface ByteInspectorProps {
  frame: StepFrame | null;
  datatype: VssDatatype | null;
  channels: Channels;
}

export function ByteInspector({ frame, datatype, channels }: ByteInspectorProps): ReactNode {
  if (!frame) {
    return (
      <section className="panel bytes" aria-labelledby="bytes-title">
        <PanelHead id="bytes-title" title="Memory view" meta="—" />
        <p className="panel-empty">Committed bytes appear once a run lands.</p>
      </section>
    );
  }
  const view = buildMemoryView(frame, datatype);
  return (
    <section className="panel bytes" aria-labelledby="bytes-title">
      <PanelHead id="bytes-title" title="Memory view" meta={view.differs ? "Δ bytes differ" : "bytes identical"} />
      <p className="bytes-type">{datatypeLabel(datatype)}</p>
      <p className="bytes-path">{frame.guarded.signalPath ?? "Vehicle/Signal"}</p>
      <HexRow channel={channels.raw} view={view.raw} other={view.guarded} />
      <HexRow channel={channels.guarded} view={view.guarded} other={view.raw} />
      {view.bits ? <BitsPanel bits={view.bits} channels={channels} /> : null}
    </section>
  );
}

function receiptBody(frame: StepFrame): { json: string; verbatim: boolean } {
  const payload = frame.guarded.wardenPayload ?? null;
  if (payload) return { json: JSON.stringify(payload, null, 2), verbatim: true };
  const { stepIndex, status, committedControlValue, committedHex, activeHolder, lastRejection } = frame.guarded;
  return {
    json: JSON.stringify({ stepIndex, status, committedControlValue, committedHex, activeHolder, lastRejection }, null, 2),
    verbatim: false,
  };
}

export interface WardenReceiptProps {
  frame: StepFrame | null;
  frames: readonly StepFrame[];
  onJump: (position: number) => void;
}

export function WardenReceipt({ frame, frames, onJump }: WardenReceiptProps): ReactNode {
  if (!frame) {
    return (
      <section className="panel receipt" aria-labelledby="receipt-title">
        <PanelHead id="receipt-title" title="?warden receipt" meta="—" />
        <p className="panel-empty">No receipt yet.</p>
      </section>
    );
  }
  const { json, verbatim } = receiptBody(frame);
  const path = frame.guarded.wardenPayload?.path ?? frame.guarded.signalPath ?? "Vehicle/Signal";
  const readStep = frames.find((f) => f.guarded.wardenPayload);
  return (
    <section className="panel receipt" aria-labelledby="receipt-title">
      <PanelHead id="receipt-title" title="?warden receipt" meta={`step #${pad2(frame.stepIndex)}`} />
      <p className="receipt-prompt">
        <code>{`cat "${devSignalPath(path)}?warden,text"`}</code>
      </p>
      <p className="receipt-source">
        <span className={verbatim ? "receipt-badge is-verbatim" : "receipt-badge"}>
          {verbatim ? "Verbatim ?warden payload" : "Guarded step receipt"}
        </span>
        {!verbatim && readStep ? (
          <button type="button" className="receipt-jump" onClick={() => onJump(readStep.position)}>
            {`?warden read at #${pad2(readStep.stepIndex)} →`}
          </button>
        ) : null}
      </p>
      <pre className="receipt-json">
        {tokenizeJson(json).map((token) => (
          <span key={token.start} className={`tok-${token.kind}`}>
            {token.text}
          </span>
        ))}
      </pre>
    </section>
  );
}

export interface ReplayConsoleProps {
  cliReplayCommand: string;
  posixCommands: readonly string[];
  activeCommand: number | null;
  copier: CopyControl;
}

export function ReplayConsole({ cliReplayCommand, posixCommands, activeCommand, copier }: ReplayConsoleProps): ReactNode {
  const lines = posixCommands.map((command, line) => ({ command, line }));
  return (
    <section className="console" aria-labelledby="console-title">
      <h3 id="console-title" className="sr-only">
        Replay console
      </h3>
      <div className="console-col">
        <header className="console-head">
          <span className="caps">Host replay · C11 CLI</span>
          <span className="console-meta">deterministic · clang -std=c11</span>
        </header>
        <div className="term-line is-host">
          <span className="term-prompt">$</span>
          <code>{cliReplayCommand}</code>
          <CopyButton copier={copier} copyKey="cli" text={cliReplayCommand} />
        </div>
        <p className="console-note">
          Re-runs the same preset and seed through <code>build/vss-warden-cli</code> on macOS or Linux.
        </p>
      </div>
      <div className="console-col">
        <header className="console-head">
          <span className="caps">QNX 8.0 target · /dev/signal</span>
          <CopyButton
            copier={copier}
            copyKey="posix-all"
            text={posixCommands.join("\n")}
            idleLabel="Copy all"
            disabled={posixCommands.length === 0}
          />
        </header>
        {lines.length === 0 ? (
          <p className="console-note">POSIX commands appear after the first run.</p>
        ) : (
          <ol className="term">
            {lines.map(({ command, line }) => (
              <li key={`${line}:${command}`} className="term-line" data-active={line === activeCommand}>
                <span className="term-no">{pad2(line + 1)}</span>
                <code>{command}</code>
                <CopyButton copier={copier} copyKey={`posix-${line}`} text={command} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
