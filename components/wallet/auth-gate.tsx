"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CircleCheck } from "lucide-react";
import { describeTxError } from "@/lib/client/errors";
import { shortAddress } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";
import { useMounted } from "@/hooks/use-mounted";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectDialog } from "./connect-dialog";

/** Connect → switch network → sign in. Shared by the gate and the /signin page. */
export function SignInSteps({ onSignedIn }: { onSignedIn?: () => void }) {
  const auth = useAuth();
  const w = auth.wallet;
  const [open, setOpen] = useState(false);
  const step = !w.isConnected ? 1 : w.network.kind === "wrong-network" ? 2 : 3;
  const items = ["Connect your wallet", "Switch to Mezo Testnet", "Sign in (free, no transaction)"];

  return (
    <div>
      <ol className="space-y-2.5 text-sm" aria-label="Sign-in steps">
        {items.map((t, i) => {
          const done = i + 1 < step;
          const current = i + 1 === step;
          return (
            <li key={t} className="flex items-center gap-3" aria-current={current ? "step" : undefined}>
              {done ? (
                <CircleCheck className="size-6 text-ok" aria-hidden />
              ) : (
                <span
                  className={cn(
                    "num flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                    current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
              )}
              <span className={current ? "font-medium" : "text-muted-foreground"}>
                {t}
                {done ? <span className="sr-only"> (done)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-6 space-y-3">
        {step === 1 ? (
          <>
            <Button size="lg" onClick={() => setOpen(true)}>
              Connect wallet
            </Button>
            <ConnectDialog open={open} onOpenChange={setOpen} />
          </>
        ) : step === 2 ? (
          <Button size="lg" disabled={w.isSwitching} onClick={() => w.switchToMezo().catch((e) => toast.error(describeTxError(e).message))}>
            {w.isSwitching ? "Check your wallet…" : "Switch to Mezo Testnet"}
          </Button>
        ) : (
          <>
            <Button
              size="lg"
              disabled={auth.signIn.isPending}
              onClick={() =>
                auth.signIn.mutate(undefined, {
                  onSuccess: () => onSignedIn?.(),
                  onError: (e) => {
                    const m = describeTxError(e);
                    toast.error(m.kind === "rejected" ? "Sign-in cancelled" : "Sign-in failed", { description: m.message });
                  },
                })
              }
            >
              {auth.signIn.isPending ? "Check your wallet…" : "Sign in"}
            </Button>
            <p className="text-[0.8125rem] text-muted-foreground">
              Connected as <span className="font-mono">{shortAddress(w.address)}</span>
              {auth.mismatch ? ". You were signed in with a different wallet, so sign in again." : "."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Renders children only for a signed-in wallet; otherwise walks the person through connect → switch → sign. */
export function AuthGate({ children, title = "Sign in to continue", body }: { children: ReactNode; title?: string; body?: string }) {
  const mounted = useMounted();
  const auth = useAuth();

  if (!mounted || auth.sessionLoading) {
    return (
      <div className="mx-auto w-full max-w-md space-y-3 py-12" aria-busy="true">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-10 w-40" />
      </div>
    );
  }
  if (auth.signedIn) return <>{children}</>;

  return (
    <div className="mx-auto w-full max-w-md py-10 sm:py-16">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.025em]">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body ?? "Your wallet is your login. Signing in is free and doesn't send a transaction."}</p>
      {auth.sessionError ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          We can&apos;t reach MezoRemit right now. You can still connect, but sign-in may fail.
        </p>
      ) : null}
      <div className="mt-6">
        <SignInSteps />
      </div>
    </div>
  );
}
