"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useMarkNotificationsRead, useNotifications } from "@/hooks/use-api";
import { relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";
import { Button } from "@/components/ui/button";
import { AuthGate } from "@/components/wallet/auth-gate";
import { EmptyState, PageHeader, QueryError, RowsSkeleton } from "@/components/shared/states";

const EMAIL_TEXT = { not_configured: null, queued: "Email queued", sent: "Email sent", failed: "Email couldn't be sent" } as const;

function Body() {
  const auth = useAuth();
  const q = useNotifications(auth.signedIn);
  const mark = useMarkNotificationsRead();
  const list = q.data?.notifications ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        action={
          q.data?.unread ? (
            <Button variant="outline" disabled={mark.isPending} onClick={() => mark.mutate("all")}>
              Mark all as read
            </Button>
          ) : null
        }
      />
      {q.isLoading ? (
        <RowsSkeleton rows={4} />
      ) : q.isError ? (
        <QueryError error={q.error} what="notifications" onRetry={() => q.refetch()} />
      ) : list.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {list.map((n) => {
            const unread = !n.readAt;
            const body = (
              <>
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cn("text-sm", unread ? "font-semibold" : "font-medium")}>
                    {unread ? <span className="sr-only">Unread: </span> : null}
                    {n.title}
                  </span>
                  <time dateTime={n.createdAt} className="shrink-0 text-[0.8125rem] text-muted-foreground">
                    {relativeTime(n.createdAt)}
                  </time>
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>
                {n.email && EMAIL_TEXT[n.email.status] ? <span className="mt-1 block text-xs text-muted-foreground">{EMAIL_TEXT[n.email.status]}</span> : null}
              </>
            );
            const cls = cn("block px-4 py-3.5", unread && "border-l-2 border-l-brand bg-brand-soft/30");
            return (
              <li key={n.id}>
                {n.transferId ? (
                  <Link href={`/transfers/${n.transferId}`} className={cn(cls, "hover:bg-surface")} onClick={() => unread && mark.mutate([n.id])}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No notifications yet" body="We'll let you know here when a transfer is funded, claimed, expires or is refunded." />
      )}
    </>
  );
}

export function NotificationsView() {
  return (
    <AuthGate title="Sign in to see notifications">
      <Body />
    </AuthGate>
  );
}
