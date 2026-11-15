"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleAlert, CircleCheck, Loader2, Wallet } from "lucide-react";
import type { TxState } from "@/hooks/use-tx";
import { SITE } from "@/lib/client/site";
import { cn } from "@/lib/client/utils";
import { TxLink } from "./address";

/** Plain words for each phase. Exported for tests. */
export function txPhaseText(state: TxState): string {
  switch (state.phase) {
    case "idle":
      return "";
    case "wallet":
      if (state.ask === "none") return "Preparing. No wallet action needed.";
      return state.ask === "signature" ? "Check your wallet and sign. Signing is free." : "Check your wallet and confirm the transaction.";
    case "submitted":
      return "Sent. Waiting for Mezo Testnet to include it. This usually takes a few seconds.";
    case "verifying":
      return "Included on Mezo. Confirming and updating your transfer.";
    case "confirmed":
      return state.recordError ? `Confirmed on Mezo. MezoRemit will catch up shortly (${state.recordError}).` : "Confirmed on Mezo.";
    case "error":
      return state.error ? `${state.error.title}. ${state.error.message}` : "Something went wrong.";
  }
}

/** The one place every transaction's progress is shown. Announced to screen readers. */
export function TxPanel({ state, description, className }: { state: TxState; description?: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const busy = state.phase === "wallet" || state.phase === "submitted" || state.phase === "verifying";
  const showDescription = description && (state.phase === "idle" || state.phase === "error");
  const err = state.error;

  return (
    <div className={cn("space-y-2", className)}>
      {showDescription ? (
        <div className="flex gap-2.5 rounded-lg bg-surface px-3 py-2.5 text-sm text-muted-foreground">
          <Wallet className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">{description}</div>
        </div>
      ) : null}
      <div aria-live="polite" role="status" className="sr-only">
        {state.phase !== "idle" ? `${state.label}: ${txPhaseText(state)}` : ""}
      </div>
      <AnimatePresence initial={false}>
        {state.phase !== "idle" ? (
          <motion.div
            key="tx"
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
            className={cn(
              "rounded-lg border px-3 py-3 text-sm",
              state.phase === "error" ? "border-bad/35 bg-bad-soft" : state.phase === "confirmed" ? "border-ok/30 bg-ok-soft" : "bg-card",
            )}
          >
            <div className="flex items-start gap-2.5">
              {busy ? (
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-brand" aria-hidden />
              ) : state.phase === "error" ? (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
              ) : (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {state.label}
                  {state.progress ? <span className="font-normal text-muted-foreground"> ({state.progress})</span> : null}
                </p>
                <p className="text-muted-foreground">{txPhaseText(state)}</p>
                {err?.kind === "funds_btc" ? (
                  <p className="mt-1">
                    <a href={SITE.btcFaucetUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-ink underline underline-offset-4">
                      Get testnet BTC
                    </a>
                  </p>
                ) : err?.kind === "funds_musd" ? (
                  <p className="mt-1">
                    <a href={SITE.musdUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-ink underline underline-offset-4">
                      Get testnet MUSD
                    </a>
                  </p>
                ) : null}
                {state.hash ? <TxLink hash={state.hash} label="View on the Mezo explorer" className="mt-1" /> : null}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
