import Link from "next/link";
import { ArrowRight, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/client/site";
import { Countries } from "@/components/landing/countries";
import { HeroPreview } from "@/components/landing/hero-preview";
import { COUNTRIES } from "@/lib/corridors";
import { currencySymbol } from "@/lib/client/format";

const HERO_CURRENCIES = [...new Set(COUNTRIES.map((c) => c.currency))];

const STEPS = [
  {
    title: "Send",
    body: "Pick a country, an amount in MUSD and who it's for. You see every fee before you confirm.",
  },
  {
    title: "Fund on Mezo",
    body: "Your wallet sends the MUSD. It goes straight to their wallet, or is locked for a claim link you can cancel.",
  },
  {
    title: "They receive it",
    body: "They get MUSD in their own wallet. With a claim link, they open it, connect a wallet and claim.",
  },
];

export default function Landing() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-16 sm:px-6 md:pt-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div>
          <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-[3.5rem]">
            Send money across borders. Without the usual friction.
          </h1>
          <p className="mt-5 max-w-[34rem] text-lg leading-relaxed text-muted-foreground">
            Send MUSD on Mezo with clear fees, simple claim links and settlement anyone can check.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/send">
                Send money <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#how-it-works">See how it works</Link>
            </Button>
          </div>
          <div className="mt-10">
            <p className="text-[0.8125rem] text-muted-foreground">Send MUSD to people who spend</p>
            <ul aria-label="Destination currencies" className="mt-2.5 flex flex-wrap gap-2">
              {HERO_CURRENCIES.map((cur) => (
                <li key={cur} className="num flex items-center gap-1.5 rounded-lg border bg-card py-1.5 pr-2.5 pl-1.5 text-sm shadow-[0_1px_0_oklch(0.3_0.01_85/0.04)]">
                  <span aria-hidden className="flex h-6 min-w-6 items-center justify-center rounded-md bg-brand-soft px-1 font-display text-[0.8125rem] font-semibold text-brand-ink">
                    {currencySymbol(cur)}
                  </span>
                  <span className="font-medium tracking-wide">{cur}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <HeroPreview />
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-y bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.03em]">How a transfer works</h2>
          <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative">
                <div className="flex items-center gap-3">
                  <span className="num flex size-9 items-center justify-center rounded-full bg-brand font-display text-sm font-semibold text-brand-foreground">
                    {i + 1}
                  </span>
                  {i < STEPS.length - 1 ? <span aria-hidden className="hidden h-px flex-1 bg-border md:block" /> : null}
                </div>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-10 max-w-2xl text-sm text-muted-foreground">
            Every step that happens on Mezo is marked <span className="font-medium text-ok">Verified on Mezo</span> with a link to the explorer, so you never have to take our word for it.
          </p>
        </div>
      </section>

      {/* Claim links */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.03em]">Don&apos;t know their wallet? Send a link.</h2>
          <p className="mt-3 text-muted-foreground">
            A claim link works like an envelope with cash inside. You send it in any private chat. They open it and claim the money to a wallet they control.
          </p>
        </div>
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-2">
          <div className="bg-card p-6">
            <h3 className="font-semibold">For you</h3>
            <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
              <li>Choose when the link expires: 24 hours, 7 days or 30 days.</li>
              <li>Cancel any time before it&apos;s claimed and the MUSD comes back.</li>
              <li>Not claimed in time? Refund it to your wallet.</li>
              <li>Track it live, from locked to claimed.</li>
            </ul>
          </div>
          <div className="bg-card p-6">
            <h3 className="font-semibold">For them</h3>
            <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
              <li>One link. No account to create with us.</li>
              <li>See who sent it and their message, if you chose to share them.</li>
              <li>Claiming is free when MezoRemit can cover the network fee.</li>
              <li>The money lands in their own wallet, not with us.</li>
            </ul>
          </div>
        </div>
        <p className="mt-5 max-w-2xl text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Treat a claim link like cash.</span> Whoever opens it first can claim it, and we can&apos;t recover a lost one. If it leaks, cancel it.
        </p>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-y bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1fr_26rem] md:py-20">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-[-0.03em]">Every cost, before you send</h2>
            <p className="mt-3 max-w-md text-muted-foreground">
              The review screen lists each line. Nothing is added after you confirm.
            </p>
          </div>
          <dl className="divide-y rounded-xl border bg-card px-5 text-sm shadow-panel">
            <div className="flex justify-between gap-4 py-3.5">
              <dt className="text-muted-foreground">Service fee (testnet)</dt>
              <dd className="num font-medium">0.00 MUSD</dd>
            </div>
            <div className="flex justify-between gap-4 py-3.5">
              <dt className="text-muted-foreground">Network fee</dt>
              <dd className="text-right">
                Paid in BTC
                <span className="block text-[0.8125rem] text-muted-foreground">Shown by your wallet before you confirm</span>
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-3.5">
              <dt className="text-muted-foreground">Recipient receives</dt>
              <dd className="font-medium">The MUSD you send, minus the service fee</dd>
            </div>
            <div className="flex justify-between gap-4 py-3.5">
              <dt className="text-muted-foreground">Local-currency amount</dt>
              <dd className="text-right">
                Indicative only
                <span className="block text-[0.8125rem] text-muted-foreground">Reference rate, provider rate and markup shown</span>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Countries */}
      <section id="countries" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <h2 className="font-display text-3xl font-semibold tracking-[-0.03em]">Where it works</h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Recipients everywhere below get MUSD on Mezo. Local payouts to a bank or cash pickup are a sandbox demo for now, and no money moves.
        </p>
        <div className="mt-8">
          <Countries />
        </div>
      </section>

      {/* Security */}
      <section className="border-t">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[20rem_1fr] md:py-20">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.03em]">Built so we can&apos;t touch your money</h2>
          <ul className="space-y-7">
            <li className="flex gap-4">
              <ShieldCheck className="mt-0.5 size-6 shrink-0 text-brand" aria-hidden />
              <div>
                <h3 className="font-semibold">No pooled funds</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Direct sends go wallet to wallet. Each claim link locks its own MUSD in a public contract on Mezo. We never hold a balance for you.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <KeyRound className="mt-0.5 size-6 shrink-0 text-brand" aria-hidden />
              <div>
                <h3 className="font-semibold">No admin keys</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Nobody, including us, can pause, freeze or redirect a transfer. Only the claim link can claim, and only you can cancel.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <EyeOff className="mt-0.5 size-6 shrink-0 text-brand" aria-hidden />
              <div>
                <h3 className="font-semibold">The claim key stays in the link</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  It&apos;s created in your browser and kept in the part of the link that browsers never send to a server. We can&apos;t see it or claim with it.
                </p>
              </div>
            </li>
          </ul>
        </div>
      </section>

      {/* Testnet */}
      <section className="bg-brand-soft">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.025em]">This is a testnet demo</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Everything runs on Mezo Testnet with test BTC and test MUSD, which have no value. You&apos;ll need both to try it:{" "}
              <a href={SITE.btcFaucetUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-ink underline underline-offset-4">
                testnet BTC
              </a>{" "}
              for the network fee and{" "}
              <a href={SITE.musdUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-ink underline underline-offset-4">
                testnet MUSD
              </a>{" "}
              (borrowed against BTC) to send.
            </p>
          </div>
          <Button asChild size="lg" className="shrink-0">
            <Link href="/send">
              Send money <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
