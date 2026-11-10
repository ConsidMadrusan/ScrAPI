import { specFailureStatus } from "@/lib/openapi/errors";
import { isJsonObject } from "@/lib/openapi/json";
import { validateSpecification } from "@/lib/openapi/validate";
import { groupByTag } from "@/lib/selection/operations";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { failureResponse, internalErrorResponse } from "@/lib/validation/http";
import { problemsFromZod } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { validateRequestSchema } from "@/lib/validation/requests";
import type { ValidateSuccess } from "@/lib/validation/responses";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return failureResponse(body.status, [body.problem]);

  const input = validateRequestSchema.safeParse(body.value);
  if (!input.success) return failureResponse(400, problemsFromZod(input.error));

  try {
    const result = await validateSpecification(input.data.spec);
    if (!result.ok) return failureResponse(specFailureStatus(result.errors), result.errors);

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
    return internalErrorResponse("Validation crashed", error, "Something went wrong while validating. Try again.");
  }
}
