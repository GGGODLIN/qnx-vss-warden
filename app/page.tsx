import Link from "next/link";
import type { ReactNode } from "react";
import { runVerificationPipeline } from "../lib/pipeline.ts";
import { AUTOMOTIVE_PRESETS } from "../lib/presets.ts";
import { CODELAB_STEPS } from "../lib/studio-model.ts";
import type { WardenVerifySuccessResponse } from "../lib/types.ts";
import { ArbitrationBench } from "./_studio/bench.tsx";
import {
  type ChannelSpec,
  type InvariantSpec,
  type ScenarioNote,
  splitReference,
} from "./_studio/bench-model.ts";
import { SiteFooter, TopRail } from "./_studio/chrome.tsx";

// The hijack scenario boots first: it is the one a judge reads in a single glance.
const BOOT_PRESET_ID = "preset-2-adas-vs-ivi-hijack";
const BOOT_SEED = 20261105;

const CHANNELS: { raw: ChannelSpec; guarded: ChannelSpec } = {
  raw: {
    key: "raw",
    code: "CH1",
    title: "Raw QPP (Unguarded)",
    subtitle: "upstream · last write wins",
  },
  guarded: {
    key: "guarded",
    code: "CH2",
    title: "VssWarden (Guarded)",
    subtitle: "patched · bounds · lease · io_close_ocb",
  },
};

const INVARIANTS: readonly InvariantSpec[] = [
  {
    key: "P1_VSS_BOUNDS_AND_UPSTREAM_FIX",
    code: "P1",
    name: "Bounds & upstream fixes",
    detail: "min · max · allowed · arraysize · FLOAT 22.5 · VECTOR_UINT32 > 65535",
    counter: "boundsRejectedCount",
    counterLabel: "bounds rejects",
  },
  {
    key: "P2_PRIORITY_ARBITRATION_PREEMPTION",
    code: "P2",
    name: "Priority arbitration",
    detail: "higher QNX priority preempts .control · lower gets EBUSY",
    counter: "priorityBlockedCount",
    counterLabel: "priority blocks",
  },
  {
    key: "P3_DEAD_OWNER_LEASE_RECOVERY",
    code: "P3",
    name: "Dead-owner lease recovery",
    detail: "io_close_ocb crash or CLOCK_MONOTONIC expiry → standby or VSS default",
    counter: "leaseRecoveredCount",
    counterLabel: "lease recoveries",
  },
];

const SCENARIO_NOTES: Readonly<Record<string, ScenarioNote>> = {
  "preset-1-bounds-float-bug": {
    focus: "P1",
    hook: "Mirror pan 120 past a max of 100, an illegal wiper enum, a 22.5 °C float default and a DTC vector above 65535.",
  },
  "preset-2-adas-vs-ivi-hijack": {
    focus: "P2",
    hook: "IVI_EcoMode (P10) pushes 110 km/h over the 0 km/h command ADAS_AEB (P60) is holding.",
  },
  "preset-3-crash-lease-rollback": {
    focus: "P3",
    hook: "ADAS_AEB (P60) crashes mid-lease; standby ADAS_Cruise (P45) takes over, then the TTL falls back to 0 km/h.",
  },
};

const NAMEPLATE: readonly (readonly [string, string])[] = [
  ["Target", "QNX Neutrino RTOS 8.0"],
  ["Service", "QPP resource manager"],
  ["Schema", "COVESA VSS v3"],
  ["Engine", "C11 · WASI host replay"],
  ["Patch", "13 QPP files · --fuzz=0"],
  ["Oracle", "fast-check · P1–P3"],
  ["License", "Apache-2.0"],
];

function bootFrame(): WardenVerifySuccessResponse | null {
  const preset = AUTOMOTIVE_PRESETS.find((p) => p.id === BOOT_PRESET_ID);
  if (!preset) return null;
  const result = runVerificationPipeline({
    presetId: preset.id,
    seed: BOOT_SEED,
    requestId: 1,
    catalogJsonc: preset.catalogJsonc,
    operations: preset.operations,
  });
  return result.ok ? result : null;
}

function Nameplate(): ReactNode {
  return (
    <aside className="plate" aria-label="Specification">
      <p className="plate-title">
        <span className="caps">Spec plate</span>
        <span className="plate-serial">VSS · WARDEN</span>
      </p>
      <dl>
        {NAMEPLATE.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function Hero({ cliReplayCommand }: { cliReplayCommand: string | null }): ReactNode {
  return (
    <section className="hero shell">
      <div className="hero-copy">
        <p className="hero-eyebrow">
          <span className="hero-led" aria-hidden="true" />
          QNX Global Hackathon · Automotive &amp; Mobility
        </p>
        <h1 className="hero-title">
          Same POSIX writes.
          <br />
          <em>Two different vehicles.</em>
        </h1>
        <p className="hero-lede">
          Upstream QPP lets any process write any value to an actuator&apos;s <code>.control</code> node, and the
          last write wins. VssWarden patches the QNX 8.0 resource manager so COVESA VSS bounds, priority leases and
          crash recovery are enforced at <code>/dev/signal</code> — and every rejection leaves a <code>?warden</code>{" "}
          receipt.
        </p>
        <p className="hero-proof">
          <span className="hero-proof-tag">Boot frame</span>
          {cliReplayCommand ? (
            <span>
              computed server-side by the C11 engine · <code>{cliReplayCommand}</code>
            </span>
          ) : (
            <span>engine unavailable at render time · press Run verification</span>
          )}
        </p>
      </div>
      <Nameplate />
    </section>
  );
}

function UpstreamGaps(): ReactNode {
  const references = CODELAB_STEPS[0]?.upstreamReferences ?? [];
  const minutes = CODELAB_STEPS.reduce((sum, step) => sum + step.durationMinutes, 0);
  return (
    <section className="gaps shell" aria-labelledby="gaps-title">
      <div className="gaps-intro">
        <p className="caps">Upstream evidence</p>
        <h2 id="gaps-title" className="section-title">
          Where upstream QPP <em>lets it through</em>
        </h2>
        <p className="section-lede">
          Each scenario on the bench maps to these source locations in qnx/qnx-posix-publish-subscribe. The patch
          touches seven QPP files and applies with zero fuzz.
        </p>
        <Link href="/codelab" className="cta">
          <span className="cta-kicker">{`Codelab · ${CODELAB_STEPS.length} steps · ~${minutes} min`}</span>
          <span className="cta-title">Diagnose, patch, arbitrate, recover, prove</span>
          <span className="cta-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </div>
      <ol className="gap-list">
        {references.map((reference) => {
          const { where, what } = splitReference(reference);
          return (
            <li key={reference}>
              <code>{where}</code>
              <span>{what}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function StudioPage(): ReactNode {
  const boot = bootFrame();
  return (
    <>
      <TopRail active="bench" />
      <main className="page">
        <Hero cliReplayCommand={boot?.cliReplayCommand ?? null} />
        <div className="shell">
          <ArbitrationBench
            initialResponse={boot}
            channels={CHANNELS}
            invariants={INVARIANTS}
            scenarioNotes={SCENARIO_NOTES}
          />
        </div>
        <UpstreamGaps />
      </main>
      <SiteFooter />
    </>
  );
}
