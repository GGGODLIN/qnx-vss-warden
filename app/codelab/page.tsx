"use client";

import Link from "next/link";
import { type DetailedHTMLProps, type HTMLAttributes, type ReactNode, useState } from "react";
import { CODELAB_STEPS } from "../../lib/studio-model.ts";

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
      "google-codelab-step": DetailedHTMLProps<
        GoogleCodelabStepAttributes,
        HTMLElement
      >;
    }
  }
}

export default function CodelabPage(): ReactNode {
  const [activeStepNumber, setActiveStepNumber] = useState<number>(1);
  const currentStep =
    CODELAB_STEPS.find((s) => s.stepNumber === activeStepNumber) ??
    CODELAB_STEPS[0]!;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center">
          <div>
            <span className="rounded bg-cyan-500/20 px-2 py-0.5 font-mono text-xs font-semibold text-cyan-300">
              Interactive &lt;google-codelab&gt; Tutorial
            </span>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">
              QNX 8.0 QPP + VssWarden: Mixed-Criticality SDV Actuator Safety
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              Step-by-step guide to diagnosing upstream QPP gaps, applying{" "}
              <code className="text-slate-200">patches/qpp-vss-warden.patch</code>,
              testing <code className="text-slate-200">.control</code> priority
              arbitration, and running the Shape 1 <code className="text-slate-200">fast-check</code>{" "}
              PBT suite.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500"
          >
            &larr; Back to Verification Studio
          </Link>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <aside className="space-y-2 lg:col-span-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Codelab Steps ({CODELAB_STEPS.length})
            </h2>
            {CODELAB_STEPS.map((step) => {
              const isCurrent = step.stepNumber === currentStep.stepNumber;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setActiveStepNumber(step.stepNumber)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                    isCurrent
                      ? "border-cyan-400 bg-cyan-950/40 text-cyan-100"
                      : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span>Step {step.stepNumber}</span>
                    <span className="text-slate-400">{step.durationMinutes} min</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold">{step.label}</p>
                </button>
              );
            })}
          </aside>

          <div className="lg:col-span-8">
            <google-codelab
              id="qnx-vss-warden-codelab"
              title="QNX 8.0 QPP + VssWarden Mixed-Criticality SDV Codelab"
              environment="web"
              feedback-link="https://github.com/qnx/qnx-posix-publish-subscribe"
              className="block space-y-6"
            >
              {CODELAB_STEPS.map((step) => {
                const isActive = step.stepNumber === currentStep.stepNumber;
                return (
                  <google-codelab-step
                    key={step.id}
                    label={step.label}
                    duration={String(step.durationMinutes)}
                    step={String(step.stepNumber)}
                    className={`block rounded-xl border p-5 ${
                      isActive
                        ? "border-cyan-500/60 bg-slate-900/90 shadow-lg"
                        : "border-slate-800/70 bg-slate-900/40"
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <h3 className="text-base font-bold text-slate-100">
                        {step.label}
                      </h3>
                      <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-cyan-300">
                        {step.durationMinutes} min
                      </span>
                    </div>

                    <p className="mt-3 text-sm leading-relaxed text-slate-300">
                      {step.summary}
                    </p>

                    <div className="mt-4">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Terminal Commands
                      </h4>
                      <div className="mt-2 space-y-1.5">
                        {step.commands.map((cmd) => (
                          <pre
                            key={`${step.id}-${cmd}`}
                            className="overflow-x-auto rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-cyan-300"
                          >
                            {cmd}
                          </pre>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Code &amp; Diagnostic Output
                      </h4>
                      <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-emerald-300">
                        {step.codeSnippet}
                      </pre>
                    </div>

                    <div className="mt-4">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Verified Upstream QPP &amp; Repository References
                      </h4>
                      <ul className="mt-1.5 list-inside list-disc space-y-1 font-mono text-xs text-slate-400">
                        {step.upstreamReferences.map((refText) => (
                          <li key={`${step.id}-${refText}`}>{refText}</li>
                        ))}
                      </ul>
                    </div>
                  </google-codelab-step>
                );
              })}
            </google-codelab>
          </div>
        </div>
      </div>
    </main>
  );
}
