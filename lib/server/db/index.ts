// DB access: one tagged-template API over postgres.js (DATABASE_URL set) or PGlite (embedded fallback).
//
//   const rows = await sql<{ id: string }>`SELECT id FROM plans WHERE slug = ${slug}`;
//   await sql.begin(async (tx) => { await tx`UPDATE ...`; });
//   const where = sql.frag`status = ${s}`;            // composable fragment
//   await sql`SELECT * FROM x WHERE ${where} ${sql.join([a, b], " AND ")}`;
//
// Values: bigint → decimal string, Date → ISO string, plain objects/arrays → JSON text (cast with ::jsonb in SQL).
// Type normalisation differs per driver (int8: string on postgres.js, number on PGlite) — use the row helpers
// in ./rows.ts (int/big/str/date) rather than trusting raw types.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Row = Record<string, unknown>;
export type DbKind = "postgres" | "pglite";

const FRAG = Symbol("sqlFragment");
export interface Fragment {
  [FRAG]: true;
  strings: readonly string[];
  values: unknown[];
}

export interface Sql {
  <T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  /** Run fn in a transaction. Nested calls reuse the outer transaction. */
  begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  frag(strings: TemplateStringsArray, ...values: unknown[]): Fragment;
  join(parts: Fragment[], sep: string): Fragment;
  /** Trusted raw SQL text (identifiers / ORDER BY). Never pass user input. */
  raw(text: string): Fragment;
  readonly kind: DbKind;
  readonly inTransaction: boolean;
}

interface Driver {
  kind: DbKind;
  query(text: string, params: unknown[]): Promise<Row[]>;
  exec(text: string): Promise<void>;
  transaction<T>(fn: (q: (text: string, params: unknown[]) => Promise<Row[]>) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Sentinel params value: run multi-statement text via the simple protocol (postgres.js only). */
const SIMPLE: unknown[] = [];

function isFragment(v: unknown): v is Fragment {
  return typeof v === "object" && v !== null && (v as Fragment)[FRAG] === true;
}

function makeFrag(strings: readonly string[], values: unknown[]): Fragment {
  return { [FRAG]: true, strings, values };
}

function serialize(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === "object") return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  return v;
}

/** Compile a (possibly nested) fragment to `$n` text + params. */
export function compile(f: Fragment): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const walk = (fr: Fragment): string => {
    let out = fr.strings[0];
    for (let i = 0; i < fr.values.length; i++) {
      const v = fr.values[i];
      if (isFragment(v)) out += walk(v);
      else {
        params.push(serialize(v));
        out += `$${params.length}`;
      }
      out += fr.strings[i + 1];
    }
    return out;
  };
  return { text: walk(f), params };
}

function buildSql(driver: Driver, q: (text: string, params: unknown[]) => Promise<Row[]>, inTx: boolean): Sql {
  const fn = (<T = Row>(strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, params } = compile(makeFrag(strings, values));
    return q(text, params) as Promise<T[]>;
  }) as Sql;
  Object.defineProperties(fn, {
    kind: { value: driver.kind },
    inTransaction: { value: inTx },
  });
  fn.frag = (strings, ...values) => makeFrag(strings, values);
  fn.join = (parts, sep) => {
    if (parts.length === 0) return makeFrag([""], []);
    const strings = ["", ...parts.slice(1).map(() => sep), ""];
    return makeFrag(strings, parts);
  };
  fn.raw = (text) => makeFrag([text], []);
  fn.begin = async <T>(cb: (tx: Sql) => Promise<T>): Promise<T> => {
    if (inTx) return cb(fn);
    return driver.transaction((tq) => cb(buildSql(driver, tq, true)));
  };
  return fn;
}

// ---------------------------------------------------------------- drivers

/**
 * Optional Postgres schema (DB_SCHEMA) so MezoRemit can share a database with other apps without touching their
 * tables. Set as the connection's search_path (needs a session-mode pooler or a direct connection) and created on
 * boot. Unset = the server default (public).
 */
export function dbSchema(): string | null {
  const s = process.env.DB_SCHEMA?.trim();
  if (!s) return null;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(s)) throw new Error("DB_SCHEMA must be a lowercase identifier (a-z, 0-9, _)");
  return s;
}

async function postgresDriver(url: string): Promise<Driver> {
  const { default: postgres } = await import("postgres");
  const schema = dbSchema();
  const client = postgres(url, {
    ...(schema ? { connection: { search_path: schema } } : {}),
    max: Number(process.env.DB_POOL_MAX || 5),
    prepare: false, // safe with transaction poolers (Neon/Supabase pgbouncer)
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  });
  return {
    kind: "postgres",
    query: async (text, params) => (await client.unsafe(text, params as never[])) as unknown as Row[],
    exec: async (text) => {
      await client.unsafe(text).simple();
    },
    transaction: async (cb) =>
      (await client.begin(async (tx) =>
        cb(async (text, params) =>
          params === SIMPLE
            ? ((await tx.unsafe(text).simple()) as unknown as Row[])
            : ((await tx.unsafe(text, params as never[])) as unknown as Row[]),
        ),
      )) as never,
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}

async function pgliteDriver(dataDir: string | undefined): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  // PGlite is a single connection: serialise top-level work so a transaction never interleaves with
  // queries issued by another async task.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work);
    chain = run.catch(() => undefined);
    return run;
  };
  return {
    kind: "pglite",
    query: (text, params) => serial(async () => (await db.query(text, params)).rows as Row[]),
    exec: (text) => serial(async () => void (await db.exec(text))),
    transaction: (cb) =>
      serial(() => db.transaction(async (tx) => cb(async (text, params) => (await tx.query(text, params)).rows as Row[]))),
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------- singleton

interface DbState {
  driver: Driver;
  sql: Sql;
}
const g = globalThis as unknown as { __mezoremitDb?: Promise<DbState> };

function schemaText(): string {
  const candidates = [
    path.join(process.cwd(), "lib/server/db/schema.sql"),
    (() => {
      try {
        return path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");
      } catch {
        return "";
      }
    })(),
  ].filter(Boolean);
  for (const p of candidates) if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  throw new Error("schema.sql not found (run from the repo root)");
}

function pgliteDir(): string | undefined {
  const v = process.env.PGLITE_DATA_DIR;
  if (v === "memory" || v === "memory://") return undefined;
  if (process.env.VITEST && !v) return undefined; // tests: in-memory by default
  return v || path.join(process.cwd(), ".data/pglite");
}

async function init(): Promise<DbState> {
  const url = process.env.DATABASE_URL;
  const driver = url ? await postgresDriver(url) : await pgliteDriver(pgliteDir());
  await migrate(driver);
  const sql = buildSql(driver, driver.query, false);
  return { driver, sql };
}

async function migrate(driver: Driver): Promise<void> {
  const text = schemaText();
  if (driver.kind === "postgres") {
    // Serialise concurrent boots (web + worker) with an advisory lock; schema runs via the simple protocol.
    await driver.transaction(async (q) => {
      await q("SELECT pg_advisory_xact_lock(31611001)", []);
      const schema = dbSchema();
      if (schema) await q(`CREATE SCHEMA IF NOT EXISTS "${schema}"`, SIMPLE);
      await q(text, SIMPLE);
    });
  } else {
    await driver.exec(text);
  }
}

export async function getDb(): Promise<Sql> {
  if (!g.__mezoremitDb) {
    g.__mezoremitDb = init();
    g.__mezoremitDb.catch(() => {
      g.__mezoremitDb = undefined;
    });
  }
  return (await g.__mezoremitDb).sql;
}

export function dbKind(): DbKind {
  return process.env.DATABASE_URL ? "postgres" : "pglite";
}

/** Tagged-template proxy that lazily initialises the DB. `await sql\`...\`` works at module scope. */
export const sql: Sql = (() => {
  const fn = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const db = await getDb();
    return db(strings, ...values);
  }) as unknown as Sql;
  fn.begin = async (cb) => (await getDb()).begin(cb);
  fn.frag = (strings, ...values) => makeFrag(strings, values);
  fn.join = (parts, sep) => {
    if (parts.length === 0) return makeFrag([""], []);
    return makeFrag(["", ...parts.slice(1).map(() => sep), ""], parts);
  };
  fn.raw = (text) => makeFrag([text], []);
  Object.defineProperties(fn, {
    kind: { get: () => dbKind() },
    inTransaction: { value: false },
  });
  return fn;
})();

export async function closeDb(): Promise<void> {
  const cur = g.__mezoremitDb;
  g.__mezoremitDb = undefined;
  if (cur) await (await cur).driver.close().catch(() => undefined);
}

/** Tests: empty every table of the (in-memory) DB, creating it on first use. Refuses on a real Postgres. */
export async function resetDbForTests(): Promise<Sql> {
  if (process.env.DATABASE_URL) throw new Error("resetDbForTests refuses to run against DATABASE_URL");
  const db = await getDb();
  const tables = await db<{ tablename: string }>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  if (tables.length) await db`TRUNCATE ${db.raw(tables.map((t) => `"${t.tablename}"`).join(", "))} RESTART IDENTITY CASCADE`;
  return db;
}
