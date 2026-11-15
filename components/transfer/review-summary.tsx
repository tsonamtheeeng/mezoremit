import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { Country, DeliveryMethod, Quote } from "@/lib/api-types";
import { bpsToPercent, countdown, localMoney, musd, rateText } from "@/lib/client/format";
import { recipientReceives } from "@/lib/client/amount";
import { SITE } from "@/lib/client/site";
import { cn } from "@/lib/client/utils";
import { SimulatedTag } from "@/components/shared/simulated-note";

export const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  mezo_wallet: "Straight to their Mezo wallet",
  claim_link: "Claim link",
  local_payout_sandbox: "Local payout (sandbox demo)",
};

function Row({ label, children, strong, id }: { label: string; children: ReactNode; strong?: boolean; id?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2.5", strong && "pt-3.5")} data-row={id}>
      <dt className={cn("text-sm", strong ? "font-semibold" : "text-muted-foreground")}>{label}</dt>
      <dd className={cn("num text-right text-sm", strong && "font-display text-lg font-semibold")}>{children}</dd>
    </div>
  );
}

export interface ReviewSummaryProps {
  recipientLabel: string;
  country: Country | null;
  countryCode: string;
  delivery: DeliveryMethod;
  amount: bigint;
  quote: Quote | null;
  quoteLoading?: boolean;
  quoteError?: string | null;
  /** seconds until the quote expires (null if no quote) */
  quoteSecondsLeft?: number | null;
  onRefreshQuote?: () => void;
  expiryLabel?: string | null;
}

/** Every fee line, in plain words. Used on the review step and (read-only) in tests. */
export function ReviewSummary(p: ReviewSummaryProps) {
  const fee = p.quote ? BigInt(p.quote.serviceFee) : 0n;
  const receives = p.quote ? BigInt(p.quote.recipientAmountMusd) : recipientReceives(p.amount, fee);
  const q = p.quote;
  const expired = p.quoteSecondsLeft !== null && p.quoteSecondsLeft !== undefined && p.quoteSecondsLeft <= 0;
  const destCurrency = q?.destinationCurrency ?? p.country?.currency ?? "";

  return (
    <div className="space-y-5">
      <dl className="divide-y rounded-xl border bg-card px-4">
        <Row label="Recipient" id="recipient">
          <span className="font-medium">{p.recipientLabel}</span>
        </Row>
        <Row label="Destination" id="destination">
          {p.country ? `${p.country.name}` : p.countryCode}
        </Row>
        <Row label="Delivery" id="delivery">
          <span className="inline-flex items-center gap-2">
            {DELIVERY_LABEL[p.delivery]}
            {p.delivery === "local_payout_sandbox" ? <SimulatedTag /> : null}
          </span>
        </Row>
        {p.expiryLabel ? (
          <Row label="Link expires after" id="expiry">
            {p.expiryLabel}
          </Row>
        ) : null}
      </dl>

      <dl className="divide-y rounded-xl border bg-card px-4" aria-label="Cost breakdown">
        <Row label="Transfer amount" id="amount">
          {musd(p.amount)}
        </Row>
        <Row label="Network" id="network">
          Mezo (testnet)
        </Row>
        <Row label="Service fee" id="service-fee">
          {musd(fee)}
        </Row>
        <Row label="Network fee" id="network-fee">
          <span className="block">Paid by you in BTC</span>
          <span className="block text-[0.8125rem] text-muted-foreground">Your wallet shows the exact amount before you confirm.</span>
        </Row>
        <Row label="Recipient receives" strong id="receives">
          {musd(receives)}
        </Row>
      </dl>

      <section aria-labelledby="local-heading" className="rounded-xl bg-surface px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="local-heading" className="text-sm font-semibold">
              About {destCurrency ? `${destCurrency} ` : ""}in local money
            </h3>
            <p className="text-[0.8125rem] text-muted-foreground">Indicative only. Your recipient gets MUSD, not {destCurrency || "local currency"}.</p>
          </div>
          {p.onRefreshQuote ? (
            <button
              type="button"
              onClick={p.onRefreshQuote}
              disabled={p.quoteLoading}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[0.8125rem] font-medium text-brand-ink hover:bg-brand-soft disabled:opacity-60"
            >
              <RefreshCw className={cn("size-3.5", p.quoteLoading && "animate-spin")} aria-hidden />
              Refresh rate
            </button>
          ) : null}
        </div>

        {p.quoteError ? (
          <p role="alert" className="mt-2 text-sm text-bad">
            {p.quoteError}
          </p>
        ) : !q ? (
          <p className="mt-2 text-sm text-muted-foreground">{p.quoteLoading ? "Getting today's rate…" : "No rate yet."}</p>
        ) : (
          <dl className="mt-2 space-y-1 text-[0.8125rem]">
            {q.recipientAmountLocal ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">About</dt>
                <dd className="num font-display text-base font-semibold">{localMoney(q.recipientAmountLocal, destCurrency)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Reference rate</dt>
              <dd className="num">{rateText(q.referenceRate, destCurrency)}</dd>
            </div>
            {q.providerRate ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Provider rate ({q.providerLabel})</dt>
                <dd className="num">{rateText(q.providerRate, destCurrency)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Exchange markup</dt>
              <dd className="num">{bpsToPercent(q.fxMarkupBps)}</dd>
            </div>
            <p className="pt-1 text-muted-foreground">
              MUSD is counted as 1 US dollar.{" "}
              <a href={SITE.rateAttributionUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                Rates By Exchange Rate API
              </a>
              .
            </p>
            {p.quoteSecondsLeft !== null && p.quoteSecondsLeft !== undefined ? (
              <p className={cn("num", expired ? "font-medium text-warn" : "text-muted-foreground")} aria-live={expired ? "polite" : "off"}>
                {expired ? "This rate has expired. Refresh to see the latest." : `Rate shown for ${countdown(p.quoteSecondsLeft)}`}
              </p>
            ) : null}
          </dl>
        )}
      </section>
    </div>
  );
}
