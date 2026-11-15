// MezoRemit background worker (Render): indexer (+ reconciliation every RECONCILE_EVERY passes) → expiry sweep →
// pending tx hints → sandbox payout simulator (signed webhooks) → email deliveries → heartbeat, every
// WORKER_INTERVAL_MS. Backs off exponentially (capped at 2 min) while passes fail, e.g. during an RPC outage.
//   npm run worker         # loop
//   npm run worker:once    # single pass, then exit (non-zero if a step failed)

import "./load-env";
import { contracts, isDeployed } from "@/lib/chain/config";
import { getRelayer } from "@/lib/server/chain";
import { closeDb, dbKind, getDb } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { runWorkerPass } from "@/lib/server/worker";

const once = process.argv.includes("--once");
let stopping = false;
let wake: (() => void) | null = null;

function log(msg: string, extra?: Record<string, unknown>) {
  const x = extra ? " " + JSON.stringify(extra, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : "";
  console.log(`${new Date().toISOString()} [worker] ${msg}${x}`);
}

function onSignal(sig: string) {
  if (stopping) return;
  stopping = true;
  log(`${sig} received: finishing the current pass, then exiting`);
  wake?.();
}
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));

async function main() {
  const sql = await getDb();
  const relayer = getRelayer();
  log("starting", {
    db: dbKind(),
    deployed: isDeployed,
    manager: contracts.manager,
    deployBlock: contracts.deployBlock.toString(),
    confirmations: env.confirmations(),
    intervalMs: env.workerIntervalMs(),
    relayer: relayer ? relayer.address : "disabled",
    email: env.emailConfigured() ? "resend" : "disabled",
  });
  if (!isDeployed) log("NEXT_PUBLIC_MANAGER_ADDRESS unset: indexer idle (sweeps, sandbox payouts and emails still run)");

  let failures = 0;
  while (!stopping) {
    const r = await runWorkerPass(sql).catch((e) => {
      log("pass crashed", { error: (e as Error).message });
      return null;
    });
    if (r) log("pass", { ...r });
    failures = r?.ok ? 0 : failures + 1;
    if (once) {
      await closeDb();
      process.exit(r?.ok ? 0 : 1);
    }
    const delay = Math.min(env.workerIntervalMs() * 2 ** Math.min(failures, 4), 120_000);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, delay);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
    wake = null;
  }
  await closeDb();
  log("stopped");
  process.exit(0);
}

main().catch(async (e) => {
  console.error("[worker] fatal", e);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
