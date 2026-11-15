import { describe, expect, it } from "vitest";
import type { TimelineEntry, TransferStatus } from "@/lib/api-types";
import { isFunded, payoutSteps, senderActions, sourceLabel, splitTimeline, STATUS_COPY, statusCopy, timelineTitle } from "@/lib/client/status";
import { txPhaseText } from "@/components/shared/tx-panel";

const ALL: TransferStatus[] = [
  "awaiting_funding",
  "funding_submitted",
  "awaiting_claim",
  "claim_submitted",
  "claimed",
  "completed",
  "expired",
  "cancelled",
  "refunded",
  "failed",
];

describe("status copy", () => {
  it("has a label and both perspectives for every status", () => {
    for (const s of ALL) {
      const c = statusCopy(s);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.sender.length).toBeGreaterThan(10);
      expect(c.recipient.length).toBeGreaterThan(10);
    }
    expect(Object.keys(STATUS_COPY).sort()).toEqual([...ALL].sort());
  });

  it("never implies a bank payout for MUSD settlement", () => {
    for (const s of ALL) {
      const c = STATUS_COPY[s];
      expect(`${c.label} ${c.sender} ${c.recipient}`).not.toMatch(/bank|cash pickup|paid out/i);
    }
  });

  it("knows when a transfer is funded", () => {
    expect(isFunded("direct", "completed")).toBe(true);
    expect(isFunded("direct", "funding_submitted")).toBe(false);
    expect(isFunded("claim", "awaiting_claim")).toBe(true);
    expect(isFunded("claim", "awaiting_funding")).toBe(false);
  });
});

describe("sender actions", () => {
  const base = { method: "claim" as const, chainTransferId: "7", role: "sender" as const };
  it("allows cancel while claimable or expired, refund only when expired", () => {
    expect(senderActions({ ...base, status: "awaiting_claim" })).toMatchObject({ cancel: true, refund: false, copyLink: true });
    expect(senderActions({ ...base, status: "expired" })).toMatchObject({ cancel: true, refund: true, copyLink: false });
    expect(senderActions({ ...base, status: "claimed" })).toMatchObject({ cancel: false, refund: false });
  });
  it("offers nothing on-chain without a chain id or for direct sends", () => {
    expect(senderActions({ ...base, chainTransferId: null, status: "awaiting_claim" }).cancel).toBe(false);
    expect(senderActions({ ...base, method: "direct", status: "completed" })).toMatchObject({ cancel: false, refund: false, copyLink: false });
  });
  it("lets the sender finish an unfunded transfer", () => {
    expect(senderActions({ ...base, chainTransferId: null, status: "awaiting_funding" }).resumeFunding).toBe(true);
  });
  it("gives recipients no cancel", () => {
    expect(senderActions({ ...base, role: "recipient", status: "awaiting_claim" }).cancel).toBe(false);
  });
});

describe("timeline labelling", () => {
  const e = (kind: TimelineEntry["kind"], source: TimelineEntry["source"], at: string): TimelineEntry => ({ kind, source, at, txHash: null });

  it("labels each source plainly", () => {
    expect(sourceLabel("chain").short).toBe("Verified on Mezo");
    expect(sourceLabel("app").short).toBe("Recorded by MezoRemit");
    expect(sourceLabel("sandbox").short).toBe("Simulated");
  });

  it("marks every sandbox step as simulated in its title", () => {
    expect(timelineTitle(e("payout_completed", "sandbox", ""))).toMatch(/simulated/i);
    expect(timelineTitle(e("payout_requested", "sandbox", ""))).toMatch(/simulated/i);
    expect(timelineTitle(e("funded", "chain", ""))).toBe("Funds received on Mezo");
  });

  it("separates settlement from payout, sorted by time", () => {
    const { settlement, payout } = splitTimeline([
      e("payout_requested", "sandbox", "2026-11-10T10:05:00Z"),
      e("claimed", "chain", "2026-11-10T10:03:00Z"),
      e("created", "app", "2026-11-10T10:00:00Z"),
    ]);
    expect(settlement.map((x) => x.kind)).toEqual(["created", "claimed"]);
    expect(payout.map((x) => x.kind)).toEqual(["payout_requested"]);
  });

  it("maps the payout lifecycle to steps", () => {
    expect(payoutSteps("requested").map((s) => s.state)).toEqual(["current", "todo", "todo"]);
    expect(payoutSteps("processing").map((s) => s.state)).toEqual(["done", "current", "todo"]);
    expect(payoutSteps("completed").map((s) => s.state)).toEqual(["done", "done", "done"]);
    expect(payoutSteps("failed")[2]).toMatchObject({ label: "Failed", state: "failed" });
  });
});

describe("tx phase copy", () => {
  it("describes each phase in plain words", () => {
    expect(txPhaseText({ phase: "wallet", label: "x", ask: "signature" })).toMatch(/free/);
    expect(txPhaseText({ phase: "wallet", label: "x", ask: "transaction" })).toMatch(/confirm/);
    expect(txPhaseText({ phase: "submitted", label: "x" })).toMatch(/Waiting for Mezo/);
    expect(txPhaseText({ phase: "confirmed", label: "x" })).toBe("Confirmed on Mezo.");
    expect(txPhaseText({ phase: "error", label: "x", error: { kind: "rejected", title: "Cancelled in your wallet", message: "Nothing was sent." } })).toBe(
      "Cancelled in your wallet. Nothing was sent.",
    );
  });
});
