/** Mezo Passport Bitcoin wallets act through a Mezo smart account (connector type "orangekit"):
 *  ERC-1271 signatures, so no EIP-2612 permit. Kept free of Passport imports so it is unit-testable. */
export function isSmartAccountConnector(connector: { type?: string } | undefined | null): boolean {
  return connector?.type === "orangekit";
}
