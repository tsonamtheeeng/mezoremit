import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { checkAmount, indicativeLocal, normalizeAmountInput, parseAmount, recipientReceives } from "@/lib/client/amount";

const u = (s: string) => parseUnits(s, 18);

describe("amount input", () => {
  it("normalizes separators and leading zeros", () => {
    expect(normalizeAmountInput(" 1,000.50 ")).toBe("1000.50");
    expect(normalizeAmountInput("007")).toBe("7");
    expect(normalizeAmountInput(".5")).toBe("0.5");
    expect(normalizeAmountInput("")).toBe("");
    expect(normalizeAmountInput("12a")).toBeNull();
    expect(normalizeAmountInput("1.2.3")).toBeNull();
    expect(normalizeAmountInput("-5")).toBeNull();
  });

  it("parses to 18-decimal base units", () => {
    expect(parseAmount("25")).toBe(u("25"));
    expect(parseAmount("25.5")).toBe(u("25.5"));
    expect(parseAmount("abc")).toBeNull();
  });

  it("validates with plain messages", () => {
    expect(checkAmount("")).toMatchObject({ ok: false, reason: "empty" });
    expect(checkAmount("ten")).toMatchObject({ ok: false, reason: "format" });
    expect(checkAmount("1.234")).toMatchObject({ ok: false, reason: "precision" });
    expect(checkAmount("0")).toMatchObject({ ok: false, reason: "zero" });
    expect(checkAmount("0.50")).toMatchObject({ ok: false, reason: "zero" });
    expect(checkAmount("10000001")).toMatchObject({ ok: false, reason: "too_large" });
    expect(checkAmount("25.50")).toEqual({ ok: true, value: u("25.5") });
  });

  it("checks against the live balance when known", () => {
    expect(checkAmount("30", u("25"))).toMatchObject({ ok: false, reason: "balance" });
    expect(checkAmount("25", u("25"))).toEqual({ ok: true, value: u("25") });
    expect(checkAmount("30", null)).toMatchObject({ ok: true });
  });
});

describe("receive math", () => {
  it("subtracts the service fee and never goes negative", () => {
    expect(recipientReceives(u("25"), 0n)).toBe(u("25"));
    expect(recipientReceives(u("25"), u("1"))).toBe(u("24"));
    expect(recipientReceives(u("1"), u("2"))).toBe(0n);
  });

  it("computes an indicative local amount from a reference rate", () => {
    expect(indicativeLocal(u("25"), "17.0412")).toBe("426.03");
    expect(indicativeLocal(u("100"), "56.1")).toBe("5610.00");
    expect(indicativeLocal(u("25"), null)).toBeNull();
    expect(indicativeLocal(u("25"), "nope")).toBeNull();
  });
});
