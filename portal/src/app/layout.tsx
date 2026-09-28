import type { Metadata, Viewport } from "next";
import { Caveat, Oswald, Space_Grotesk, Space_Mono } from "next/font/google";
import "./globals.css";

const oswald = Oswald({ subsets: ["latin"], variable: "--font-oswald", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });
const mono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap" });

export const metadata: Metadata = {
  title: { default: "MFG Portal", template: "%s · MFG Portal" },
  description: "Restructure. Rebuild. Rise. Your Money. Your Future. Your Plan.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#04070C",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-ZA" className={`${oswald.variable} ${grotesk.variable} ${mono.variable} ${caveat.variable}`}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <div className="wrap">
          <main id="main">{children}</main>
          <footer className="site">
            Education, not financial advice. MFG teaches money skills. We do not give financial advice or sell
            financial products.
            <br />
            <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
