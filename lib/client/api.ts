import type { ApiError } from "@/lib/api-types";

/** Error thrown for any non-2xx API response; carries the API's error code. */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function fallbackCode(status: number): string {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "internal";
  return "bad_request";
}

/** Plain fallback text when the API didn't send a message (or isn't reachable). */
export function fallbackMessage(status: number): string {
  if (status === 401) return "Please sign in again.";
  if (status === 403) return "You don't have access to this.";
  if (status === 404) return "We couldn't find that.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "Our server had a problem. Try again in a moment.";
  return `Request failed (${status}).`;
}

/** Typed JSON fetch. Same-origin cookies only. Never put claim keys in `path` or `json`. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
      ...rest,
      headers: {
        Accept: "application/json",
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiClientError(0, "network", "Can't reach MezoRemit. Check your connection and try again.");
  }
  const type = res.headers.get("content-type") ?? "";
  const body: unknown = type.includes("application/json") ? await res.json().catch(() => null) : await res.text().catch(() => "");
  if (!res.ok) {
    const e = (body as ApiError | null)?.error;
    throw new ApiClientError(res.status, e?.code ?? fallbackCode(res.status), e?.message || fallbackMessage(res.status), e?.details);
  }
  return body as T;
}

export const isNotFound = (e: unknown) => e instanceof ApiClientError && e.status === 404;
export const isUnauthenticated = (e: unknown) => e instanceof ApiClientError && e.status === 401;

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
