"use client";

import { useEffect, useRef } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";

/**
 * True when the browser has any wallet Mezo Passport can use: an Ethereum wallet (window.ethereum) or a
 * Bitcoin wallet extension (Unisat, OKX, Xverse). Used only to decide whether to show setup help.
 */
export function hasInjectedWallet(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.ethereum || w.unisat || w.okxwallet || w.XverseProviders || w.BitcoinProvider);
}

/**
 * Opens Mezo Passport's connect modal: Bitcoin wallets (via a Mezo smart account) or Ethereum wallets.
 * Keeps the controlled `open`/`onOpenChange` shape so call sites stay the same: `onOpenChange(false)`
 * fires once the modal closes, connected or not.
 */
export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const shown = useRef(false);

  useEffect(() => {
    if (open && !connectModalOpen && !shown.current) {
      if (!openConnectModal) {
        // Already connected: nothing to open.
        onOpenChange(false);
        return;
      }
      shown.current = true;
      openConnectModal();
    }
  }, [open, connectModalOpen, openConnectModal, onOpenChange]);

  useEffect(() => {
    if (shown.current && !connectModalOpen) {
      shown.current = false;
      onOpenChange(false);
    }
  }, [connectModalOpen, onOpenChange]);

  return null;
}
