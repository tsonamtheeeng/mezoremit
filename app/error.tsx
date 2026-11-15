"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center px-4 py-24">
      <h1 className="font-display text-3xl font-semibold tracking-[-0.025em]">Something went wrong.</h1>
      <p className="mt-3 text-muted-foreground">
        This page hit an error. Your wallet and any MUSD on Mezo aren&apos;t affected. Try again, or go back home.
      </p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}
