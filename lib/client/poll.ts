import type { Transfer, TransferResponse, TransferStatus } from "@/lib/api-types";
import { api } from "./api";

/** Poll GET /api/transfers/:id until the status is one of `targets` (or a final failure). */
export async function waitForTransferStatus(
  id: string,
  targets: TransferStatus[],
  { timeoutMs = 90_000, everyMs = 2_500, signal }: { timeoutMs?: number; everyMs?: number; signal?: AbortSignal } = {},
): Promise<Transfer> {
  const stopOn: TransferStatus[] = [...targets, "failed", "cancelled", "refunded"];
  const end = Date.now() + timeoutMs;
  let last: Transfer | null = null;
  while (Date.now() < end) {
    if (signal?.aborted) break;
    try {
      const { transfer } = await api<TransferResponse>(`/api/transfers/${encodeURIComponent(id)}`);
      last = transfer;
      if (stopOn.includes(transfer.status)) return transfer;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  if (last) return last;
  throw new Error("MezoRemit hasn't confirmed this yet. It will update on its own.");
}
