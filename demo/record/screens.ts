// Screenshots of the live app (desktop 1440x900 @2x, mobile 390x844 @3x) → demo/screenshots/*.png
//
//   SENDER_PRIVATE_KEY=0x… RECIPIENT_PRIVATE_KEY=0x… npx tsx demo/record/screens.ts
//
// Public pages need no keys. Signed-in pages use the injected wallet (wallet.ts). With CLAIM_DEMO=1 the recipient
// wallet creates a 1 MUSD claim link to capture the link panel and the claim page, then cancels it (money returns).

import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Hex } from "viem";
import { attachWallet } from "./wallet";

const APP = process.env.APP_URL || "https://mezoremit.vercel.app";
const OUT = path.join(__dirname, "..", "screenshots");
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shots: string[] = [];

async function ctxFor(browser: Browser, opts: object, key?: Hex) {
  const ctx = await browser.newContext({ ...opts, colorScheme: "light" });
  await ctx.addInitScript("window.__mzNoCursor = true;");
  if (key) await attachWallet(ctx, key);
  return ctx;
}

async function shot(page: Page, name: string, opts: { full?: boolean; el?: string } = {}) {
  await sleep(700);
  const file = path.join(OUT, `${name}.png`);
  if (opts.el) await page.locator(opts.el).first().screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: Boolean(opts.full) });
  shots.push(name);
  console.log("📸", name);
}

async function scrollTo(page: Page, selector: string, offset = 24) {
  await page.evaluate(
    ([sel, off]) => {
      const el = document.querySelector(sel as string);
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (off as number));
    },
    [selector, offset],
  );
  await sleep(500);
}

async function signIn(page: Page, path = "/send") {
  await page.goto(APP + path, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.getByRole("button", { name: /Browser Wallet/i }).first().click();
  const btn = page.getByRole("button", { name: "Sign in" });
  await btn.waitFor({ timeout: 30_000 });
  await sleep(800);
  await btn.click();
  await btn.waitFor({ state: "detached", timeout: 60_000 });
  await sleep(1500);
}

async function publicPages(browser: Browser) {
  const ctx = await ctxFor(browser, DESKTOP);
  const p = await ctx.newPage();
  await p.goto(APP, { waitUntil: "networkidle" });
  await shot(p, "01-landing-hero");
  await scrollTo(p, "#how-it-works", 0);
  await shot(p, "02-how-it-works");
  await scrollTo(p, "#pricing", 0);
  await shot(p, "03-pricing");
  await scrollTo(p, "#countries", 0);
  await shot(p, "04-countries");
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(p, "05-footer-testnet-contracts");
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, "06-landing-full-page", { full: true });
  await p.goto(`${APP}/help`, { waitUntil: "networkidle" });
  await shot(p, "07-help");
  await p.goto(`${APP}/this-page-does-not-exist`, { waitUntil: "networkidle" });
  await shot(p, "08-not-found");
  await ctx.close();

  const m = await ctxFor(browser, MOBILE);
  const mp = await m.newPage();
  await mp.goto(APP, { waitUntil: "networkidle" });
  await shot(mp, "09-mobile-landing");
  await scrollTo(mp, "#countries", 0);
  await shot(mp, "10-mobile-countries");
  await m.close();
}

async function senderPages(browser: Browser, key: Hex) {
  const ctx = await ctxFor(browser, DESKTOP, key);
  const p = await ctx.newPage();
  await p.goto(`${APP}/send`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Connect wallet" }).first().click();
  await p.getByRole("button", { name: /Browser Wallet/i }).first().waitFor();
  await sleep(800);
  await shot(p, "11-connect-mezo-passport");
  await p.getByRole("button", { name: /Browser Wallet/i }).first().click();
  await p.getByRole("button", { name: "Sign in" }).waitFor();
  await shot(p, "12-sign-in");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.getByText("Where are you sending money?").waitFor({ timeout: 60_000 });
  await p.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
  await sleep(1500);
  await shot(p, "18-activity-dashboard");
  await p.goto(`${APP}/history`, { waitUntil: "networkidle" });
  await sleep(1500);
  await shot(p, "19-history");
  // Most recent claimed transfer → tracking page.
  const claimed = p.getByRole("link").filter({ hasText: /Claimed/ }).first();
  if (await claimed.isVisible().catch(() => false)) {
    await claimed.click();
    await p.getByText("Tracking").first().waitFor({ timeout: 30_000 });
    await sleep(1500);
    await shot(p, "20-transfer-tracking", { full: true });
  }
  await ctx.close();
}

async function recipientPages(browser: Browser, key: Hex) {
  const ctx = await ctxFor(browser, DESKTOP, key);
  const p = await ctx.newPage();
  await signIn(p, "/send");
  await p.goto(`${APP}/received`, { waitUntil: "networkidle" });
  const gate = p.getByRole("button", { name: "Sign in" });
  if (await gate.isVisible({ timeout: 4000 }).catch(() => false)) {
    await sleep(800);
    await gate.click();
    await p.getByText("Sign in to see money you received").waitFor({ state: "detached", timeout: 60_000 });
  }
  await sleep(2500);
  await shot(p, "21-received");

  // The send flow, from this wallet (it holds MUSD; the deployer wallet is spent).
  await p.goto(`${APP}/send`, { waitUntil: "networkidle" });
  const again = p.getByRole("button", { name: "Sign in" });
  if (await again.isVisible({ timeout: 5000 }).catch(() => false)) {
    await sleep(800);
    await again.click();
    await again.waitFor({ state: "detached", timeout: 60_000 });
  }
  await p.getByText("Where are you sending money?").waitFor({ timeout: 60_000 });
  await shot(p, "13-send-country");
  await p.getByText("Philippines").first().click();
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByPlaceholder("0.00").fill("25");
  await shot(p, "14-send-amount");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByText("I don't know their wallet").click();
  await p.locator("#l-name").fill("Maria (cousin)");
  await shot(p, "15-send-recipient");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByText("Claim link", { exact: true }).first().click().catch(() => undefined);
  await p.locator('input[name="expiry"][value="7d"]').click();
  await shot(p, "16-send-delivery");
  await p.getByRole("button", { name: "Review" }).click();
  await p.getByText("Check the details").waitFor();
  await p.locator("#note").fill("Happy birthday, Maria!");
  await p.getByText(/1 MUSD ≈/).first().waitFor({ timeout: 30_000 }).catch(() => undefined); // peso rate loaded
  await scrollTo(p, "h1, h2", 150);
  await p.evaluate(() => {
    const h = [...document.querySelectorAll("h1,h2,h3")].find((e) => e.textContent?.includes("Check the details"));
    if (h) window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 150);
  });
  await shot(p, "17-send-review");


  if (process.env.CLAIM_DEMO !== "1") return ctx.close();
  // A 1 MUSD claim link from this wallet, to capture the link panel and the recipient's claim page.
  await p.request.patch(`${APP}/api/settings`, { data: { displayName: "Maria" } });
  await p.goto(`${APP}/send`, { waitUntil: "networkidle" });
  await p.getByText("Where are you sending money?").waitFor({ timeout: 60_000 });
  await p.getByText("Mexico").first().click();
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByPlaceholder("0.00").fill("1");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByText("I don't know their wallet").click();
  await p.locator("#l-name").fill("Carlos");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByText("Claim link", { exact: true }).first().click().catch(() => undefined);
  await p.locator('input[name="expiry"][value="1d"]').click();
  await p.getByRole("button", { name: "Review" }).click();
  await p.locator("#note").fill("Para el café ☕");
  const showName = p.getByRole("checkbox").last();
  if ((await showName.getAttribute("data-state")) !== "checked") await showName.click();
  await p.getByRole("button", { name: /^Send / }).click();
  const open = p.getByRole("button", { name: "Open wallet" });
  if (await open.isVisible({ timeout: 8000 }).catch(() => false)) await open.click();
  const cont = p.getByRole("button", { name: "Continue" });
  await cont.or(p.locator("#claim-link")).first().waitFor({ timeout: 180_000 });
  if (await cont.isVisible().catch(() => false)) await cont.click();
  await p.locator("#claim-link").waitFor({ timeout: 60_000 });
  await p.getByRole("button", { name: /Show QR code/ }).click();
  await shot(p, "22-claim-link-ready", { full: true });
  const link = await p.locator("#claim-link").inputValue();
  const trackHref = await p.getByRole("link", { name: "Track transfer" }).first().getAttribute("href");

  // The claim page as the recipient sees it (no wallet connected), desktop and mobile.
  for (const [opts, name] of [
    [DESKTOP, "23-claim-page"],
    [MOBILE, "24-mobile-claim-page"],
  ] as const) {
    const c: BrowserContext = await ctxFor(browser, opts);
    const cp = await c.newPage();
    await cp.goto(link, { waitUntil: "networkidle" });
    await cp.getByText(/sent you money/).first().waitFor({ timeout: 60_000 });
    await sleep(1500);
    await shot(cp, name, { full: true });
    await c.close();
  }

  // Cancel it from the tracking page so the 1 MUSD comes back.
  if (trackHref) {
    await p.goto(new URL(trackHref, APP).toString(), { waitUntil: "networkidle" });
    const cancel = p.getByRole("button", { name: /Cancel/ }).first();
    if (await cancel.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await cancel.click();
      const confirm = p.getByRole("dialog").getByRole("button", { name: /Cancel/ }).last();
      if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) await shot(p, "25-cancel-transfer-dialog");
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
      await sleep(15_000);
    } else console.warn("cancel button not found; cancel the 1 MUSD link manually");
  }
  await ctx.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    if (!process.env.ONLY) await publicPages(browser);
    const s = process.env.SENDER_PRIVATE_KEY as Hex | undefined;
    const r = process.env.RECIPIENT_PRIVATE_KEY as Hex | undefined;
    if (s && !process.env.ONLY) await senderPages(browser, s);
    if (r) await recipientPages(browser, r);
  } catch (e) {
    for (const c of browser.contexts()) for (const [i, pg] of c.pages().entries()) await pg.screenshot({ path: path.join(OUT, `_fail-${i}.png`) }).catch(() => undefined);
    throw e;
  } finally {
    await browser.close();
  }
  console.log(`${shots.length} screenshots → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
