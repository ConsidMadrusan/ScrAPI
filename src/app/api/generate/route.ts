import { generateClient } from "@/lib/generation/generate";
import { prepareGeneration } from "@/lib/generation/prepare";
import { specFailureStatus } from "@/lib/openapi/errors";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { problemsFromZod, type Problem } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { generateRequestSchema } from "@/lib/validation/requests";
import type { FailureResponse } from "@/lib/validation/responses";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return failure(body.status, [body.problem]);

  const input = generateRequestSchema.safeParse(body.value);
  if (!input.success) return failure(400, problemsFromZod(input.error));

  const prepared = await prepareGeneration(input.data);
  if (!prepared.ok) return failure(specFailureStatus(prepared.errors), prepared.errors);

  try {
    const result = await generateClient(prepared.value, request.signal);
    if (!result.ok) return failure(result.status, result.errors);
    return Response.json(result.value);
  } catch (error) {
    // Unexpected server problem: report its type only, never details or content.
    console.error("Generation crashed", { error: error instanceof Error ? error.name : typeof error });
    return failure(500, [{ code: "internal", message: "Something went wrong while generating. Try again." }]);
  }
}

function failure(status: number, errors: Problem[]): Response {
  const response: FailureResponse = { ok: false, errors };
  return Response.json(response, { status });
}
