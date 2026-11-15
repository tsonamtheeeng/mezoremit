// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { parseUnits } from "viem";
import type { Country, Quote } from "@/lib/api-types";
import { ReviewSummary } from "@/components/transfer/review-summary";

afterEach(cleanup);

const mx: Country = { code: "MX", name: "Mexico", currency: "MXN", support: "sandbox_payout" };
const quote: Quote = {
  id: "q1",
  kind: "indicative",
  sourceCurrency: "MUSD",
  sourceAmount: parseUnits("25", 18).toString(),
  destinationCurrency: "MXN",
  referenceRate: "17.0412",
  providerRate: "16.7856",
  fxMarkupBps: 150,
  serviceFee: "0",
  networkFeeNote: "Paid in BTC by the sender",
  recipientAmountMusd: parseUnits("25", 18).toString(),
  recipientAmountLocal: "419.64",
  provider: "sandbox",
  providerLabel: "MezoRemit Sandbox (simulated)",
  rateSource: "open.er-api.com",
  rateTimestamp: "2026-11-10T00:00:00Z",
  expiresAt: "2026-11-10T00:01:00Z",
  createdAt: "2026-11-10T00:00:00Z",
};

function row(id: string) {
  const el = document.querySelector(`[data-row="${id}"]`);
  if (!el) throw new Error(`missing row ${id}`);
  return el as HTMLElement;
}

describe("<ReviewSummary>", () => {
  it("shows every fee line", () => {
    render(
      <ReviewSummary
        recipientLabel="Ana Reyes"
        country={mx}
        countryCode="MX"
        delivery="claim_link"
        amount={parseUnits("25", 18)}
        quote={quote}
        quoteSecondsLeft={42}
        expiryLabel="7 days"
      />,
    );
    expect(within(row("recipient")).getByText("Ana Reyes")).toBeTruthy();
    expect(within(row("destination")).getByText("Mexico")).toBeTruthy();
    expect(within(row("amount")).getByText("25.00 MUSD")).toBeTruthy();
    expect(within(row("network")).getByText(/Mezo/)).toBeTruthy();
    expect(within(row("service-fee")).getByText("0.00 MUSD")).toBeTruthy();
    expect(within(row("network-fee")).getByText(/Paid by you in BTC/)).toBeTruthy();
    expect(within(row("receives")).getByText("25.00 MUSD")).toBeTruthy();
    expect(within(row("expiry")).getByText("7 days")).toBeTruthy();
    expect(screen.getByText("Reference rate")).toBeTruthy();
    expect(screen.getByText(/Provider rate/)).toBeTruthy();
    expect(screen.getByText("1.5%")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Rates By Exchange Rate API" })).toBeTruthy();
    expect(screen.getByText(/Rate shown for 0:42/)).toBeTruthy();
    expect(screen.getByText(/Indicative only/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bgas\b/i);
  });

  it("labels the sandbox payout and handles a missing quote", () => {
    render(
      <ReviewSummary
        recipientLabel="Ana"
        country={mx}
        countryCode="MX"
        delivery="local_payout_sandbox"
        amount={parseUnits("10", 18)}
        quote={null}
        quoteError="Couldn't get today's rate."
      />,
    );
    expect(screen.getAllByText("Simulated").length).toBeGreaterThan(0);
    expect(within(row("service-fee")).getByText("0.00 MUSD")).toBeTruthy();
    expect(within(row("receives")).getByText("10.00 MUSD")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/today's rate/);
  });

  it("says when the rate expired", () => {
    render(<ReviewSummary recipientLabel="Ana" country={mx} countryCode="MX" delivery="claim_link" amount={1n} quote={quote} quoteSecondsLeft={0} />);
    expect(screen.getByText(/rate has expired/)).toBeTruthy();
  });
});
