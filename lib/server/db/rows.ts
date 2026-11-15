// Driver-neutral row value normalisers (postgres.js returns int8 as string, PGlite as number; both return
// NUMERIC as string, TIMESTAMPTZ as Date, JSONB as parsed value).

export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}
export function strOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
export function int(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}
export function big(v: unknown): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  const s = String(v);
  return BigInt(s.includes(".") ? s.slice(0, s.indexOf(".")) : s);
}
/** Decimal string for NUMERIC columns ("0" when null). */
export function dec(v: unknown): string {
  return big(v).toString();
}
export function date(v: unknown): Date {
  if (v instanceof Date) return v;
  return new Date(String(v));
}
export function iso(v: unknown): string {
  return date(v).toISOString();
}
export function isoOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : date(v).toISOString();
}
export function bool(v: unknown): boolean {
  return v === true || v === "t" || v === "true" || v === 1;
}
export function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}
/** unix seconds (bigint) → Date; 0 → null */
export function fromUnix(sec: bigint | number): Date | null {
  const n = Number(sec);
  return n === 0 ? null : new Date(n * 1000);
}
