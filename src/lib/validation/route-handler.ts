import type { Problem } from "./problems";
import type { FailureResponse } from "./responses";

/** A JSON `{ ok: false, errors }` response with the given status. */
export function failure(status: number, errors: Problem[]): Response {
  const response: FailureResponse = { ok: false, errors };
  return Response.json(response, { status });
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
