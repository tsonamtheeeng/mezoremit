import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { WalletButton } from "@/components/wallet/wallet-button";
import { Button } from "@/components/ui/button";

/** Marketing header (landing, help). The app area uses <AppShell>. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="MezoRemit home" className="rounded-md">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          <Link href="/#how-it-works" className="hover:text-foreground">How it works</Link>
          <Link href="/#pricing" className="hover:text-foreground">Pricing</Link>
          <Link href="/#countries" className="hover:text-foreground">Countries</Link>
          <Link href="/help" className="hover:text-foreground">Help</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/dashboard" className="hidden px-2 text-sm text-muted-foreground hover:text-foreground sm:inline">
            Activity
          </Link>
          <WalletButton />
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/send">Send money</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
