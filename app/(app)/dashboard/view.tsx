"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useSenderDashboard } from "@/hooks/use-api";
import { useMusdBalance } from "@/hooks/use-musd";
import { musd, shortAddress } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthGate } from "@/components/wallet/auth-gate";
import { EmptyState, PageHeader, QueryError, RowsSkeleton } from "@/components/shared/states";
import { TransferList } from "@/components/transfer/transfer-row";

function Body() {
  const auth = useAuth();
  const q = useSenderDashboard(auth.signedIn);
  const bal = useMusdBalance(auth.wallet.address);
  const d = q.data;

  return (
    <>
      <PageHeader
        title={auth.user?.displayName ? `Hi, ${auth.user.displayName}` : "Your activity"}
        action={
          <Button asChild size="lg">
            <Link href="/send">Send money</Link>
          </Button>
        }
      />

      <section aria-label="Summary" className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-[1.3fr_1fr_1fr]">
        <div className="bg-card p-5">
          <p className="text-sm text-muted-foreground">Sent and delivered</p>
          {q.isLoading ? <Skeleton className="mt-2 h-9 w-40" /> : <p className="num mt-1 font-display text-3xl font-semibold tracking-[-0.03em]">{d ? musd(d.totals.sentCompleted) : "--"}</p>}
          <p className="num mt-1 text-[0.8125rem] text-muted-foreground">
            Wallet balance: {bal.data !== undefined ? musd(bal.data as bigint) : bal.isError ? "unavailable" : "…"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border sm:col-span-2 sm:grid-cols-4">
          {(
            [
              ["In progress", d?.totals.pending],
              ["Completed", d?.totals.completed],
              ["Refunded", d?.totals.refunded],
              ["Failed", d?.totals.failed],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="bg-card p-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              {q.isLoading ? <Skeleton className="mt-2 h-7 w-10" /> : <p className="num mt-1 font-display text-2xl font-semibold">{n ?? "--"}</p>}
            </div>
          ))}
        </div>
      </section>

      {q.isError ? <QueryError className="mt-6" error={q.error} what="your activity" onRetry={() => q.refetch()} /> : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="recent-h">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="recent-h" className="font-semibold">
              Recent transfers
            </h2>
            <Link href="/history" className="text-sm font-medium text-brand-ink hover:underline">
              See all
            </Link>
          </div>
          {q.isLoading ? (
            <RowsSkeleton rows={4} />
          ) : d && d.recent.length ? (
            <TransferList transfers={d.recent} />
          ) : d ? (
            <EmptyState
              title="No transfers yet"
              body="When you send money, it shows up here with its live status."
              action={
                <Button asChild>
                  <Link href="/send">Send your first transfer</Link>
                </Button>
              }
            />
          ) : null}
        </section>

        <section aria-labelledby="people-h">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="people-h" className="font-semibold">
              Recipients
            </h2>
            <Link href="/recipients" className="text-sm font-medium text-brand-ink hover:underline">
              Manage
            </Link>
          </div>
          {q.isLoading ? (
            <RowsSkeleton rows={2} />
          ) : d && d.recipients.length ? (
            <ul className="divide-y rounded-xl border bg-card">
              {d.recipients.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.displayName}</span>
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      {r.country} · {r.walletAddress ? shortAddress(r.walletAddress) : "Claim link"}
                    </span>
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/send">Send</Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : d ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No saved recipients yet. You can save someone while sending.
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}

export function DashboardView() {
  return (
    <AuthGate title="Sign in to see your activity">
      <Body />
    </AuthGate>
  );
}
