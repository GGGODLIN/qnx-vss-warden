import Link from "next/link";
import type { ReactNode } from "react";

const UPSTREAM_QPP_URL = "https://github.com/qnx/qnx-posix-publish-subscribe";

function BrandMark(): ReactNode {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="5" />
      <path className="brand-limit" d="M4 8.5 H20" />
      <path className="brand-pulse" d="M3.5 17 H7 V8.5 H13 V17 H15.5 V12 H20.5" />
    </svg>
  );
}

export interface TopRailProps {
  active: "bench" | "codelab";
}

export function TopRail({ active }: TopRailProps): ReactNode {
  return (
    <header className="rail">
      <div className="shell rail-inner">
        <Link href="/" className="brand" aria-label="VssWarden home">
          <BrandMark />
          <span className="brand-name">VssWarden</span>
          <span className="brand-tag">QPP safety gatekeeper</span>
        </Link>
        <ul className="rail-specs" aria-label="Platform">
          <li>QNX Neutrino 8.0</li>
          <li>QPP · /dev/signal</li>
          <li>COVESA VSS v3</li>
        </ul>
        <nav className="rail-nav" aria-label="Primary">
          <Link href="/" aria-current={active === "bench" ? "page" : undefined}>
            Bench
          </Link>
          <Link href="/codelab" aria-current={active === "codelab" ? "page" : undefined}>
            Codelab
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter(): ReactNode {
  return (
    <footer className="site-foot">
      <div className="shell site-foot-inner">
        <p className="site-foot-mark">
          <span className="brand-name">VssWarden</span>
          <span className="caps">QNX Global Hackathon · Automotive &amp; Mobility</span>
        </p>
        <p className="site-foot-meta">
          Apache-2.0 · patches{" "}
          <a href={UPSTREAM_QPP_URL} rel="noreferrer" target="_blank">
            qnx/qnx-posix-publish-subscribe
          </a>{" "}
          · host engine needs no API keys
        </p>
      </div>
    </footer>
  );
}
