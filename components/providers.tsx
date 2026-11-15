"use client";

import { useState, type ReactNode } from "react";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { ThemeProvider, useTheme } from "next-themes";
import { mezoTestnet } from "@/lib/chain/config";
import { wagmiConfig } from "@/lib/client/wagmi";
import { ApiClientError } from "@/lib/client/api";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mezo Passport's connect modal (RainbowKit) in MezoRemit's cobalt accent (see docs/DESIGN.md).
const rkLight = lightTheme({ accentColor: "#2759bc", accentColorForeground: "#fbfbfe", borderRadius: "small", fontStack: "system" });
const rkDark = darkTheme({ accentColor: "#8fb0ec", accentColorForeground: "#111a2e", borderRadius: "small", fontStack: "system" });

function WalletModalProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <RainbowKitProvider theme={resolvedTheme === "dark" ? rkDark : rkLight} initialChain={mezoTestnet} modalSize="compact">
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (n, err) => {
              if (err instanceof ApiClientError && err.status >= 400 && err.status < 500) return false;
              return n < 2;
            },
            retryDelay: (n) => Math.min(800 * 2 ** n, 4000),
            refetchOnWindowFocus: true,
            staleTime: 5_000,
          },
        },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <WalletModalProvider>
            <TooltipProvider delayDuration={200}>
              {children}
              <Toaster position="top-center" closeButton />
            </TooltipProvider>
          </WalletModalProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
