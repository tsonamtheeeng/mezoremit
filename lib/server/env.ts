// Server-side runtime configuration (read lazily so tests and the worker can set process.env first).

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

function num(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? fallback : Number(raw);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

export const env = {
  isProd: () => process.env.NODE_ENV === "production",
  isTest: () => Boolean(process.env.VITEST),
  /** Blocks a log must be buried under before it counts as settlement truth. */
  confirmations: () => Math.floor(num("CONFIRMATIONS", 2, 0)),
  workerIntervalMs: () => num("WORKER_INTERVAL_MS", 10_000, 1000),
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  sessionSecret(): string {
    const s = process.env.SESSION_SECRET;
    if (s && s.length >= 32) return s;
    if (env.isProd()) throw new Error("SESSION_SECRET must be set (>= 32 chars) in production");
    return "dev-only-insecure-session-secret-change-me-0000";
  },
  indexerSecret: () => process.env.INDEXER_SECRET || "",
  /** Re-read chain state for every non-terminal transfer every N indexer passes. */
  reconcileEvery: () => Math.floor(num("RECONCILE_EVERY", 20, 1)),
  /** Blocks to rewind when the cursor block hash no longer matches the chain. */
  reorgWindow: () => Math.floor(num("REORG_WINDOW", 20, 1)),
  /** A funding tx hint with no confirmed event after this long → failed. */
  fundingTimeoutSec: () => num("FUNDING_TIMEOUT_SECONDS", 30 * 60, 60),
  fxReferenceUrl: () => process.env.FX_REFERENCE_URL || "https://open.er-api.com/v6/latest/USD",
  fxFallbackUrl: () => process.env.FX_FALLBACK_URL || "https://api.frankfurter.dev/v2/rates",
  relayerPrivateKey: () => (process.env.RELAYER_PRIVATE_KEY || "").trim(),
  resendApiKey: () => process.env.RESEND_API_KEY || "",
  emailFrom: () => process.env.EMAIL_FROM || "",
  emailConfigured: () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  /** HMAC secret for a payout provider's webhooks (PROVIDER_WEBHOOK_SECRET_<ID>). Dev fallback outside production. */
  providerWebhookSecret(provider: string): string | null {
    const v = process.env[`PROVIDER_WEBHOOK_SECRET_${provider.toUpperCase()}`];
    if (v && v.length >= 16) return v;
    if (env.isProd()) return null;
    return `dev-only-webhook-secret-${provider}`;
  },
  /** Where the sandbox payout simulator POSTs its signed webhooks. */
  sandboxWebhookUrl: () => process.env.SANDBOX_WEBHOOK_URL || `${env.appUrl()}/api/webhooks/sandbox`,
  /** Sandbox payout simulation timings (seconds after the request). */
  sandboxProcessingAfterSec: () => num("SANDBOX_PROCESSING_AFTER_SECONDS", 10, 0),
  sandboxCompleteAfterSec: () => num("SANDBOX_COMPLETE_AFTER_SECONDS", 30, 0),
  demoMode: () => truthy(process.env.NEXT_PUBLIC_DEMO_MODE),
};
