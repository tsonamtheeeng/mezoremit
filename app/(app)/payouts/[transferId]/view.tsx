"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, CircleDashed, CircleX, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { PayoutRequest } from "@/lib/api-types";
import { errorMessage } from "@/lib/client/api";
import { currencyTag, formatDateTime, localMoney, musd } from "@/lib/client/format";
import { PAYOUT_COPY, payoutSteps } from "@/lib/client/status";
import { cn } from "@/lib/client/utils";
import { useAuth } from "@/hooks/use-auth";
import { useCreatePayout, usePayout, usePayoutOptions, useTransfer } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthGate } from "@/components/wallet/auth-gate";
import { PageHeader, QueryError } from "@/components/shared/states";
import { SimulatedNote, SimulatedTag } from "@/components/shared/simulated-note";
import { ToneText } from "@/components/shared/status-badge";
import { Choice } from "@/components/send/choice";

function Lifecycle({ payout }: { payout: PayoutRequest }) {
  const steps = payoutSteps(payout.status);
  return (
    <div className="sim-frame rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Simulated payout</h2>
        <ToneText tone={PAYOUT_COPY[payout.status].tone}>{PAYOUT_COPY[payout.status].label}</ToneText>
      </div>
      <p className="num mt-2 font-display text-2xl font-semibold">{localMoney(payout.payoutAmount, payout.destinationCurrency)}</p>
      <p className="text-[0.8125rem] text-muted-foreground">Pretend amount. Nobody will receive this money.</p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Payout progress">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-sm" aria-current={s.state === "current" ? "step" : undefined}>
            {s.state === "done" ? (
              <CircleCheck className="size-5 text-ok" aria-hidden />
            ) : s.state === "failed" ? (
              <CircleX className="size-5 text-bad" aria-hidden />
            ) : s.state === "current" ? (
              <Loader2 className="size-5 animate-spin text-sim" aria-hidden />
            ) : (
              <CircleDashed className="size-5 text-idle" aria-hidden />
            )}
            <span className={cn(s.state === "todo" && "text-muted-foreground")}>{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {payout.statusDetail ?? PAYOUT_COPY[payout.status].text}
      </p>
      <dl className="mt-3 grid gap-1 text-[0.8125rem] text-muted-foreground">
        {payout.providerReference ? (
          <div>
            <dt className="inline">Sandbox reference: </dt>
            <dd className="inline font-mono">{payout.providerReference}</dd>
          </div>
        ) : null}
        <div>
          <dt className="inline">Last update: </dt>
          <dd className="inline">{formatDateTime(payout.updatedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Body({ transferId }: { transferId: string }) {
  const auth = useAuth();
  const tq = useTransfer(auth.signedIn ? transferId : null);
  const t = tq.data?.transfer;
  const received = t && t.role === "recipient" && (t.status === "claimed" || t.status === "completed");
  const opts = usePayoutOptions(transferId, Boolean(received));
  const create = useCreatePayout();
  const [created, setCreated] = useState<PayoutRequest | null>(null);
  const payoutId = created?.id ?? t?.payout?.id ?? null;
  const pq = usePayout(payoutId);
  const payout = pq.data?.payout ?? created ?? t?.payout ?? null;
  const [provider, setProvider] = useState<string>("");

  return (
    <>
      <Link href={`/transfers/${transferId}`} className="-ml-2 mb-4 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Back to transfer
      </Link>
      <PageHeader title="Cash out options" />
      <SimulatedNote className="mb-6">
        This page shows how a local payout could work. It&apos;s a sandbox: no bank, no cash pickup, no real currency. Your MUSD stays in your wallet.
      </SimulatedNote>

      {tq.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : tq.isError || !t ? (
        <QueryError error={tq.error} what="this transfer" onRetry={() => tq.refetch()} />
      ) : !received ? (
        <p className="text-sm text-muted-foreground">
          {t.role !== "recipient" ? "Only the person who received this transfer can try a payout." : "This transfer hasn't arrived yet. You can cash out once it's claimed or delivered."}
        </p>
      ) : payout ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">For the {musd(t.amount)} you received.</p>
          <Lifecycle payout={payout} />
          {pq.isError ? <QueryError error={pq.error} what="the payout status" onRetry={() => pq.refetch()} /> : null}
        </div>
      ) : opts.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : opts.isError ? (
        <QueryError error={opts.error} what="payout options" onRetry={() => opts.refetch()} />
      ) : (opts.data?.options ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">There are no payout options for this country. Your MUSD stays in your wallet on Mezo.</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!provider) return toast.error("Choose an option first.");
            create.mutate(
              { transferId, provider, quoteId: t.quote?.id ?? null },
              { onSuccess: (r) => setCreated(r.payout), onError: (err) => toast.error("Couldn't start the simulation", { description: errorMessage(err) }) },
            );
          }}
        >
          <p className="text-sm text-muted-foreground">For the {musd(t.amount)} you received.</p>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Choose a provider</legend>
            {opts.data!.options.map((o) => (
              <Choice
                key={o.provider}
                name="provider"
                value={o.provider}
                checked={provider === o.provider}
                onChange={setProvider}
                title={
                  <span className="inline-flex items-center gap-2">
                    {o.providerLabel}
                    {o.simulated ? <SimulatedTag /> : null}
                  </span>
                }
                body={
                  <>
                    {o.methods.join(", ")} · {currencyTag(o.currency)}
                    {o.kycRequired ? " · ID check required" : ""}
                    <span className="mt-0.5 block">{o.note}</span>
                  </>
                }
              />
            ))}
          </fieldset>
          <Button type="submit" size="lg" disabled={create.isPending || !provider}>
            {create.isPending ? "Starting…" : "Start simulated payout"}
          </Button>
        </form>
      )}
    </>
  );
}

export function PayoutView({ transferId }: { transferId: string }) {
  return (
    <div className="mx-auto max-w-xl">
      <AuthGate title="Sign in to see cash out options">
        <Body transferId={transferId} />
      </AuthGate>
    </div>
  );
}
