"use client";

import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-background font-sans text-foreground antialiased">
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center px-4 py-24">
          <h1 className="text-3xl font-semibold tracking-[-0.025em]">MezoRemit hit an error.</h1>
          <p className="mt-3 text-muted-foreground">Reload the page to try again. Your wallet and any MUSD on Mezo aren&apos;t affected.</p>
          {error.digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
          <button type="button" onClick={reset} className="mt-8 h-9 cursor-pointer rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground">
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
