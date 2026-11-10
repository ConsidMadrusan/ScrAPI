import type { z } from "zod";
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

const UNEXPECTED: FailureResponse = {
  ok: false,
  errors: [
    {
      code: "unexpected-response",
      message: "The server sent an unexpected response. Try again.",
    },
  ],
};

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
  const response = await fetch("/api/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (response.ok && response.headers.get("content-type") === "application/zip") {
    const bytes = await response.arrayBuffer();
    return { ok: true, zip: new Blob([bytes], { type: "application/zip" }) };
  }
  try {
    const parsed = failureResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : UNEXPECTED;
  } catch {
    return UNEXPECTED;
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
    return parsed.success ? parsed.data : UNEXPECTED;
  } catch {
    return UNEXPECTED;
  }
}
