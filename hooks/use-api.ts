"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClaimInfo,
  CountriesResponse,
  CreatePayoutRequest,
  CreateTransferRequest,
  MarkSharedRequest,
  MeResponse,
  NotificationsResponse,
  PayoutOptionsResponse,
  PayoutRequest,
  QuoteRequest,
  QuoteResponse,
  RecipientDashboard,
  RecipientInput,
  RecipientsResponse,
  SenderDashboard,
  TransferResponse,
  TransfersResponse,
  UpdateSettingsRequest,
} from "@/lib/api-types";
import { api, qs } from "@/lib/client/api";
import { isMoving } from "@/lib/client/status";

/** Query keys. Everything API-backed lives under ["api", …] so sign-out can clear it in one go. */
export const qk = {
  me: ["api", "me"] as const,
  countries: ["api", "countries"] as const,
  recipients: ["api", "recipients"] as const,
  transfers: (filters: Record<string, string>) => ["api", "transfers", filters] as const,
  transfer: (id: string) => ["api", "transfer", id] as const,
  claim: (id: string) => ["api", "claim", id] as const,
  senderDash: ["api", "dashboard", "sender"] as const,
  recipientDash: ["api", "dashboard", "recipient"] as const,
  payoutOptions: (transferId: string) => ["api", "payout-options", transferId] as const,
  payout: (id: string) => ["api", "payout", id] as const,
  notifications: ["api", "notifications"] as const,
};

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => api<MeResponse>("/api/auth/me"), staleTime: 30_000 });
}

export function useCountries() {
  return useQuery({ queryKey: qk.countries, queryFn: () => api<CountriesResponse>("/api/countries"), staleTime: 10 * 60_000 });
}

export function useRecipients(enabled = true) {
  return useQuery({ queryKey: qk.recipients, queryFn: () => api<RecipientsResponse>("/api/recipients"), enabled });
}

export function useSaveRecipient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: RecipientInput }) =>
      id
        ? api<{ recipient: RecipientsResponse["recipients"][number] }>(`/api/recipients/${encodeURIComponent(id)}`, { method: "PATCH", json: input })
        : api<{ recipient: RecipientsResponse["recipients"][number] }>("/api/recipients", { method: "POST", json: input }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.recipients }),
  });
}

export function useDeleteRecipient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<unknown>(`/api/recipients/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.recipients }),
  });
}

export function requestQuote(body: QuoteRequest) {
  return api<QuoteResponse>("/api/quotes", { method: "POST", json: body });
}

export function createTransfer(body: CreateTransferRequest) {
  return api<TransferResponse>("/api/transfers", { method: "POST", json: body });
}

export function reportFunding(id: string, txHash: string) {
  return api<TransferResponse>(`/api/transfers/${encodeURIComponent(id)}/submitted`, { method: "POST", json: { txHash } });
}

export function confirmTransfer(id: string) {
  return api<TransferResponse>(`/api/transfers/${encodeURIComponent(id)}/confirm`, { method: "POST", json: {} });
}

export function markShared(id: string, channel: MarkSharedRequest["channel"]) {
  return api<unknown>(`/api/transfers/${encodeURIComponent(id)}/shared`, { method: "POST", json: { channel } satisfies MarkSharedRequest });
}

/** Transfer detail. Polls while something is in flight (or `poll` is forced). */
export function useTransfer(id: string | null | undefined, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: qk.transfer(id ?? ""),
    queryFn: () => api<TransferResponse>(`/api/transfers/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
    refetchInterval: (q) => {
      const s = q.state.data?.transfer.status;
      if (opts.poll) return 3_000;
      return s && isMoving(s) ? 4_000 : s === "awaiting_claim" ? 20_000 : false;
    },
  });
}

/** Paginated history. `role` is all | sent | received; the UI also filters by status group client-side. */
export function useTransferHistory(filters: { role?: string; status?: string }, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.transfers(filters as Record<string, string>),
    queryFn: ({ pageParam }) => api<TransfersResponse>(`/api/transfers${qs({ cursor: pageParam, limit: 20, ...filters })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useClaimInfo(id: string, poll = false) {
  return useQuery({
    queryKey: qk.claim(id),
    queryFn: () => api<ClaimInfo>(`/api/claims/${encodeURIComponent(id)}`),
    refetchInterval: (q) => (poll || q.state.data?.status === "claim_submitted" || q.state.data?.status === "funding_submitted" ? 4_000 : false),
    retry: 1,
  });
}

export function useSenderDashboard(enabled = true) {
  return useQuery({ queryKey: qk.senderDash, queryFn: () => api<SenderDashboard>("/api/dashboard/sender"), enabled, refetchInterval: 30_000 });
}

export function useRecipientDashboard(enabled = true) {
  return useQuery({ queryKey: qk.recipientDash, queryFn: () => api<RecipientDashboard>("/api/dashboard/recipient"), enabled, refetchInterval: 30_000 });
}

export function usePayoutOptions(transferId: string, enabled = true) {
  return useQuery({
    queryKey: qk.payoutOptions(transferId),
    queryFn: () => api<PayoutOptionsResponse>(`/api/payouts/options${qs({ transferId })}`),
    enabled,
  });
}

export function usePayout(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.payout(id ?? ""),
    queryFn: () => api<{ payout: PayoutRequest }>(`/api/payouts/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
    refetchInterval: (q) => {
      const s = q.state.data?.payout.status;
      return s === "requested" || s === "processing" ? 3_000 : false;
    },
  });
}

export function useCreatePayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePayoutRequest) => api<{ payout: PayoutRequest }>("/api/payouts", { method: "POST", json: body }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: qk.transfer(v.transferId) });
    },
  });
}

export function useNotifications(enabled = true) {
  return useQuery({ queryKey: qk.notifications, queryFn: () => api<NotificationsResponse>("/api/notifications"), enabled, refetchInterval: 30_000 });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[] | "all") => api<unknown>("/api/notifications/read", { method: "POST", json: ids === "all" ? {} : { ids } }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsRequest) => api<MeResponse>("/api/settings", { method: "PATCH", json: body }),
    onSuccess: (res) => {
      if (res && "user" in res) qc.setQueryData(qk.me, res);
      else void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}
