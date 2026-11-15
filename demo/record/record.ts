// Records the MezoRemit demo against the live app on Mezo Testnet with real transactions.
//
//   SENDER_PRIVATE_KEY=0x… RECIPIENT_PRIVATE_KEY=0x… npx tsx demo/record/record.ts
//
// Two browser contexts (sender, recipient), each with a Node-side EIP-1193 wallet announced as MetaMask (EIP-6963),
// connected through the Mezo Passport modal. Every scene lasts at least as long as its narration clip
// (demo/record/out/tts/<scene>.json, from tts.py). Writes out/raw/<ctx>/*.webm and out/timeline.json for compose.py.
// Keys come from the environment only and are never written anywhere.

import fs from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import type { Hex } from "viem";
import { attachWallet } from "./wallet";

const APP = process.env.APP_URL || "https://mezoremit.vercel.app";
const OUT = path.join(__dirname, "out");
const VIEW = { width: 1440, height: 810 };
const AMOUNT = process.env.DEMO_AMOUNT || "25";

const need = (k: string) => {
  const v = process.env[k];
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${k} must be set to a 0x-prefixed private key`);
  return v as Hex;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tts = (scene: string) => {
  const f = path.join(OUT, "tts", `${scene}.json`);
  if (!fs.existsSync(f)) {
    if (!process.env.STOP_AFTER) throw new Error(`missing narration for ${scene}: run tts.py first`);
    return { duration: 1 };
  }
  return JSON.parse(fs.readFileSync(f, "utf8")) as { duration: number };
};

// ---------------------------------------------------------------- recording + scenes
type Mark = { scene: string; ctx: string; start: number; end: number };
const marks: Mark[] = [];
const t0: Record<string, number> = {};

async function newCtx(browser: Awaited<ReturnType<typeof chromium.launch>>, name: string, key: Hex) {
  const dir = path.join(OUT, "raw", name);
  fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 4 / 3, recordVideo: { dir, size: { width: 1920, height: 1080 } }, colorScheme: "light" });
  const address = await attachWallet(ctx, key);
  const page = await ctx.newPage();
  pages[name] = page;
  t0[name] = Date.now();
  return { ctx, page, address, name };
}

const pages: Record<string, Page> = {};
class Stop extends Error {}

async function scene(name: string, ctxName: string, fn: () => Promise<void>) {
  const start = Date.now();
  console.log(`▶ ${name}`);
  try {
    await fn();
  } catch (e) {
    for (const [k, pg] of Object.entries(pages)) await pg.screenshot({ path: path.join(OUT, `fail-${name}-${k}.png`) }).catch(() => undefined);
    throw e;
  }
  if (process.env.STOP_AFTER === name) {
    for (const [k, pg] of Object.entries(pages)) await pg.screenshot({ path: path.join(OUT, `stop-${name}-${k}.png`), fullPage: true });
    throw new Stop(`stopped after ${name}`);
  }
  const min = tts(name).duration * 1000 + 700;
  const spent = Date.now() - start;
  if (spent < min) await sleep(min - spent);
  marks.push({ scene: name, ctx: ctxName, start: (start - t0[ctxName]) / 1000, end: (Date.now() - t0[ctxName]) / 1000 });
}

async function moveTo(page: Page, loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) return;
  await page.evaluate(([x, y]) => (window as unknown as { __mzCursor: (x: number, y: number) => void }).__mzCursor(x, y), [b.x + b.width / 2, b.y + b.height / 2]);
  await sleep(650);
}

async function click(page: Page, loc: Locator) {
  await loc.waitFor({ state: "visible", timeout: 60_000 });
  await moveTo(page, loc);
  await loc.click();
  await sleep(350);
}

async function type(page: Page, loc: Locator, text: string) {
  await click(page, loc);
  await loc.pressSequentially(text, { delay: 70 });
}

async function smoothScroll(page: Page, y: number, ms = 1600) {
  // Plain string: tsx would inject a __name helper into a nested arrow function.
  await page.evaluate(`(() => {
    const to = Math.min(${y}, document.documentElement.scrollHeight - innerHeight), dur = ${ms};
    const from = window.scrollY, t = performance.now();
    function step(n) {
      const k = Math.min(1, (n - t) / dur);
      window.scrollTo(0, from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  })()`);
  await sleep(ms + 200);
}

/** Connect through the Mezo Passport modal ("Browser Wallet" = the injected window.ethereum). */
async function connectPassport(page: Page) {
  await click(page, page.getByRole("button", { name: "Connect wallet" }).first());
  const mm = page.getByRole("button", { name: /Browser Wallet/i }).first();
  await mm.waitFor({ state: "visible", timeout: 30_000 });
  await sleep(1800); // let the viewer see Bitcoin + Ethereum wallet groups
  if (process.env.WALLET_DEBUG) {
    await page.screenshot({ path: path.join(OUT, "modal.png") });
    console.log("modal buttons:", await page.getByRole("button").allInnerTexts());
  }
  await click(page, mm);
}

// ---------------------------------------------------------------- main
async function main() {
  const senderKey = need("SENDER_PRIVATE_KEY");
  const recipientKey = need("RECIPIENT_PRIVATE_KEY");
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const S = await newCtx(browser, "sender", senderKey);
  const p = S.page;
  await p.goto(APP, { waitUntil: "networkidle" });

  await scene("intro", "sender", async () => {
    await sleep(2500);
  });
  await scene("how", "sender", async () => {
    await smoothScroll(p, 640, 2200);
    await sleep(1500);
    await p.locator("#countries").scrollIntoViewIfNeeded();
    await smoothScroll(p, (await p.locator("#countries").evaluate((e) => e.getBoundingClientRect().top + window.scrollY)) - 40, 1800);
    await sleep(2500);
    await smoothScroll(p, 0, 1500);
  });

  await scene("connect", "sender", async () => {
    await click(p, p.getByRole("link", { name: /Send money/ }).first());
    await p.waitForURL(/\/send/);
    await connectPassport(p);
    const signIn = p.getByRole("button", { name: "Sign in" });
    await signIn.waitFor({ state: "visible", timeout: 30_000 });
    await click(p, signIn);
    await p.getByText("Where are you sending money?").waitFor({ timeout: 60_000 });
    // Name shown to the recipient (only because the sender opts in on the review step).
    await p.request.patch(`${APP}/api/settings`, { data: { displayName: "Arjun" } });
  });

  await scene("country", "sender", async () => {
    await click(p, p.getByText("Philippines", { exact: false }).first());
    await click(p, p.getByRole("button", { name: "Continue" }));
  });

  await scene("amount", "sender", async () => {
    await type(p, p.getByPlaceholder("0.00"), AMOUNT);
    await sleep(600);
    await click(p, p.getByRole("button", { name: "Continue" }));
  });

  await scene("recipient", "sender", async () => {
    await click(p, p.getByText("I don't know their wallet"));
    await type(p, p.locator("#l-name"), "Maria (cousin)");
    await click(p, p.getByRole("button", { name: "Continue" }));
  });

  await scene("delivery", "sender", async () => {
    await click(p, p.getByText("Claim link", { exact: true }).first()).catch(() => undefined);
    await click(p, p.locator('input[name="expiry"][value="7d"]'));
    await click(p, p.getByRole("button", { name: "Review" }));
  });

  await scene("review", "sender", async () => {
    await p.getByText("Check the details").waitFor();
    await sleep(2500);
    await type(p, p.locator("#note"), "Happy birthday, Maria!");
    const showName = p.getByRole("checkbox").last();
    if ((await showName.getAttribute("data-state")) !== "checked") await click(p, showName);
    await smoothScroll(p, 2000, 1200);
  });

  let link = "";
  await scene("fund", "sender", async () => {
    await click(p, p.getByRole("button", { name: /^Send / }));
    const open = p.getByRole("button", { name: "Open wallet" });
    if (await open.isVisible({ timeout: 8000 }).catch(() => false)) await click(p, open);
    // Depending on timing the app shows "Continue" or goes straight to the link.
    const cont = p.getByRole("button", { name: "Continue" });
    await cont.or(p.locator("#claim-link")).first().waitFor({ timeout: 180_000 });
    if (await cont.isVisible().catch(() => false)) await click(p, cont);
    await p.locator("#claim-link").waitFor({ timeout: 60_000 });
    link = await p.locator("#claim-link").inputValue();
  });

  await scene("link", "sender", async () => {
    await moveTo(p, p.locator("#claim-link"));
    await sleep(1500);
    await click(p, p.getByRole("button", { name: /Show QR code/ }));
    await sleep(2500);
  });
  const trackHref = await p.getByRole("link", { name: "Track transfer" }).first().getAttribute("href").catch(() => null);
  const trackUrl = trackHref ? new URL(trackHref, APP).toString() : null;

  // ---- recipient
  const R = await newCtx(browser, "recipient", recipientKey);
  const r = R.page;
  await r.goto(link, { waitUntil: "networkidle" });

  await scene("claim_open", "recipient", async () => {
    await r.getByText(/MUSD/).first().waitFor();
    await sleep(3000);
  });
  await scene("claim_connect", "recipient", async () => {
    await connectPassport(r);
    await r.getByRole("button", { name: /^Claim / }).first().waitFor({ timeout: 60_000 });
  });
  await scene("claim", "recipient", async () => {
    await click(r, r.getByRole("button", { name: /^Claim / }).first());
    await r.getByRole("heading", { name: /^You received/ }).waitFor({ timeout: 180_000 });
  });
  await scene("claimed", "recipient", async () => {
    await sleep(1500);
    const tx = r.getByRole("link", { name: /See it on the explorer/i }).first();
    if (await tx.isVisible().catch(() => false)) await moveTo(r, tx);
    await sleep(2000);
  });

  // ---- back to sender, on a fresh page of the same session. Playwright records each page to its own file, and
  // an idle background page gets no frames, so the first sender video can't be trusted past the recipient part.
  const p2 = await S.ctx.newPage();
  pages.sender2 = p2;
  t0.sender2 = Date.now();
  await p2.goto(trackUrl ?? `${APP}/history`, { waitUntil: "networkidle" });
  if (!trackUrl) await p2.getByRole("link", { name: /Maria/ }).first().click();
  // Wait (off-camera: before the scene starts) for the verified claimed state, reloading while Mezo confirms.
  const done = p2.getByText("Your recipient claimed the MUSD", { exact: false }).first();
  for (let i = 0; i < 30 && !(await done.isVisible().catch(() => false)); i++) {
    await sleep(4000);
    if (i % 3 === 2) await p2.reload({ waitUntil: "networkidle" });
  }
  await done.waitFor({ timeout: 30_000 });

  await scene("track", "sender2", async () => {
    await sleep(2500);
    await smoothScroll(p2, 500, 1500);
  });
  await scene("outro", "sender2", async () => {
    await p2.goto(APP, { waitUntil: "networkidle" });
    await sleep(1200);
    await smoothScroll(p2, 99999, 3000);
    await sleep(3000);
  });

  const vids: Record<string, string> = {};
  const recorded = { sender: S.page, sender2: p2, recipient: R.page };
  const paths = Object.fromEntries(await Promise.all(Object.entries(recorded).map(async ([k, pg]) => [k, (await pg.video()!.path()) as string])));
  await S.ctx.close();
  await R.ctx.close();
  Object.assign(vids, paths);
  await browser.close();
  fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify({ videos: vids, marks, link: link.replace(/#.*/, "#k=…") }, null, 2));
  console.log("recorded", vids);
}

main().catch((e) => {
  if (e instanceof Stop) {
    console.log(e.message);
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
});
