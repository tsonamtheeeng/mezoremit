import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { countdown, localMoney, musd, musdExact, musdNumber, rateText, shortAddress, bpsToPercent } from "@/lib/client/format";

describe("format", () => {
  it("shows MUSD with two decimals and grouping", () => {
    expect(musd(parseUnits("25", 18))).toBe("25.00 MUSD");
    expect(musd(parseUnits("1234.5", 18).toString())).toBe("1,234.50 MUSD");
    expect(musd(parseUnits("0.005", 18))).toBe("0.01 MUSD");
    expect(musd(null)).toBe("--");
    expect(musd("not-a-number")).toBe("--");
    expect(musdNumber(0n)).toBe("0.00");
  });

  it("keeps full precision when asked", () => {
    expect(musdExact(parseUnits("25.5", 18))).toBe("25.5");
    expect(musdExact(parseUnits("25", 18))).toBe("25");
  });

  it("formats local currency with Intl", () => {
    expect(localMoney("426.03", "MXN")).toMatch(/426\.03/);
    expect(localMoney("1425.5", "PHP")).toBe("₱1,425.50 PHP");
    expect(localMoney("426.03", "MXN")).toBe("MX$426.03 MXN");
    expect(localMoney("10", "XYZ")).toBe("10.00 XYZ");
    expect(localMoney(null, "MXN")).toBe("--");
    expect(localMoney("12", "")).toBe("--");
  });

  it("formats rates, markup, addresses and countdowns", () => {
    expect(rateText("17.0412", "MXN")).toMatch(/^1 MUSD ≈ 17\.0412 MXN$/);
    expect(bpsToPercent(150)).toBe("1.5%");
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(countdown(42)).toBe("0:42");
    expect(countdown(61)).toBe("1:01");
    expect(countdown(-3)).toBe("0:00");
  });
});
