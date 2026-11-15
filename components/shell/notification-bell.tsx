"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications } from "@/hooks/use-api";
import { useMounted } from "@/hooks/use-mounted";

export function NotificationBell() {
  const mounted = useMounted();
  const auth = useAuth();
  const q = useNotifications(mounted && auth.signedIn);
  if (!mounted || !auth.signedIn) return null;
  const unread = q.data?.unread ?? 0;
  return (
    <Link
      href="/notifications"
      className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <Bell className="size-[1.125rem]" aria-hidden />
      {unread ? (
        <span className="num absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.625rem] leading-4 font-semibold text-brand-foreground">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
