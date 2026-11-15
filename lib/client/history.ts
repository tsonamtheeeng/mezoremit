import type { Transfer, TransferStatus } from "@/lib/api-types";

export type RoleFilter = "all" | "sent" | "received";
export type StatusFilter = "all" | "in_progress" | "done" | "returned" | "failed";

export const STATUS_FILTERS: { id: StatusFilter; label: string; statuses: TransferStatus[] | null }[] = [
  { id: "all", label: "Any status", statuses: null },
  { id: "in_progress", label: "In progress", statuses: ["awaiting_funding", "funding_submitted", "awaiting_claim", "claim_submitted", "expired"] },
  { id: "done", label: "Delivered or claimed", statuses: ["completed", "claimed"] },
  { id: "returned", label: "Cancelled or refunded", statuses: ["cancelled", "refunded"] },
  { id: "failed", label: "Failed", statuses: ["failed"] },
];

/** Client-side filter, applied on top of whatever the API returned. Pure, so it is unit tested. */
export function filterTransfers(list: Transfer[], role: RoleFilter, status: StatusFilter): Transfer[] {
  const statuses = STATUS_FILTERS.find((s) => s.id === status)?.statuses ?? null;
  return list.filter((t) => {
    if (role === "sent" && t.role !== "sender") return false;
    if (role === "received" && t.role !== "recipient") return false;
    if (statuses && !statuses.includes(t.status)) return false;
    return true;
  });
}
