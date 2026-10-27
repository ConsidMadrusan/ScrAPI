import type { Problem } from "./problems";
import type { FailureResponse } from "./responses";

/** A JSON `{ ok: false, errors }` response with the given status. */
export function failure(status: number, errors: Problem[]): Response {
  const response: FailureResponse = { ok: false, errors };
  return Response.json(response, { status });
}

/** Counts running requests of one kind. A process-wide resource counter that holds no request data. */
export interface ConcurrencyLimiter {
  /** Takes a slot and returns the function that frees it, or `undefined` when every slot is taken. */
  tryAcquire(): (() => void) | undefined;
}

export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  let active = 0;
  return {
    tryAcquire() {
      if (active >= max) return undefined;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}

/**
 * Wraps a Route Handler so it runs only while it holds a slot from `limiter`.
 * The slot is taken before the body is read or parsed, so a busy server
 * answers 503 with `busy` without doing that work, and it is freed when the
 * handler finishes or throws.
 */
export function withConcurrencyLimit(
  limiter: ConcurrencyLimiter,
  busy: Problem,
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const release = limiter.tryAcquire();
    if (!release) return failure(503, [busy]);
    try {
      return await handler(request);
    } finally {
      release();
    }
  };
}

export interface ProblemHandlingOptions {
  /** Logged with the error type when the handler throws, e.g. `Generation crashed`. */
  logMessage: string;
  /** Shown to the user when the handler throws. */
  userMessage: string;
}

/**
 * Wraps a Route Handler so that anything it throws (a client disconnect while
 * reading the body, an unexpected bug) becomes a 500 `FailureResponse`. Only
 * the error type is logged, never its message, details, or request content.
 */
export function withProblemHandling(
  handler: (request: Request) => Promise<Response>,
  options: ProblemHandlingOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      console.error(options.logMessage, {
        error: error instanceof Error ? error.name : typeof error,
      });
      return failure(500, [{ code: "internal", message: options.userMessage }]);
    }
  };
}
