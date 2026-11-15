// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ClaimStateNotice } from "@/components/claim/claim-view";
import type { ClaimPageState } from "@/lib/client/claim-state";

afterEach(cleanup);

const AMT = "25000000000000000000";

function show(state: ClaimPageState) {
  return render(<ClaimStateNotice state={state} amount={AMT} expiresAt={null} />);
}

describe("claim page states", () => {
  it("explains invalid links", () => {
    show({ kind: "invalid", reason: "missing_key" });
    expect(screen.getByRole("heading").textContent).toBe("This link is incomplete");
    cleanup();
    show({ kind: "invalid", reason: "wrong_key" });
    expect(screen.getByRole("heading").textContent).toMatch(/doesn't match/);
  });

  it("shows expired, cancelled and refunded", () => {
    show({ kind: "expired" });
    expect(screen.getByRole("heading").textContent).toBe("This link has expired");
    cleanup();
    show({ kind: "cancelled", txHash: "0xabc" });
    expect(screen.getByRole("heading").textContent).toMatch(/cancelled/);
    expect(screen.getByRole("link", { name: /explorer/ }).getAttribute("href")).toMatch(/\/tx\/0xabc$/);
    cleanup();
    show({ kind: "refunded", txHash: null });
    expect(screen.getByRole("heading").textContent).toBe("Returned to the sender");
  });

  it("shows who already claimed it, with an explorer link", () => {
    show({ kind: "claimed", claimedBy: "0x1234567890abcdef1234567890abcdef12345678", txHash: "0xfeed" });
    expect(screen.getByRole("heading").textContent).toBe("Already claimed");
    expect(screen.getByText(/25\.00 MUSD was claimed/)).toBeTruthy();
    expect(screen.getByText("0x1234…5678")).toBeTruthy();
    expect(screen.getByRole("link", { name: /See it on the explorer/ })).toBeTruthy();
  });

  it("renders nothing extra for the claimable state and a skeleton while loading", () => {
    const { container } = show({ kind: "claimable" });
    expect(container.textContent).toBe("");
    cleanup();
    show({ kind: "loading" });
    expect(screen.getByLabelText("Loading")).toBeTruthy();
  });
});
