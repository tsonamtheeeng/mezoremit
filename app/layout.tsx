import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Public_Sans, Schibsted_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import { NetworkBanner, TestnetBanner } from "@/components/shell/banners";
import { SITE } from "@/lib/client/site";
import "./globals.css";

const ui = Public_Sans({ subsets: ["latin"], variable: "--ff-ui", display: "swap" });
const display = Schibsted_Grotesk({ subsets: ["latin"], variable: "--ff-display", display: "swap", weight: ["500", "600", "700"] });
const code = IBM_Plex_Mono({ subsets: ["latin"], variable: "--ff-code", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name}: ${SITE.tagline}`, template: `%s | ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: ["remittance", "send money", "MUSD", "Mezo", "claim link", "stablecoin", "testnet"],
  openGraph: { type: "website", siteName: SITE.name, title: `${SITE.name}: ${SITE.tagline}`, description: SITE.description, url: "/" },
  twitter: { card: "summary_large_image", title: `${SITE.name}: ${SITE.tagline}`, description: SITE.description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#fbfaf8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${ui.variable} ${display.variable} ${code.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <a
          href="#main"
          className="sr-only rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[var(--z-modal)]"
        >
          Skip to content
        </a>
        <Providers>
          <TestnetBanner />
          <NetworkBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
