import { describeOpenApi } from "@/lib/source/describe";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { failureResponse, internalErrorResponse } from "@/lib/validation/http";
import { problemsFromZod } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { validateRequestSchema } from "@/lib/validation/requests";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return failureResponse(body.status, [body.problem]);

  const input = validateRequestSchema.safeParse(body.value);
  if (!input.success) return failureResponse(400, problemsFromZod(input.error));

  try {
    const result = await describeOpenApi(input.data.spec);
    if (!result.ok) return failureResponse(result.status, result.errors);
    return Response.json(result);
  } catch (error) {
    return internalErrorResponse("Validation crashed", error, "Something went wrong while validating. Try again.");
  }
}
