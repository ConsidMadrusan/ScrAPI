import { describeGraphql } from "@/lib/source/describe";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { failureResponse, internalErrorResponse } from "@/lib/validation/http";
import { problemsFromZod } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { graphqlValidateRequestSchema } from "@/lib/validation/requests";

/**
 * Validates a GraphQL schema (SDL or introspection JSON) and lists the root
 * fields that can be selected. The schema comes from the request body only;
 * the server never fetches it from a URL.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return failureResponse(body.status, [body.problem]);

  const input = graphqlValidateRequestSchema.safeParse(body.value);
  if (!input.success) return failureResponse(400, problemsFromZod(input.error));

  try {
    const result = describeGraphql(input.data.schema);
    if (!result.ok) return failureResponse(result.status, result.errors);
    return Response.json(result);
  } catch (error) {
    return internalErrorResponse("GraphQL validation crashed", error, "Something went wrong while validating. Try again.");
  }
}
