"use client";

import { useCountries } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/shared/states";
import { SimulatedTag } from "@/components/shared/simulated-note";
import { currencySymbol } from "@/lib/client/format";

export function Countries() {
  const q = useCountries();
  const list = q.data?.countries ?? [];
  if (q.isLoading) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }
  if (q.isError) return <QueryError error={q.error} what="the country list" onRetry={() => q.refetch()} />;
  return (
    <ul className="grid gap-x-8 sm:grid-cols-2">
      {list.map((c) => (
        <li key={c.code} className="flex items-start gap-4 border-b py-4">
          <span
            aria-hidden
            className="num flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border bg-card px-2 font-display text-[0.9375rem] font-semibold tracking-[-0.02em] text-brand-ink"
          >
            {currencySymbol(c.currency)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2 font-medium">
              {c.name}
              <span className="num text-[0.8125rem] font-normal tracking-wide text-muted-foreground">{c.currency}</span>
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {c.support === "sandbox_payout" ? "MUSD on Mezo. Local payout: sandbox demo only." : c.note ?? "MUSD on Mezo only."}
            </p>
          </div>
          {c.support === "sandbox_payout" ? <SimulatedTag className="mt-0.5 shrink-0" /> : null}
        </li>
      ))}
    </ul>
  );
}
