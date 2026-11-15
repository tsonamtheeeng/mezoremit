"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useCountries, useRecipientDashboard } from "@/hooks/use-api";
import { useMusdBalance } from "@/hooks/use-musd";
import { musd, relativeTime } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthGate } from "@/components/wallet/auth-gate";
import { EmptyState, PageHeader, QueryError, RowsSkeleton } from "@/components/shared/states";
import { SimulatedTag } from "@/components/shared/simulated-note";
import { TransferList } from "@/components/transfer/transfer-row";

function Body() {
  const auth = useAuth();
  const q = useRecipientDashboard(auth.signedIn);
  const live = useMusdBalance(auth.wallet.address);
  const countries = useCountries();
  const d = q.data;
  const liveBal = live.data as bigint | undefined;
  const sandboxCodes = new Set((countries.data?.countries ?? []).filter((c) => c.support === "sandbox_payout").map((c) => c.code));
  const cashable = (d?.received ?? []).filter((t) => (t.status === "claimed" || t.status === "completed") && sandboxCodes.has(t.destinationCountry) && !t.payout);

  return (
    <>
      <PageHeader title="Received money" body="MUSD sent to this wallet, either directly or through claim links you claimed." />

      <section aria-label="Summary" className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        <div className="bg-card p-5">
          <p className="text-sm text-muted-foreground">Wallet balance (live)</p>
          {liveBal === undefined && live.isLoading ? (
            <Skeleton className="mt-2 h-9 w-36" />
          ) : (
            <p className="num mt-1 font-display text-3xl font-semibold tracking-[-0.03em]">
              {liveBal !== undefined ? musd(liveBal) : d?.musdBalance ? musd(d.musdBalance) : "--"}
            </p>
          )}
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">Read from Mezo Testnet just now.</p>
        </div>
        <div className="bg-card p-5">
          <p className="text-sm text-muted-foreground">Received through MezoRemit</p>
          {q.isLoading ? <Skeleton className="mt-2 h-8 w-32" /> : <p className="num mt-1 font-display text-2xl font-semibold">{d ? musd(d.totals.received) : "--"}</p>}
        </div>
        <div className="bg-card p-5">
          <p className="text-sm text-muted-foreground">Transfers</p>
          {q.isLoading ? <Skeleton className="mt-2 h-8 w-12" /> : <p className="num mt-1 font-display text-2xl font-semibold">{d?.totals.transfers ?? "--"}</p>}
        </div>
      </section>

      {q.isError ? <QueryError className="mt-6" error={q.error} what="received money" onRetry={() => q.refetch()} /> : null}

      {cashable.length ? (
        <section aria-labelledby="cash-h" className="mt-8 rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="cash-h" className="font-semibold">
              Payout options
            </h2>
            <SimulatedTag />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            You can try a simulated cash-out to local currency for these transfers. It&apos;s a sandbox demo and no real money moves.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {cashable.slice(0, 4).map((t) => (
              <li key={t.id}>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/payouts/${t.id}`}>
                    {musd(t.amount)}, {relativeTime(t.settledAt ?? t.createdAt)}
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="recv-h" className="mt-8">
        <h2 id="recv-h" className="mb-3 font-semibold">
          Transfers to you
        </h2>
        {q.isLoading ? (
          <RowsSkeleton rows={3} />
        ) : d && d.received.length ? (
          <TransferList transfers={d.received} />
        ) : d ? (
          <EmptyState title="Nothing received yet" body="When someone sends MUSD to this wallet, or you claim a link, it shows up here." />
        ) : null}
      </section>
    </>
  );
}

export function ReceivedView() {
  return (
    <AuthGate title="Sign in to see money you received">
      <Body />
    </AuthGate>
  );
}
