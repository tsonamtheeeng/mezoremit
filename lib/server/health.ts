import type { HealthResponse } from "@/lib/api-types";
import { isDeployed } from "@/lib/chain/config";
import { dbKind, type Sql } from "./db";
import type { ChainAdapter, RelayerAdapter } from "./chain";
import { formatBtc, relayerState } from "./claims";
import { indexerStatus } from "./indexer";

export async function health(getSql: () => Promise<Sql>, chain: ChainAdapter, relayer: RelayerAdapter | null): Promise<HealthResponse> {
  let db: HealthResponse["db"] = dbKind();
  let sql: Sql | null = null;
  try {
    sql = await getSql();
    await sql`SELECT 1`;
  } catch {
    db = "error";
    sql = null;
  }
  let chainId: number | null = null;
  let latest: bigint | null = null;
  try {
    [chainId, latest] = await Promise.all([chain.chainId(), chain.getBlockNumber()]);
  } catch {
    /* rpc down */
  }
  const idx = sql ? await indexerStatus(sql).catch(() => ({ lastBlock: null, updatedAt: null })) : { lastBlock: null, updatedAt: null };
  const r = await relayerState(chain, relayer);
  return {
    ok: db !== "error" && chainId !== null,
    chainId,
    latestBlock: latest === null ? null : latest.toString(),
    indexer: {
      lastBlock: idx.lastBlock === null ? null : idx.lastBlock.toString(),
      lagBlocks: idx.lastBlock !== null && latest !== null ? Number(latest - idx.lastBlock) : null,
      updatedAt: idx.updatedAt ? idx.updatedAt.toISOString() : null,
    },
    deployed: isDeployed,
    db,
    relayer: { enabled: Boolean(relayer), address: relayer ? relayer.address.toLowerCase() : null, balanceBtc: formatBtc(r.balance) },
  };
}
