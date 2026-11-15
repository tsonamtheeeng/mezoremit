// Node-side EIP-1193 wallet injected into Playwright pages (announced via EIP-6963, connect with Passport's
// "Browser Wallet"). Shared by record.ts and screens.ts. Keys come from the caller, never from disk.
import type { BrowserContext } from "playwright";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "../../lib/chain/config";

export const RPC = "https://rpc.test.mezo.org";
export const pub = createPublicClient({ chain: mezoTestnet, transport: http(RPC) });

// ---------------------------------------------------------------- injected wallet (browser side; must be a plain string)
export const INJECT = `(() => {
  const listeners = {};
  const provider = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      const r = await window.__mzWallet(method, params || []);
      if (r && r.__error) { const e = new Error(r.__error.message); e.code = r.__error.code; throw e; }
      return r;
    },
    on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return provider; },
    removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); return provider; },
  };
  window.ethereum = provider;
  const icon = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#f6851b"/></svg>');
  const info = { uuid: "6d1f2a52-6f0e-4a8e-9c1d-mezoremitdemo", name: "MetaMask", icon, rdns: "io.metamask" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();

  // Visible cursor. A manual popover so it renders above the wallet modal (top layer).
  const mk = () => {
    if (window.__mzNoCursor || document.getElementById("__mzcur") || !document.body) return;
    const c = document.createElement("div");
    c.id = "__mzcur";
    c.setAttribute("popover", "manual");
    c.style.cssText = "position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;left:0;top:0;width:26px;height:26px;pointer-events:none;transition:transform .55s cubic-bezier(.2,.8,.2,1);transform:translate(720px,420px)";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 10.5-6.6 1.3 3.9 7.2-3 1.6-3.9-7.3L4 20z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    try { c.showPopover(); } catch {}
  };
  window.__mzCursor = (x, y, press) => {
    mk();
    const c = document.getElementById("__mzcur");
    if (!c) return;
    try { c.hidePopover(); c.showPopover(); } catch {}
    c.style.transform = "translate(" + x + "px," + y + "px)" + (press ? " scale(.85)" : "");
  };
  document.addEventListener("DOMContentLoaded", mk);

  // Heartbeat pixel: Playwright's video only gets a frame when the page repaints, so an idle tab would lose
  // wall-clock time and drift against the scene marks. A 2px corner dot that flips between two near-identical
  // shades keeps frames flowing.
  setInterval(() => {
    if (window.__mzNoCursor) return;
    let d = document.getElementById("__mzbeat");
    if (!d && document.body) {
      d = document.createElement("div");
      d.id = "__mzbeat";
      d.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;z-index:2147483647;pointer-events:none";
      document.body.appendChild(d);
    }
    if (d) d.style.background = d.style.background === "rgb(250, 250, 249)" ? "rgb(249, 249, 248)" : "rgb(250, 250, 249)";
  }, 80);
})();`;

function typedDataForViem(json: string) {
  const td = JSON.parse(json);
  const types = { ...td.types };
  delete types.EIP712Domain;
  // uint/int fields arrive as strings or numbers; viem wants bigint.
  const fix = (type: string, value: unknown): unknown => {
    if (/^u?int\d*$/.test(type)) return BigInt(value as string);
    const arr = type.match(/^(.*)\[\d*\]$/);
    if (arr) return (value as unknown[]).map((v) => fix(arr[1], v));
    if (types[type]) return fixStruct(type, value as Record<string, unknown>);
    return value;
  };
  const fixStruct = (type: string, obj: Record<string, unknown>) =>
    Object.fromEntries((types[type] as { name: string; type: string }[]).map((f) => [f.name, fix(f.type, obj[f.name])]));
  const domain = { ...td.domain };
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);
  return { domain, types, primaryType: td.primaryType, message: fixStruct(td.primaryType, td.message) };
}

export async function attachWallet(ctx: BrowserContext, key: Hex) {
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(RPC) });
  let approved = false;
  await ctx.exposeFunction("__mzWallet", async (method: string, params: unknown[]) => {
    if (process.env.WALLET_DEBUG) console.log(`[wallet] ${method}`);
    try {
      switch (method) {
        case "eth_requestAccounts":
          approved = true;
          return [account.address];
        case "eth_accounts":
          // Like a real wallet: nothing until the site asked and the user approved, so the Passport modal shows.
          return approved ? [account.address] : [];
        case "eth_chainId":
          return `0x${mezoTestnet.id.toString(16)}`;
        case "net_version":
          return String(mezoTestnet.id);
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
        case "wallet_watchAsset":
          return null;
        case "wallet_requestPermissions":
          approved = true;
          return [{ parentCapability: "eth_accounts" }];
        case "wallet_getPermissions":
          return approved ? [{ parentCapability: "eth_accounts" }] : [];
        case "personal_sign":
          return await account.signMessage({ message: { raw: params[0] as Hex } });
        case "eth_signTypedData_v4":
          return await account.signTypedData(typedDataForViem(params[1] as string) as never);
        case "eth_sendTransaction": {
          const t = params[0] as { to: Hex; data?: Hex; value?: Hex };
          const req = { account: account.address, to: t.to, data: t.data, value: t.value ? BigInt(t.value) : 0n };
          const gas = await pub.estimateGas(req);
          const gasPrice = await pub.getGasPrice();
          return await wallet.sendTransaction({ ...req, account, gas: (gas * 13n) / 10n, gasPrice, type: "legacy" });
        }
        default: {
          const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
          const j = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
          if (j.error) return { __error: j.error };
          return j.result ?? null;
        }
      }
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      console.error(`[wallet] ${method} failed:`, err.shortMessage ?? err.message);
      return { __error: { code: -32603, message: err.shortMessage ?? err.message ?? "wallet error" } };
    }
  });
  await ctx.addInitScript(INJECT);
  return account.address;
}

