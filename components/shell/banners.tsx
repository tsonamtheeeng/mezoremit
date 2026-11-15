"use client";

import { toast } from "sonner";
import { isDeployed, MEZO_TESTNET_ID } from "@/lib/chain/config";
import { describeTxError } from "@/lib/client/errors";
import { useMounted } from "@/hooks/use-mounted";
import { useWallet } from "@/hooks/use-wallet";

/** Always-on, honest testnet notice. */
export function TestnetBanner() {
  return (
    <div className="border-b bg-surface px-4 py-1.5 text-center text-[0.8125rem] text-muted-foreground">
      <span className="font-medium text-foreground">Testnet only.</span> Transfers use test MUSD on Mezo Testnet and have no real value.
      {!isDeployed ? " Sending is turned off until the contract is deployed." : null}
    </div>
  );
}

export function WrongNetworkBanner({ chainId, switching, onSwitch }: { chainId: number | undefined; switching?: boolean; onSwitch: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warn/40 bg-warn-soft px-4 py-2 text-[0.8125rem]">
      <span>
        Your wallet is on {chainId ? `network ${chainId}` : "another network"}. MezoRemit uses Mezo Testnet ({MEZO_TESTNET_ID}).
      </span>
      <button type="button" disabled={switching} onClick={onSwitch} className="cursor-pointer rounded-sm font-semibold underline underline-offset-4 disabled:opacity-60">
        {switching ? "Switching…" : "Switch to Mezo Testnet"}
      </button>
    </div>
  );
}

export function NetworkBanner() {
  const mounted = useMounted();
  const w = useWallet();
  if (!mounted || w.network.kind !== "wrong-network") return null;
  return (
    <WrongNetworkBanner
      chainId={w.chainId}
      switching={w.isSwitching}
      onSwitch={() =>
        w.switchToMezo().catch((e) => {
          const m = describeTxError(e);
          toast.error(m.title, { description: m.message });
        })
      }
    />
  );
}
