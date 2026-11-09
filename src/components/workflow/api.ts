import type { z } from "zod";
import type { GenerateRequest, ProjectMode } from "@/lib/validation/requests";
import {
  generateResponseSchema,
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

/** Calls the generation endpoint and checks the response shape at runtime. */
export function requestGeneration(
  request: GenerateRequest,
  signal: AbortSignal,
): Promise<GenerateResponse> {
  return postJson("/api/generate", request, generateResponseSchema, signal);
}

/**
 * Asks the server to build one ZIP for the successful results of a generation
 * run. Returns the ZIP, or undefined when the server did not send one.
 */
export async function requestArchive(
  results: readonly GenerateSuccess[],
  project: ProjectMode,
): Promise<Blob | undefined> {
  const request: ArchiveRequest = { results: [...results], project };
  const response = await fetch("/api/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok || response.headers.get("content-type") !== "application/zip") return undefined;
  const bytes = await response.arrayBuffer();
  return new Blob([bytes], { type: "application/zip" });
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
