import { validateResponseSchema, type ValidateResponse } from "@/lib/validation/responses";

const UNEXPECTED: ValidateResponse = {
  ok: false,
  errors: [
    {
      code: "unexpected-response",
      message: "The server could not validate the specification. Try again.",
    },
  ],
};

/** Calls the validation endpoint and checks the response shape at runtime. */
export async function requestValidation(
  spec: string,
  signal: AbortSignal,
): Promise<ValidateResponse> {
  const response = await fetch("/api/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spec }),
    signal,
  });
  try {
    const parsed = validateResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : UNEXPECTED;
  } catch {
    return UNEXPECTED;
  }
}
