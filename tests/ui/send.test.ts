// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Transfer } from "@/lib/api-types";
import { CLAIM_EXPIRY_OPTIONS } from "@/lib/chain/config";
import { forgetClaimKey, loadClaimKey, saveClaimKey } from "@/lib/client/claim-store";
import { filterTransfers } from "@/lib/client/history";
import { checkName, checkNote, checkWallet, deliveryOptions, expiresAtFor, methodFor, quoteSecondsLeft } from "@/lib/client/send";
import { fundingPath } from "@/lib/client/writes";

const W = "0x1234567890abcdef1234567890abcdef12345678";

describe("delivery", () => {
  it("maps delivery choices to on-chain methods", () => {
    expect(methodFor("mezo_wallet", true)).toBe("direct");
    expect(methodFor("claim_link", true)).toBe("claim");
    expect(methodFor("local_payout_sandbox", true)).toBe("direct");
    expect(methodFor("local_payout_sandbox", false)).toBe("claim");
  });
  it("offers wallet delivery only with a wallet, and sandbox payout only where demoable", () => {
    expect(deliveryOptions({ support: "onchain_only" }, false).map((o) => o.id)).toEqual(["claim_link"]);
    expect(deliveryOptions({ support: "onchain_only" }, true).map((o) => o.id)).toEqual(["mezo_wallet", "claim_link"]);
    const mx = deliveryOptions({ support: "sandbox_payout" }, true);
    expect(mx.map((o) => o.id)).toEqual(["mezo_wallet", "claim_link", "local_payout_sandbox"]);
    expect(mx[2].simulated).toBe(true);
    expect(mx[2].body).toMatch(/No real money moves/);
  });
});

describe("expiry", () => {
  it("adds the option's seconds to now", () => {
    expect(expiresAtFor("7d", 1000)).toBe(1000 + 7 * 86400);
    expect(expiresAtFor("demo_10m", 1000)).toBe(1600);
  });
  it("labels the demo option", () => {
    expect(CLAIM_EXPIRY_OPTIONS.demo_10m.label).toMatch(/testnet demo/);
  });
});

describe("recipient checks", () => {
  it("validates wallet addresses", () => {
    expect(checkWallet("")).toMatchObject({ ok: false });
    expect(checkWallet("0x123")).toMatchObject({ ok: false });
    expect(checkWallet("0x0000000000000000000000000000000000000000")).toMatchObject({ ok: false });
    expect(checkWallet(W, W.toUpperCase().replace("0X", "0x"))).toMatchObject({ ok: false, message: /your own wallet/ });
    expect(checkWallet(` ${W} `)).toEqual({ ok: true, address: W });
  });
  it("validates names and notes", () => {
    expect(checkName("  ")).toMatch(/Enter a name/);
    expect(checkName("Ana")).toBeNull();
    expect(checkNote("x".repeat(281))).toMatch(/280/);
    expect(checkNote("hi")).toBeNull();
  });
});

describe("quotes and funding", () => {
  it("counts down quote seconds", () => {
    expect(quoteSecondsLeft(new Date(61_000).toISOString(), 1_000)).toBe(60);
    expect(quoteSecondsLeft(new Date(0).toISOString(), 5_000)).toBe(0);
    expect(quoteSecondsLeft(null, 0)).toBeNull();
  });
  it("skips the permit when the allowance already covers the amount", () => {
    expect(fundingPath(10n, 5n)).toBe("plain");
    expect(fundingPath(1n, 5n)).toBe("permit");
    expect(fundingPath(null, 5n)).toBe("permit");
    // Mezo Passport smart accounts can't sign MUSD permits
    expect(fundingPath(1n, 5n, true)).toBe("approve");
    expect(fundingPath(10n, 5n, true)).toBe("plain");
  });
});

describe("claim key storage", () => {
  it("keeps keys per transfer in sessionStorage only", () => {
    const k = `0x${"ab".repeat(32)}` as const;
    saveClaimKey("t1", k);
    expect(loadClaimKey("t1")).toBe(k);
    expect(window.localStorage.length).toBe(0);
    forgetClaimKey("t1");
    expect(loadClaimKey("t1")).toBeNull();
  });
  it("ignores garbage", () => {
    window.sessionStorage.setItem("mezoremit:claimkey:t2", "nope");
    expect(loadClaimKey("t2")).toBeNull();
  });
});

describe("history filters", () => {
  const t = (role: Transfer["role"], status: Transfer["status"]) => ({ role, status }) as Transfer;
  const list = [t("sender", "completed"), t("recipient", "claimed"), t("sender", "refunded"), t("sender", "awaiting_claim")];
  it("filters by direction and status group", () => {
    expect(filterTransfers(list, "sent", "all")).toHaveLength(3);
    expect(filterTransfers(list, "received", "all")).toHaveLength(1);
    expect(filterTransfers(list, "all", "done")).toHaveLength(2);
    expect(filterTransfers(list, "sent", "returned")).toHaveLength(1);
    expect(filterTransfers(list, "all", "in_progress")).toHaveLength(1);
  });
});
