"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useTransferHistory } from "@/hooks/use-api";
import { filterTransfers, STATUS_FILTERS, type RoleFilter, type StatusFilter } from "@/lib/client/history";
import { Button } from "@/components/ui/button";
import { AuthGate } from "@/components/wallet/auth-gate";
import { EmptyState, PageHeader, QueryError, RowsSkeleton } from "@/components/shared/states";
import { TransferList } from "@/components/transfer/transfer-row";
import { cn } from "@/lib/client/utils";

const ROLES: { id: RoleFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sent", label: "Sent" },
  { id: "received", label: "Received" },
];

function Body() {
  const auth = useAuth();
  const [role, setRole] = useState<RoleFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  // The API filters by role (all | sent | received); status groups are filtered here.
  const q = useTransferHistory({ role }, auth.signedIn);
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.transfers) ?? [], [q.data]);
  const shown = filterTransfers(all, role, status);

  return (
    <>
      <PageHeader title="History" body="Every transfer you sent or received through MezoRemit." />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="radiogroup" aria-label="Direction" className="inline-flex rounded-lg border bg-card p-0.5">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={role === r.id}
              onClick={() => setRole(r.id)}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1.5 text-sm",
                role === r.id ? "bg-brand-soft font-medium text-brand-ink" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {q.isLoading ? (
        <RowsSkeleton rows={5} />
      ) : q.isError ? (
        <QueryError error={q.error} what="your history" onRetry={() => q.refetch()} />
      ) : shown.length ? (
        <TransferList transfers={shown} />
      ) : (
        <EmptyState
          title={all.length ? "No transfers match these filters" : "No transfers yet"}
          action={
            all.length ? (
              <Button
                variant="outline"
                onClick={() => {
                  setRole("all");
                  setStatus("all");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button asChild>
                <Link href="/send">Send money</Link>
              </Button>
            )
          }
        />
      )}

      {q.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            {q.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function HistoryView() {
  return (
    <AuthGate title="Sign in to see your history">
      <Body />
    </AuthGate>
  );
}

