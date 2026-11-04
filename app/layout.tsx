import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "VssWarden — QNX 8.0 QPP Verification Studio",
  description: "Side-by-Side SDV Verification Studio & Interactive QNX 8.0 Codelab",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
