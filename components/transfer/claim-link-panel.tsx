"use client";

import { useState } from "react";
import { QrCode as QrIcon, Share2, ShieldAlert } from "lucide-react";
import type { MarkSharedRequest } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/shared/copy-button";
import { QrCode } from "./qr-code";

export function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** Shows a claim link with copy, share sheet and QR. The link is a bearer secret, and the copy says so. */
export function ClaimLinkPanel({
  link,
  amountText,
  onShared,
  onForget,
}: {
  link: string;
  amountText: string;
  onShared?: (channel: MarkSharedRequest["channel"]) => void;
  onForget?: () => void;
}) {
  const [showQr, setShowQr] = useState(false);

  async function share() {
    try {
      await navigator.share({ title: "MezoRemit", text: `You've been sent ${amountText}. Open this link to claim it:`, url: link });
      onShared?.("share_sheet");
    } catch {
      /* person closed the sheet */
    }
  }

  return (
    <div className="space-y-4">
      <div role="note" className="flex gap-2.5 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <div>
          <p className="font-medium">Anyone with this link can claim the money.</p>
          <p className="text-muted-foreground">
            Send it only to your recipient, in a private chat. We can&apos;t recover it if you lose it. If it leaks, cancel the transfer to get your MUSD back.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="claim-link" className="text-sm font-medium">
          Claim link
        </label>
        <input
          id="claim-link"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-1.5 h-10 w-full rounded-md border border-input bg-surface px-3 font-mono text-[0.8125rem] text-foreground"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <CopyButton value={link} text="Copy link" variant="default" onCopied={() => onShared?.("copy")} />
        {canNativeShare() ? (
          <Button type="button" variant="outline" onClick={share}>
            <Share2 aria-hidden /> Share
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          aria-expanded={showQr}
          aria-controls="claim-qr"
          onClick={() => {
            setShowQr((v) => !v);
            if (!showQr) onShared?.("qr");
          }}
        >
          <QrIcon aria-hidden /> {showQr ? "Hide QR code" : "Show QR code"}
        </Button>
      </div>

      {showQr ? (
        <div id="claim-qr" className="flex flex-col items-start gap-2">
          <QrCode value={link} label="QR code of the claim link" />
          <p className="text-[0.8125rem] text-muted-foreground">Let your recipient scan this in person. Don&apos;t post it publicly.</p>
        </div>
      ) : null}

      {onForget ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          This link is kept in this browser tab only, so you can copy it again until you close the tab.{" "}
          <button type="button" onClick={onForget} className="cursor-pointer font-medium text-foreground underline underline-offset-4">
            Remove it from this browser now
          </button>
        </p>
      ) : null}
    </div>
  );
}
