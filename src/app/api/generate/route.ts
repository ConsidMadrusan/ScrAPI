import { generateClient } from "@/lib/generation/generate";
import { isGeneratorBusy } from "@/lib/generation/java-generator";
import { prepareGeneration } from "@/lib/generation/prepare";
import { specFailureStatus } from "@/lib/openapi/errors";
import { failureResponse, internalErrorResponse } from "@/lib/validation/http";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { problemsFromZod } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { generateRequestSchema } from "@/lib/validation/requests";

export async function POST(request: Request): Promise<Response> {
  // Answer "busy" before the specification is read and validated again for nothing.
  if (isGeneratorBusy()) {
    return failureResponse(503, [
      { code: "generator-busy", message: "The server is busy generating other clients. Try again in a moment." },
    ]);
  }

  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return failureResponse(body.status, [body.problem]);

  const input = generateRequestSchema.safeParse(body.value);
  if (!input.success) return failureResponse(400, problemsFromZod(input.error));

  try {
    const prepared = await prepareGeneration(input.data);
    if (!prepared.ok) return failureResponse(specFailureStatus(prepared.errors), prepared.errors);

    const result = await generateClient(prepared.value, request.signal);
    if (!result.ok) return failureResponse(result.status, result.errors);
    return Response.json(result.value);
  } catch (error) {
    return internalErrorResponse("Generation crashed", error, "Something went wrong while generating. Try again.");
  }
}
