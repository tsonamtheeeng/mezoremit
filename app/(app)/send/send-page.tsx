"use client";

import { AuthGate } from "@/components/wallet/auth-gate";
import { SendFlow } from "@/components/send/send-flow";

export function SendPage({ resumeId }: { resumeId: string | null }) {
  return (
    <div className="mx-auto max-w-xl">
      <AuthGate title="Sign in to send money" body="Your wallet is your account. Signing in is free and doesn't send a transaction.">
        <h1 className="sr-only">Send money</h1>
        <SendFlow resumeId={resumeId} />
      </AuthGate>
    </div>
  );
}
