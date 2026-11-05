import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const display = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

// Loaded with its width axis so silkscreen labels can run condensed (wdth 75).
const ui = Instrument_Sans({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-instrument-sans",
  display: "swap",
});

const code = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VssWarden — Mixed-Criticality VSS Safety Gatekeeper for QNX 8.0 QPP",
  description:
    "The same POSIX writes, run through upstream QPP and VssWarden-patched QPP side by side: COVESA VSS bounds, .control priority leases, io_close_ocb crash recovery and ?warden receipts on QNX Neutrino RTOS 8.0.",
};

export const viewport: Viewport = {
  themeColor: "#08090b",
  colorScheme: "dark",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactNode {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${code.variable}`}>
      <body>{children}</body>
    </html>
  );
}
