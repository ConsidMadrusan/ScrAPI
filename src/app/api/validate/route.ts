import { specFailureStatus } from "@/lib/openapi/errors";
import { isJsonObject } from "@/lib/openapi/json";
import { validateSpecification } from "@/lib/openapi/validate";
import { groupByTag } from "@/lib/selection/operations";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { problemsFromZod, type Problem } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { validateRequestSchema } from "@/lib/validation/requests";
import type { FailureResponse, ValidateSuccess } from "@/lib/validation/responses";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return failure(body.status, [body.problem]);

  const input = validateRequestSchema.safeParse(body.value);
  if (!input.success) return failure(400, problemsFromZod(input.error));

  try {
    const result = await validateSpecification(input.data.spec);
    if (!result.ok) return failure(specFailureStatus(result.errors), result.errors);

    const { document, operations, text, conversions } = result.value;
    const info = isJsonObject(document.info) ? document.info : {};
    const response: ValidateSuccess = {
      ok: true,
      spec: text,
      conversions,
      info: {
        title: typeof info.title === "string" ? info.title : "Untitled API",
        version: typeof info.version === "string" ? info.version : "",
        openapi: typeof document.openapi === "string" ? document.openapi : "",
      },
      operations,
      groups: groupByTag(document, operations),
    };
    return Response.json(response);
  } catch (error) {
    // Unexpected server problem: report its type only, never details or content.
    console.error("Validation crashed", { error: error instanceof Error ? error.name : typeof error });
    return failure(500, [{ code: "internal", message: "Something went wrong while validating. Try again." }]);
  }
}

function failure(status: number, errors: Problem[]): Response {
  const response: FailureResponse = { ok: false, errors };
  return Response.json(response, { status });
}
