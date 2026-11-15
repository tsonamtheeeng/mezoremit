import { isAddress } from "viem";
import { z } from "zod";
import type { RecipientInput } from "@/lib/api-types";

export const recipientSchema = z
  .object({
    displayName: z.string().trim().min(1, "Enter a name.").max(80, "Keep the name under 80 characters."),
    country: z.string().min(2, "Choose a country."),
    walletAddress: z
      .string()
      .trim()
      .refine((v): boolean => v === "" || isAddress(v, { strict: false }), "That doesn't look like a wallet address. It starts with 0x and has 42 characters."),
    preferredDeliveryMethod: z.enum(["mezo_wallet", "claim_link", "local_payout_sandbox"]),
    contactReference: z.string().trim().max(200, "Keep this under 200 characters."),
  })
  .refine((v) => v.preferredDeliveryMethod !== "mezo_wallet" || v.walletAddress !== "", {
    path: ["walletAddress"],
    message: "Add their wallet address to send straight to their wallet.",
  });

export type RecipientForm = z.infer<typeof recipientSchema>;

export function toRecipientInput(v: RecipientForm): RecipientInput {
  return {
    displayName: v.displayName.trim(),
    country: v.country,
    walletAddress: v.walletAddress ? v.walletAddress.toLowerCase() : null,
    preferredDeliveryMethod: v.preferredDeliveryMethod,
    contactReference: v.contactReference || null,
  };
}
