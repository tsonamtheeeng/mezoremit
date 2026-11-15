import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { WalletButton } from "@/components/wallet/wallet-button";

/** Claim links carry a secret in the URL fragment: no referrer, no indexing. */
export const metadata: Metadata = {
  title: "Claim money",
  description: "Someone sent you MUSD on Mezo. Open the link to claim it.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function ClaimLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="MezoRemit home" rel="noreferrer" className="rounded-md">
            <Logo />
          </Link>
          <WalletButton />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {children}
      </main>
    </>
  );
}
