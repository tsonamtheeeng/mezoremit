"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useMounted } from "@/hooks/use-mounted";
import { SignInSteps } from "@/components/wallet/auth-gate";
import { WalletGuide } from "@/components/wallet/wallet-guide";

export function SignInView({ next }: { next: string }) {
  const mounted = useMounted();
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (mounted && auth.signedIn) router.replace(next);
  }, [mounted, auth.signedIn, next, router]);

  return (
    <div className="mx-auto grid max-w-4xl gap-12 py-6 md:grid-cols-[1fr_1fr] md:py-12">
      <section>
        <h1 className="font-display text-3xl font-semibold tracking-[-0.025em]">Sign in with your wallet</h1>
        <p className="mt-2 text-sm text-muted-foreground">No password, no account form. Signing in is free and doesn&apos;t send a transaction.</p>
        <div className="mt-8">{mounted ? <SignInSteps onSignedIn={() => router.replace(next)} /> : null}</div>
      </section>
      <section aria-labelledby="new-h" className="rounded-xl bg-surface p-5 sm:p-6">
        <h2 id="new-h" className="font-semibold">
          New to wallets?
        </h2>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">Three things to set up once. Everything here is testnet, so nothing costs real money.</p>
        <WalletGuide />
      </section>
    </div>
  );
}
