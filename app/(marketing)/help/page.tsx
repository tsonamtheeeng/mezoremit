import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { SITE } from "@/lib/client/site";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Help",
  description: "How MezoRemit works: MUSD, claim links, fees, refunds, what is simulated and which countries are supported.",
};

const link = "font-medium text-brand-ink underline underline-offset-4";

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is MUSD?",
    a: (
      <>
        MUSD is a digital dollar on Mezo, a Bitcoin network. One MUSD is designed to be worth about one US dollar. People get it by borrowing against their BTC on
        Mezo. On testnet you can get it free at{" "}
        <a className={link} href={SITE.musdUrl} target="_blank" rel="noreferrer">
          testnet.mezo.org
        </a>
        .
      </>
    ),
  },
  {
    q: "What is a claim link?",
    a: "A private link that holds the key to money you locked on Mezo. Whoever opens it can connect a wallet and claim the MUSD. Use it when you don't know your recipient's wallet address. The secret part of the link is created in your browser and never reaches our servers.",
  },
  {
    q: "What does it cost?",
    a: "On testnet, MezoRemit charges no service fee (0.00 MUSD). Sending needs a small network fee, paid in BTC from your wallet; your wallet shows the exact amount before you confirm. When MezoRemit can cover it, claiming is free for the recipient. Local-currency amounts are only a guide, and any exchange markup is shown on the review screen.",
  },
  {
    q: "What if a claim link leaks?",
    a: "Anyone with the link can claim the money, so treat it like cash. If you think someone else has it, open the transfer and cancel it. As long as nobody has claimed it yet, the MUSD goes straight back to your wallet. We can't recover or reissue a lost link.",
  },
  {
    q: "How do refunds work?",
    a: "Every claim link has an expiry you choose. If nobody claims it in time, you can refund it from the transfer page, and the MUSD always goes back to the wallet that sent it. You can also cancel any time before it's claimed. Direct sends to a wallet can't be reversed.",
  },
  {
    q: "What is real and what is simulated?",
    a: "Real: the MUSD transfer, locking, claiming, cancelling and refunding all happen on Mezo Testnet, and you can check every step on the explorer. Simulated: local-currency payouts (to a bank or cash pickup) are a sandbox demo. No bank is involved and no money moves. They're always labelled \"Simulated\".",
  },
  {
    q: "Which countries are supported?",
    a: "Your recipient can get MUSD anywhere they can use a Mezo wallet. Mexico and the Philippines also have a simulated local payout demo. India is MUSD-only for now.",
  },
  {
    q: "Is this real money?",
    a: "No. MezoRemit runs on Mezo Testnet only. Test MUSD and test BTC have no value. Don't send anything you think is real money. A live service would need licences and a regulated payout partner first.",
  },
  {
    q: "Do you hold my money?",
    a: "No. Direct sends go straight from your wallet to theirs. Claim links lock the MUSD in a public contract that only the link or you (by cancelling) can release. There are no admin keys that can move it, and we never see the claim link's secret.",
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="font-display text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">Help</h1>
      <p className="mt-2 text-muted-foreground">Short answers to the questions people ask most.</p>
      <div className="mt-8 divide-y rounded-xl border bg-card">
        {FAQ.map((f) => (
          <details key={f.q} className="group px-4 py-1 sm:px-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3.5 font-medium [&::-webkit-details-marker]:hidden">
              {f.q}
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="pb-4 text-sm leading-relaxed text-muted-foreground">{f.a}</div>
          </details>
        ))}
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-4">
        <Button asChild>
          <Link href="/send">Send money</Link>
        </Button>
        <a className={link} href={SITE.docsUrl} target="_blank" rel="noreferrer">
          Read the Mezo docs
        </a>
      </div>
    </div>
  );
}
