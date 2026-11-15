"use client";

import { useState } from "react";
import { useDisconnect } from "wagmi";
import { ChevronDown, ExternalLink, LogOut } from "lucide-react";
import { explorerAddress } from "@/lib/chain/config";
import { shortAddress } from "@/lib/client/format";
import { useMounted } from "@/hooks/use-mounted";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConnectDialog } from "./connect-dialog";

export function WalletButton() {
  const mounted = useMounted();
  const auth = useAuth();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const w = auth.wallet;

  if (!mounted) return <Skeleton className="h-8 w-28" />;
  if (!w.isConnected || !w.address) {
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Connect wallet
        </Button>
        <ConnectDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="font-mono text-[0.8125rem]" aria-label={`Wallet ${w.address}`}>
          {shortAddress(w.address)}
          <ChevronDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-xs text-muted-foreground">
            {auth.signedIn ? (auth.user?.displayName ? `Signed in as ${auth.user.displayName}` : "Signed in") : "Connected, not signed in"}
          </span>
          <span className="font-mono text-[0.8125rem]">{shortAddress(w.address)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={explorerAddress(w.address)} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden /> View on the explorer
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (auth.sessionAddress) auth.signOut.mutate();
            disconnect();
          }}
        >
          <LogOut aria-hidden /> {auth.sessionAddress ? "Sign out and disconnect" : "Disconnect"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
