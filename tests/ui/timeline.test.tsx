// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TimelineEntry } from "@/lib/api-types";
import { Timeline } from "@/components/transfer/timeline";

afterEach(cleanup);

const entries: TimelineEntry[] = [
  { kind: "created", at: "2026-11-10T10:00:00Z", txHash: null, source: "app" },
  { kind: "funded", at: "2026-11-10T10:01:00Z", txHash: "0xaaa", source: "chain" },
  { kind: "claimed", at: "2026-11-10T10:04:00Z", txHash: "0xbbb", source: "chain" },
  { kind: "payout_completed", at: "2026-11-10T10:06:00Z", txHash: null, source: "sandbox" },
];

describe("<Timeline>", () => {
  it("keeps MUSD settlement and the simulated payout apart, with source labels", () => {
    const { container } = render(<Timeline entries={entries} legend={false} />);
    expect(screen.getByRole("heading", { name: "MUSD on Mezo" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Local payout (simulated)" })).toBeTruthy();
    expect(screen.getAllByText("Verified on Mezo")).toHaveLength(2);
    expect(screen.getByText("Recorded by MezoRemit")).toBeTruthy();
    expect(screen.getByText("Local payout completed (simulated)")).toBeTruthy();
    expect(container.querySelectorAll('[data-source="sandbox"]')).toHaveLength(1);
    const links = screen.getAllByRole("link", { name: /Check on the explorer/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["https://explorer.test.mezo.org/tx/0xaaa", "https://explorer.test.mezo.org/tx/0xbbb"]);
  });
});
