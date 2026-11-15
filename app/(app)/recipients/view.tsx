"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Recipient } from "@/lib/api-types";
import { errorMessage } from "@/lib/client/api";
import { recipientSchema, toRecipientInput, type RecipientForm } from "@/lib/client/recipient-form";
import { useAuth } from "@/hooks/use-auth";
import { useCountries, useDeleteRecipient, useRecipients, useSaveRecipient } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AuthGate } from "@/components/wallet/auth-gate";
import { AddressText } from "@/components/shared/address";
import { EmptyState, PageHeader, QueryError, RowsSkeleton } from "@/components/shared/states";
import { DELIVERY_LABEL } from "@/components/transfer/review-summary";

const selectCls = "mt-1.5 h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm";

function RecipientDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (v: boolean) => void; editing: Recipient | null }) {
  const countries = useCountries();
  const save = useSaveRecipient();
  const form = useForm<RecipientForm>({
    resolver: zodResolver(recipientSchema),
    values: {
      displayName: editing?.displayName ?? "",
      country: editing?.country ?? "",
      walletAddress: editing?.walletAddress ?? "",
      preferredDeliveryMethod: editing?.preferredDeliveryMethod ?? "claim_link",
      contactReference: editing?.contactReference ?? "",
    },
  });
  const e = form.formState.errors;
  const countryCode = useWatch({ control: form.control, name: "country" });
  const country = countries.data?.countries.find((c) => c.code === countryCode);

  async function onSubmit(v: RecipientForm) {
    try {
      await save.mutateAsync({ id: editing?.id, input: toRecipientInput(v) });
      toast.success(editing ? "Recipient updated" : "Recipient saved");
      onOpenChange(false);
    } catch (err) {
      toast.error("Couldn't save", { description: errorMessage(err) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit recipient" : "Add a recipient"}</DialogTitle>
          <DialogDescription>Only you can see this. Nothing here is put on-chain.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="rf-name">Name</Label>
            <Input id="rf-name" className="mt-1.5" aria-invalid={Boolean(e.displayName)} aria-describedby="rf-name-e" {...form.register("displayName")} />
            {e.displayName ? <p id="rf-name-e" role="alert" className="mt-1.5 text-[0.8125rem] text-bad">{e.displayName.message}</p> : null}
          </div>
          <div>
            <Label htmlFor="rf-country">Country</Label>
            <select id="rf-country" className={selectCls} aria-invalid={Boolean(e.country)} {...form.register("country")}>
              <option value="">Choose…</option>
              {(countries.data?.countries ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            {e.country ? <p role="alert" className="mt-1.5 text-[0.8125rem] text-bad">{e.country.message}</p> : null}
          </div>
          <div>
            <Label htmlFor="rf-wallet">Mezo wallet address (optional)</Label>
            <Input id="rf-wallet" className="mt-1.5 font-mono text-[0.8125rem]" spellCheck={false} placeholder="0x…" aria-invalid={Boolean(e.walletAddress)} {...form.register("walletAddress")} />
            {e.walletAddress ? <p role="alert" className="mt-1.5 text-[0.8125rem] text-bad">{e.walletAddress.message}</p> : null}
          </div>
          <div>
            <Label htmlFor="rf-method">Usually send by</Label>
            <select id="rf-method" className={selectCls} {...form.register("preferredDeliveryMethod")}>
              <option value="mezo_wallet">{DELIVERY_LABEL.mezo_wallet}</option>
              <option value="claim_link">{DELIVERY_LABEL.claim_link}</option>
              {country?.support === "sandbox_payout" ? <option value="local_payout_sandbox">{DELIVERY_LABEL.local_payout_sandbox}</option> : null}
            </select>
          </div>
          <div>
            <Label htmlFor="rf-contact">How you reach them (optional)</Label>
            <Input id="rf-contact" className="mt-1.5" placeholder="e.g. WhatsApp" {...form.register("contactReference")} />
            <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">Stored encrypted, for your reference only.</p>
            {e.contactReference ? <p role="alert" className="mt-1.5 text-[0.8125rem] text-bad">{e.contactReference.message}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Body() {
  const auth = useAuth();
  const q = useRecipients(auth.signedIn);
  const countries = useCountries();
  const del = useDeleteRecipient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [deleting, setDeleting] = useState<Recipient | null>(null);
  const list = q.data?.recipients ?? [];
  const countryName = (code: string) => countries.data?.countries.find((c) => c.code === code)?.name ?? code;

  return (
    <>
      <PageHeader
        title="Recipients"
        body="People you send to. Private to you."
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus aria-hidden /> Add recipient
          </Button>
        }
      />
      {q.isLoading ? (
        <RowsSkeleton rows={3} />
      ) : q.isError ? (
        <QueryError error={q.error} what="your recipients" onRetry={() => q.refetch()} />
      ) : list.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {list.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{r.displayName}</p>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {countryName(r.country)} · {DELIVERY_LABEL[r.preferredDeliveryMethod]}
                  {r.contactReference ? ` · ${r.contactReference}` : ""}
                </p>
                {r.walletAddress ? <AddressText address={r.walletAddress} className="mt-0.5" /> : null}
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(r);
                    setOpen(true);
                  }}
                >
                  <Pencil aria-hidden /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(r)} aria-label={`Delete ${r.displayName}`}>
                  <Trash2 aria-hidden /> Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No recipients yet"
          body="Save the people you send to, so next time it's one tap."
          action={
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              Add recipient
            </Button>
          }
        />
      )}

      <RecipientDialog open={open} onOpenChange={setOpen} editing={editing} />

      <Dialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.displayName}?</DialogTitle>
            <DialogDescription>Past transfers stay in your history. This only removes them from your list.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={() =>
                deleting &&
                del.mutate(deleting.id, {
                  onSuccess: () => {
                    toast.success("Recipient deleted");
                    setDeleting(null);
                  },
                  onError: (err) => toast.error("Couldn't delete", { description: errorMessage(err) }),
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RecipientsView() {
  return (
    <AuthGate title="Sign in to manage recipients">
      <Body />
    </AuthGate>
  );
}
