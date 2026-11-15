import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, isUnauthenticated } from "@/lib/client/api";
import { cn } from "@/lib/client/utils";

export function EmptyState({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-dashed px-5 py-10 text-center", className)}>
      <p className="font-medium">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function QueryError({ error, onRetry, what = "this", className }: { error: unknown; onRetry?: () => void; what?: string; className?: string }) {
  const msg = isUnauthenticated(error) ? "Your session ended. Sign in again." : errorMessage(error);
  return (
    <div role="alert" className={cn("flex items-start gap-2.5 rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm", className)}>
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Couldn&apos;t load {what}.</p>
        <p className="text-muted-foreground">{msg}</p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function RowsSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("divide-y rounded-xl border bg-card", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export function PageHeader({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-[-0.025em] sm:text-[1.75rem]">{title}</h1>
        {body ? <p className="mt-1 max-w-prose text-sm text-muted-foreground">{body}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
