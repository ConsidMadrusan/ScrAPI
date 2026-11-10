import type { z } from "zod";
import { ARCHIVE_REQUEST_TIMEOUT_MS } from "@/lib/validation/limits";
import type { GenerateRequest, GraphqlGenerateRequest, ProjectMode } from "@/lib/validation/requests";
import {
  failureResponseSchema,
  generateResponseSchema,
  graphqlValidateResponseSchema,
  type GraphqlValidateResponse,
  validateResponseSchema,
  type ArchiveRequest,
  type FailureResponse,
  type GenerateResponse,
  type GenerateSuccess,
  type ValidateResponse,
} from "@/lib/validation/responses";

/**
 * The answer when the server's response is not in the expected shape, for
 * example an HTML error page from a proxy in front of ScrAPI. The HTTP status
 * still tells what kind of problem it was.
 */
export function unexpectedResponse(status: number): FailureResponse {
  const message =
    status === 413
      ? "The request is too large for the server. Select fewer operations or framework combinations, or use a smaller specification."
      : status === 502 || status === 503
        ? "The server is not available right now. Try again in a moment."
        : status === 504
          ? "The server took too long to answer. Try again, or select fewer operations."
          : status >= 500
            ? `The server had a problem (HTTP ${String(status)}). Try again.`
            : `The server sent an unexpected response (HTTP ${String(status)}). Try again.`;
  return { ok: false, errors: [{ code: "unexpected-response", message }] };
}

/** Calls the validation endpoint and checks the response shape at runtime. */
export function requestValidation(spec: string, signal: AbortSignal): Promise<ValidateResponse> {
  return postJson("/api/validate", { spec }, validateResponseSchema, signal);
}

/** Calls the GraphQL validation endpoint with SDL or introspection JSON. */
export function requestGraphqlValidation(schema: string, signal: AbortSignal): Promise<GraphqlValidateResponse> {
  return postJson("/api/graphql/validate", { schema }, graphqlValidateResponseSchema, signal);
}

/** Calls the GraphQL generation endpoint for one framework combination. */
export function requestGraphqlGeneration(
  request: GraphqlGenerateRequest,
  signal: AbortSignal,
): Promise<GenerateResponse> {
  return postJson("/api/graphql/generate", request, generateResponseSchema, signal);
}

/** Calls the generation endpoint and checks the response shape at runtime. */
export function requestGeneration(
  request: GenerateRequest,
  signal: AbortSignal,
): Promise<GenerateResponse> {
  return postJson("/api/generate", request, generateResponseSchema, signal);
}

export type ArchiveResponse = { ok: true; zip: Blob } | FailureResponse;

/**
 * Asks the server to build one ZIP for the successful results of a generation
 * run. Returns the ZIP, or the server's problems (for example "busy" or "too
 * large") so the page can say what went wrong.
 */
export async function requestArchive(
  results: readonly GenerateSuccess[],
  project: ProjectMode,
): Promise<ArchiveResponse> {
  const request: ArchiveRequest = { results: [...results], project };
  const signal = AbortSignal.timeout(ARCHIVE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("/api/archive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    // A proxy may add parameters, e.g. `application/zip; charset=binary`.
    if (response.ok && (response.headers.get("content-type") ?? "").startsWith("application/zip")) {
      const bytes = await response.arrayBuffer();
      return { ok: true, zip: new Blob([bytes], { type: "application/zip" }) };
    }
    try {
      const parsed = failureResponseSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : unexpectedResponse(response.status);
    } catch {
      return unexpectedResponse(response.status);
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    return {
      ok: false,
      errors: [
        {
          code: "archive-timeout",
          message: `The ZIP file was not ready within ${String(ARCHIVE_REQUEST_TIMEOUT_MS / 1000)} seconds. Try again, or select fewer framework combinations.`,
        },
      ],
    };
  }
}

async function postJson<T>(
  url: string,
  body: unknown,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T | FailureResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  try {
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : unexpectedResponse(response.status);
  } catch {
    return unexpectedResponse(response.status);
  }
}
