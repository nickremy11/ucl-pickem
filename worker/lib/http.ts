import { HTTPException } from "hono/http-exception";

export function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

export function unauthorized(message = "Sign in to continue"): never {
  throw new HTTPException(401, { message });
}

export function forbidden(message = "You do not have access to this"): never {
  throw new HTTPException(403, { message });
}

export function notFound(message = "Not found"): never {
  throw new HTTPException(404, { message });
}

export function conflict(message: string): never {
  throw new HTTPException(409, { message });
}

export function tooManyRequests(message = "Too many attempts. Try again shortly."): never {
  throw new HTTPException(429, { message });
}

/**
 * Auth failures deliberately return one undifferentiated message so the
 * response cannot be used to enumerate which emails have accounts.
 */
export const GENERIC_AUTH_ERROR = "That email and password combination did not match.";
