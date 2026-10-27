import type { z } from "zod";
import type { GenerateRequest } from "@/lib/validation/requests";
import {
  generateResponseSchema,
  validateResponseSchema,
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
 * Asks the server to build the ZIP for a generation result. Returns the ZIP,
 * or undefined when the server did not send one.
 */
export async function requestArchive(result: GenerateSuccess): Promise<Blob | undefined> {
  const response = await fetch("/api/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
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
