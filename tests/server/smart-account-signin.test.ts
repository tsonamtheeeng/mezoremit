import { describe, expect, it, vi } from "vitest";
import { HttpRequestError } from "viem";
import { HttpError } from "@/lib/server/errors";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyWalletSignature, type ChainAdapter } from "@/lib/server/chain";

// Mezo Passport Bitcoin wallets sign as a Mezo smart account; sign-in falls back to ERC-1271 / ERC-6492 on chain.
function chainWith(verifySmartSignature: ReturnType<typeof vi.fn>) {
  return { verifySmartSignature } as unknown as ChainAdapter;
}
const eoa = privateKeyToAccount(generatePrivateKey());
const smartAccount = "0x00000000000000000000000000000000000a11ce" as const;
const message = "mezoremit sign-in test";

describe("verifyWalletSignature (Mezo Passport smart accounts)", () => {
  it("accepts a plain wallet signature without touching the chain", async () => {
    const onchain = vi.fn();
    const sig = await eoa.signMessage({ message });
    await expect(verifyWalletSignature(chainWith(onchain), eoa.address, message, sig)).resolves.toBe(true);
    expect(onchain).not.toHaveBeenCalled();
  });

  it("accepts a smart-account signature the chain validates", async () => {
    const onchain = vi.fn().mockResolvedValue(true);
    const sig = `0x${"ab".repeat(200)}` as const;
    await expect(verifyWalletSignature(chainWith(onchain), smartAccount, message, sig)).resolves.toBe(true);
    expect(onchain).toHaveBeenCalledWith(smartAccount, message, sig);
  });

  it("rejects a signature neither recovery nor the chain accepts", async () => {
    const onchain = vi.fn().mockResolvedValue(false);
    const sig = await eoa.signMessage({ message });
    await expect(verifyWalletSignature(chainWith(onchain), smartAccount, message, sig)).resolves.toBe(false);
  });

  it("reports an RPC outage as 503 chain_unavailable, not a bad signature", async () => {
    const onchain = vi.fn().mockRejectedValue(new HttpRequestError({ url: "https://rpc.test.mezo.org", details: "fetch failed" }));
    const err = await verifyWalletSignature(chainWith(onchain), smartAccount, message, "0x1234").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(503);
  });
});
