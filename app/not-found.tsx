import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/shell/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center px-4 py-24">
        <p className="num text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.025em]">We can&apos;t find that page.</h1>
        <p className="mt-3 text-muted-foreground">The link may be old or mistyped. If someone sent you a claim link, open the full link they shared.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/">Go home</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/help">Help</Link>
          </Button>
        </div>
      </main>
    </>
  );
}
