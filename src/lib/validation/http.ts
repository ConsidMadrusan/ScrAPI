import type { Problem } from "./problems";
import type { FailureResponse } from "./responses";

/** A JSON failure response in the shape every route uses: `{ ok: false, errors }`. */
export function failureResponse(status: number, errors: readonly Problem[]): Response {
  const response: FailureResponse = { ok: false, errors: [...errors] };
  return Response.json(response, { status });
}

/**
 * An unexpected server problem: logs its type only (never details, URLs, or
 * content, which may echo user input) and answers 500 with `message`.
 */
export function internalErrorResponse(context: string, error: unknown, message: string): Response {
  console.error(context, { error: error instanceof Error ? error.name : typeof error });
  return failureResponse(500, [{ code: "internal", message }]);
}
