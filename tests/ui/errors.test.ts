import { describe, expect, it } from "vitest";
import { BaseError, encodeErrorResult, parseAbi } from "viem";
import { remittanceManagerAbi } from "@/lib/chain/abis";
import { ApiClientError } from "@/lib/client/api";
import { describeTxError, humanizeErrorName, isPermitUnsupported } from "@/lib/client/errors";

describe("tx error mapping", () => {
  it("treats wallet rejections as a cancel, not a failure", () => {
    expect(describeTxError({ code: 4001, message: "User rejected the request." })).toMatchObject({ kind: "rejected", message: /Nothing was sent/ });
    expect(describeTxError(new BaseError("x", { cause: { name: "UserRejectedRequestError" } as never }))).toMatchObject({ kind: "rejected" });
  });

  it("explains missing BTC for the network fee", () => {
    const e = describeTxError(new Error("insufficient funds for gas * price + value"));
    expect(e.kind).toBe("funds_btc");
    expect(e.message).toMatch(/BTC/);
    expect(e.message).not.toMatch(/gas/i);
  });

  it("decodes contract custom errors into plain words", () => {
    const data = encodeErrorResult({ abi: remittanceManagerAbi, errorName: "TransferExpired" });
    expect(describeTxError({ shortMessage: "Execution reverted", data })).toMatchObject({ kind: "revert", errorName: "TransferExpired", message: /expired/ });
    const bad = encodeErrorResult({ abi: remittanceManagerAbi, errorName: "InvalidClaimSignature" });
    expect(describeTxError({ cause: { raw: bad } }).message).toMatch(/doesn't match/);
  });

  it("recognises not enough MUSD", () => {
    const data = encodeErrorResult({
      abi: parseAbi(["error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)"]),
      errorName: "ERC20InsufficientBalance",
      args: ["0x0000000000000000000000000000000000000001", 1n, 2n],
    });
    expect(describeTxError({ data })).toMatchObject({ kind: "funds_musd", title: "Not enough MUSD" });
  });

  it("maps API errors and network trouble", () => {
    expect(describeTxError(new ApiClientError(409, "conflict", "Already exists"))).toMatchObject({ kind: "api", message: "Already exists" });
    expect(describeTxError(new Error("Failed to fetch"))).toMatchObject({ kind: "rpc" });
    expect(describeTxError({ name: "WrongNetworkError" })).toMatchObject({ kind: "network" });
  });

  it("humanizes unknown error names", () => {
    expect(humanizeErrorName("SomethingOddHappened")).toBe("Something odd happened.");
  });

  it("only falls back from permit when the wallet can't sign it", () => {
    expect(isPermitUnsupported({ code: 4001 })).toBe(false);
    expect(isPermitUnsupported(new Error("Method not supported"))).toBe(true);
  });
});
