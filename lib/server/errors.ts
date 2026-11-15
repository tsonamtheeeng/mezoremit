// Typed API errors → ApiError JSON ({ error: { code, message, details? } }).
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Sign in with your wallet first") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource") => new HttpError(403, "forbidden", message);
export const notFound = (message = "Not found") => new HttpError(404, "not_found", message);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) => new HttpError(422, code, message, details);
export const tooMany = (message = "Too many requests, slow down") => new HttpError(429, "rate_limited", message);
export const unavailable = (code: string, message: string) => new HttpError(503, code, message);
