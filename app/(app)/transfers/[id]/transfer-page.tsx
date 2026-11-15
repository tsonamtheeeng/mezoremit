"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthGate } from "@/components/wallet/auth-gate";
import { TransferDetail } from "@/components/transfer/transfer-detail";

export function TransferPage({ id }: { id: string }) {
  return (
    <AuthGate title="Sign in to track this transfer">
      <Link href="/history" className="-ml-2 mb-4 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All transfers
      </Link>
      <TransferDetail id={id} />
    </AuthGate>
  );
}
