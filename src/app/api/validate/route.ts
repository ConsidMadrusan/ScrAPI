import { isJsonObject } from "@/lib/openapi/json";
import { validateSpecification } from "@/lib/openapi/validate";
import { groupByTag } from "@/lib/selection/operations";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { problemsFromZod } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { validateRequestSchema } from "@/lib/validation/requests";
import type { ValidateSuccess } from "@/lib/validation/responses";
import { failure, withProblemHandling } from "@/lib/validation/route-handler";

export const POST = withProblemHandling(
  async (request) => {
    const body = await readJsonBody(request, MAX_REQUEST_BYTES);
    if (!body.ok) return failure(body.status, [body.problem]);

    const input = validateRequestSchema.safeParse(body.value);
    if (!input.success) return failure(400, problemsFromZod(input.error));

    const result = await validateSpecification(input.data.spec);
    if (!result.ok) return failure(422, result.errors);

    const { document, operations } = result.value;
    const info = isJsonObject(document.info) ? document.info : {};
    const response: ValidateSuccess = {
      ok: true,
      info: {
        title: typeof info.title === "string" ? info.title : "Untitled API",
        version: typeof info.version === "string" ? info.version : "",
        openapi: typeof document.openapi === "string" ? document.openapi : "",
      },
      operations,
      groups: groupByTag(document, operations),
    };
    return Response.json(response);
  },
  {
    logMessage: "Validation crashed",
    userMessage: "Something went wrong while validating. Try again.",
  },
);
