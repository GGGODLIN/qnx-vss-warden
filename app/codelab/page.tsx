"use client";

import Link from "next/link";
import { type DetailedHTMLProps, type HTMLAttributes, type ReactNode, useRef, useState } from "react";
import { CODELAB_STEPS, type CodelabStep } from "../../lib/studio-model.ts";
import { pad2, splitReference, tokenizeJson } from "../_studio/bench-model.ts";
import { SiteFooter, TopRail } from "../_studio/chrome.tsx";
import { CopyButton } from "../_studio/copy-button.tsx";
import { type CopyControl, useCopy } from "../_studio/use-copy.ts";

interface GoogleCodelabAttributes extends HTMLAttributes<HTMLElement> {
  id?: string;
  title?: string;
  environment?: string;
  "feedback-link"?: string;
}

interface GoogleCodelabStepAttributes extends HTMLAttributes<HTMLElement> {
  label?: string;
  duration?: string;
  step?: string;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "google-codelab": DetailedHTMLProps<GoogleCodelabAttributes, HTMLElement>;
      "google-codelab-step": DetailedHTMLProps<GoogleCodelabStepAttributes, HTMLElement>;
    }
  }
}

const TOTAL_MINUTES = CODELAB_STEPS.reduce((sum, step) => sum + step.durationMinutes, 0);

function stripOrdinal(label: string): string {
  return label.replace(/^\d+\.\s*/, "");
}

type LineTone = "comment" | "shell" | "plain";

function lineTone(line: string): LineTone {
  const trimmed = line.trimStart();
  if (/^(\/\/|\/\*|\*|# )/.test(trimmed)) return "comment";
  if (trimmed.startsWith("$ ")) return "shell";
  return "plain";
}

function CodeSnippet({ text }: { text: string }): ReactNode {
  if (text.trimStart().startsWith("{")) {
    return (
      <pre className="lab-code">
        {tokenizeJson(text).map((token) => (
          <span key={token.start} className={`tok-${token.kind}`}>
            {token.text}
          </span>
        ))}
      </pre>
    );
  }
  const lines = text.split("\n").map((content, line) => ({ content, line }));
  return (
    <pre className="lab-code">
      {lines.map(({ content, line }) => (
        <span key={line} className={`code-line is-${lineTone(content)}`}>
          {content}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

interface StepBodyProps {
  step: CodelabStep;
  copier: CopyControl;
}

function StepBody({ step, copier }: StepBodyProps): ReactNode {
  const commands = step.commands.map((command, line) => ({ command, key: `${step.id}-${line}` }));
  return (
    <>
      <header className="lab-step-head">
        <span className="lab-numeral" aria-hidden="true">
          {pad2(step.stepNumber)}
        </span>
        <div>
          <p className="caps">{`Step ${step.stepNumber} of ${CODELAB_STEPS.length} · ${step.durationMinutes} min`}</p>
          <h2 className="lab-step-title">{stripOrdinal(step.label)}</h2>
        </div>
      </header>
      <p className="lab-summary">{step.summary}</p>

      <section className="lab-block" aria-label={`Step ${step.stepNumber} commands`}>
        <p className="lab-block-head">
          <span className="caps">Run</span>
          <span className="lab-block-meta">{`${step.commands.length} commands`}</span>
        </p>
        <ol className="term">
          {commands.map(({ command, key }) => (
            <li key={key} className="term-line">
              <span className="term-prompt">$</span>
              <code>{command}</code>
              <CopyButton copier={copier} copyKey={key} text={command} />
            </li>
          ))}
        </ol>
      </section>

      <section className="lab-block" aria-label={`Step ${step.stepNumber} expected output`}>
        <p className="lab-block-head">
          <span className="caps">Code &amp; diagnostic output</span>
        </p>
        <CodeSnippet text={step.codeSnippet} />
      </section>

      <section className="lab-block" aria-label={`Step ${step.stepNumber} references`}>
        <p className="lab-block-head">
          <span className="caps">Verified references</span>
        </p>
        <ul className="ref-list">
          {step.upstreamReferences.map((reference) => {
            const { where, what } = splitReference(reference);
            return (
              <li key={reference}>
                <code>{where}</code>
                <span>{what}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

interface StepRailProps {
  active: number;
  onPick: (stepNumber: number) => void;
}

function StepRail({ active, onPick }: StepRailProps): ReactNode {
  const elapsed = CODELAB_STEPS.filter((s) => s.stepNumber < active).reduce((sum, s) => sum + s.durationMinutes, 0);
  const progress = TOTAL_MINUTES > 0 ? Math.round((elapsed / TOTAL_MINUTES) * 100) : 0;
  return (
    <aside className="lab-rail" aria-label="Codelab steps">
      <p className="caps">Procedure</p>
      <div
        className="lab-meter"
        role="progressbar"
        aria-label="Codelab progress"
        aria-valuemin={0}
        aria-valuemax={TOTAL_MINUTES}
        aria-valuenow={elapsed}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="lab-meter-meta">{`${elapsed} of ${TOTAL_MINUTES} min behind you`}</p>
      <ol className="lab-steps">
        {CODELAB_STEPS.map((step) => {
          const state = step.stepNumber < active ? "done" : step.stepNumber === active ? "current" : "next";
          return (
            <li key={step.id}>
              <button
                type="button"
                data-state={state}
                aria-current={state === "current" ? "step" : undefined}
                onClick={() => onPick(step.stepNumber)}
              >
                <span className="lab-step-no">{state === "done" ? "✓" : pad2(step.stepNumber)}</span>
                <span className="lab-step-label">{stripOrdinal(step.label)}</span>
                <span className="lab-step-min">{`${step.durationMinutes}′`}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <Link href="/" className="lab-back">
        ← Back to the arbitration bench
      </Link>
    </aside>
  );
}

export default function CodelabPage(): ReactNode {
  const [active, setActive] = useState<number>(CODELAB_STEPS[0]?.stepNumber ?? 1);
  const copier = useCopy();
  const top = useRef<HTMLDivElement>(null);
  const total = CODELAB_STEPS.length;

  function go(stepNumber: number): void {
    setActive(Math.min(Math.max(1, stepNumber), total));
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <>
      <TopRail active="codelab" />
      <main className="page">
        <section className="lab-hero shell">
          <p className="hero-eyebrow">
            <span className="hero-led" aria-hidden="true" />
            Interactive &lt;google-codelab&gt; · Best Codelab / Tutorial
          </p>
          <h1 className="hero-title lab-title">
            Teach QPP to <em>say no.</em>
          </h1>
          <p className="hero-lede">
            Diagnose three upstream gaps, apply <code>patches/qpp-vss-warden.patch</code> with zero fuzz, arbitrate{" "}
            <code>.control</code> writes from a POSIX shell, recover from a crashed holder, then prove P1–P3 with
            fast-check.
          </p>
          <dl className="lab-facts">
            <div>
              <dt>Steps</dt>
              <dd>{pad2(total)}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{`~${TOTAL_MINUTES} min`}</dd>
            </div>
            <div>
              <dt>Toolchain</dt>
              <dd>clang · patch · echo / cat · npm test</dd>
            </div>
          </dl>
        </section>

        <div className="lab shell" ref={top}>
          <StepRail active={active} onPick={go} />
          <div className="lab-main">
            <google-codelab
              id="qnx-vss-warden-codelab"
              title="QNX 8.0 QPP + VssWarden Mixed-Criticality SDV Codelab"
              environment="web"
              feedback-link="https://github.com/qnx/qnx-posix-publish-subscribe"
              className="lab-codelab"
            >
              {CODELAB_STEPS.map((step) => (
                <google-codelab-step
                  key={step.id}
                  label={step.label}
                  duration={String(step.durationMinutes)}
                  step={String(step.stepNumber)}
                  hidden={step.stepNumber !== active}
                  className="lab-step"
                >
                  <StepBody step={step} copier={copier} />
                </google-codelab-step>
              ))}
            </google-codelab>
            <nav className="lab-pager" aria-label="Step navigation">
              <button type="button" className="pager-button" disabled={active <= 1} onClick={() => go(active - 1)}>
                ← Previous
              </button>
              <span className="pager-count">{`${pad2(active)} / ${pad2(total)}`}</span>
              {active < total ? (
                <button type="button" className="pager-button is-primary" onClick={() => go(active + 1)}>
                  Next step →
                </button>
              ) : (
                <Link href="/" className="pager-button is-primary">
                  Open the bench →
                </Link>
              )}
            </nav>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
