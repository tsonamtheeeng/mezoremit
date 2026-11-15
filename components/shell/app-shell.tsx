"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowDownLeft, Clock, Home, Menu, Send, Users, Settings, Bell, LifeBuoy } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { WalletButton } from "@/components/wallet/wallet-button";
import { NotificationBell } from "./notification-bell";
import { cn } from "@/lib/client/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PRIMARY = [
  { href: "/dashboard", label: "Activity", icon: Home },
  { href: "/send", label: "Send", icon: Send },
  { href: "/received", label: "Received", icon: ArrowDownLeft },
  { href: "/history", label: "History", icon: Clock },
] as const;

const SECONDARY = [
  { href: "/recipients", label: "Recipients", icon: Users },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/help", label: "Help", icon: LifeBuoy },
] as const;

function isActive(path: string, href: string) {
  if (href === "/dashboard") return path === "/dashboard";
  if (href === "/history") return path.startsWith("/history") || path.startsWith("/transfers");
  return path === href || path.startsWith(`${href}/`);
}

export function AppShell({ children, width = "default" }: { children: ReactNode; width?: "default" | "narrow" }) {
  const path = usePathname() ?? "";
  return (
    <>
      <header className="sticky top-0 z-[var(--z-sticky)] border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="MezoRemit home" className="rounded-md">
            <Logo />
          </Link>
          <nav aria-label="App" className="hidden items-center gap-1 text-sm md:flex">
            {[...PRIMARY, SECONDARY[0]].map((n) => {
              const active = isActive(path, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 transition-colors",
                    active ? "bg-brand-soft font-medium text-brand-ink" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <NotificationBell />
            <Link
              href="/settings"
              aria-label="Settings"
              className="hidden size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:inline-flex"
            >
              <Settings className="size-[1.125rem]" aria-hidden />
            </Link>
            <WalletButton />
          </div>
        </div>
      </header>

      <main id="main" className={cn("mx-auto w-full flex-1 px-4 pt-6 pb-28 sm:px-6 md:pb-16", width === "narrow" ? "max-w-2xl" : "max-w-6xl")}>
        {children}
      </main>

      {/* mobile bottom nav */}
      <nav
        aria-label="App"
        className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
      >
        <ul className="grid grid-cols-5">
          {PRIMARY.map((n) => {
            const active = isActive(path, n.href);
            const Icon = n.icon;
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem]", active ? "font-semibold text-brand-ink" : "text-muted-foreground")}
                >
                  <Icon className="size-5" aria-hidden />
                  {n.label}
                </Link>
              </li>
            );
          })}
          <li>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "flex h-16 w-full cursor-pointer flex-col items-center justify-center gap-1 text-[0.6875rem]",
                  SECONDARY.some((n) => isActive(path, n.href)) ? "font-semibold text-brand-ink" : "text-muted-foreground",
                )}
              >
                <Menu className="size-5" aria-hidden />
                More
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-52">
                {SECONDARY.map((n) => (
                  <DropdownMenuItem key={n.href} asChild>
                    <Link href={n.href}>
                      <n.icon aria-hidden /> {n.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        </ul>
      </nav>
    </>
  );
}
