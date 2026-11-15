import "./setup-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { addSeconds, clock } from "@/lib/server/clock";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { FRANKFURTER_ATTRIBUTION, OPEN_ER_API_ATTRIBUTION, setFxFetchForTests } from "@/lib/server/fx";
import { createQuote } from "@/lib/server/quotes";
import { createTransfer } from "@/lib/server/transfers";
import { POST as quotePOST } from "@/app/api/quotes/route";
import { E18, RECIPIENT, SENDER, STRANGER, req, sessionFor } from "./fakes";
import { T0 } from "./scenario";

let sql: Sql;
let calls: string[];

function fx(opts: { primary?: "ok" | "fail" | "429"; fallback?: "ok" | "fail" } = {}) {
  calls = [];
  setFxFetchForTests((async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("open.er-api.com")) {
      if (opts.primary === "fail") throw new TypeError("fetch failed");
      if (opts.primary === "429") return new Response("{}", { status: 429 });
      return Response.json({ result: "success", base_code: "USD", time_last_update_unix: 1_900_000_000, rates: { USD: 1, MXN: 18.5824, PHP: 58.1, INR: 84.2 } });
    }
    if (url.includes("frankfurter")) {
      if (opts.fallback === "fail") return new Response("nope", { status: 500 });
      const q = new URL(url).searchParams.get("quotes");
      return Response.json([{ date: "2030-03-17", base: "USD", quote: q, rate: q === "MXN" ? 18.6 : 58.0 }]);
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch);
}

beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
});
afterEach(() => setFxFetchForTests(null));

const amount = (25n * E18).toString();

describe("reference FX + quotes", () => {
  it("sandbox quote: providerRate = reference × (1 − 150 bps), local amount from the provider rate", async () => {
    fx();
    const s = await sessionFor(SENDER);
    const q = await createQuote(sql, s.userId, { amount, destinationCountry: "MX", deliveryMethod: "local_payout_sandbox" });
    expect(q.kind).toBe("indicative");
    expect(q.provider).toBe("sandbox");
    expect(q.providerLabel).toBe("MezoRemit Sandbox (simulated)");
    expect(q.referenceRate).toBe("18.5824");
    expect(q.fxMarkupBps).toBe(150);
    expect(q.providerRate).toBe("18.303664"); // 18.5824 × 0.985
    expect(q.recipientAmountLocal).toBe("457.5916"); // 25 × 18.303664
    expect(q.recipientAmountMusd).toBe(amount);
    expect(q.serviceFee).toBe("0");
    expect(q.rateSource).toBe(OPEN_ER_API_ATTRIBUTION);
    expect(new Date(q.expiresAt).getTime() - T0.getTime()).toBe(60_000);
    expect(q.networkFeeNote).toMatch(/BTC/);
  });

  it("on-chain delivery: no provider rate, no local amount (reference rate is informational)", async () => {
    fx();
    const s = await sessionFor(SENDER);
    const q = await createQuote(sql, s.userId, { amount, destinationCountry: "IN", deliveryMethod: "mezo_wallet" });
    expect(q.provider).toBe("onchain");
    expect(q.providerRate).toBeNull();
    expect(q.recipientAmountLocal).toBeNull();
    expect(q.fxMarkupBps).toBe(0);
    expect(q.referenceRate).toBe("84.2");
  });

  it("falls back to Frankfurter when the primary fails, and caches for an hour", async () => {
    fx({ primary: "429" });
    const s = await sessionFor(SENDER);
    const q = await createQuote(sql, s.userId, { amount, destinationCountry: "MX", deliveryMethod: "claim_link" });
    expect(q.rateSource).toBe(FRANKFURTER_ATTRIBUTION);
    expect(q.referenceRate).toBe("18.6");
    const n = calls.length;
    await createQuote(sql, s.userId, { amount, destinationCountry: "MX", deliveryMethod: "claim_link" });
    expect(calls.length).toBe(n); // primary in back-off, fallback cached
  });

  it("returns 503 rates_unavailable when both sources fail", async () => {
    fx({ primary: "fail", fallback: "fail" });
    const s = await sessionFor(SENDER);
    const res = await quotePOST(req("/api/quotes", { cookie: s.cookie, json: { amount, destinationCountry: "MX", deliveryMethod: "claim_link" } }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("rates_unavailable");
  });

  it("rejects sandbox payout outside MX/PH and excluded countries", async () => {
    fx();
    const s = await sessionFor(SENDER);
    await expect(createQuote(sql, s.userId, { amount, destinationCountry: "US", deliveryMethod: "local_payout_sandbox" })).rejects.toMatchObject({ code: "payout_unsupported" });
    await expect(createQuote(sql, s.userId, { amount, destinationCountry: "NP", deliveryMethod: "mezo_wallet" })).rejects.toMatchObject({
      code: "country_unsupported",
      message: expect.stringMatching(/Nepal Rastra Bank/),
    });
  });
});

describe("quote use on transfer create", () => {
  it("409 quote_expired when expired, someone else's, or for another amount/country", async () => {
    fx();
    const a = await sessionFor(SENDER);
    const b = await sessionFor(STRANGER);
    const q = await createQuote(sql, a.userId, { amount, destinationCountry: "MX", deliveryMethod: "mezo_wallet" });
    const base = { method: "direct", amount, destinationCountry: "MX", recipientWallet: RECIPIENT, quoteId: q.id };
    const reason = async (s: typeof a, over: Record<string, unknown>) => {
      try {
        await createTransfer(sql, s.session, { ...base, idempotencyKey: `k-${Math.random()}`, ...over });
        return "ok";
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).code).toBe("quote_expired");
        return ((e as HttpError).details as { reason: string }).reason;
      }
    };
    expect(await reason(b, {})).toBe("not_found");
    expect(await reason(a, { amount: (26n * E18).toString() })).toBe("amount_mismatch");
    expect(await reason(a, { destinationCountry: "PH" })).toBe("country_mismatch");
    clock.set(() => addSeconds(T0, 61));
    expect(await reason(a, {})).toBe("expired");
    clock.set(() => addSeconds(T0, 30));
    expect(await reason(a, {})).toBe("ok");
  });
});
