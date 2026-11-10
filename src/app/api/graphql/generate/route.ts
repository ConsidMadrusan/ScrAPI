import { generateGraphqlClient } from "@/lib/graphql/generate";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { failureResponse, internalErrorResponse } from "@/lib/validation/http";
import { problemsFromZod } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { graphqlGenerateRequestSchema } from "@/lib/validation/requests";

/** Generates the GraphQL client for one framework combination. */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return failureResponse(body.status, [body.problem]);

  const input = graphqlGenerateRequestSchema.safeParse(body.value);
  if (!input.success) return failureResponse(400, problemsFromZod(input.error));

  try {
    const result = await generateGraphqlClient(input.data);
    if (!result.ok) return failureResponse(result.status, result.errors);
    return Response.json(result.value);
  } catch (error) {
    return internalErrorResponse("GraphQL generation crashed", error, "Something went wrong while generating. Try again.");
  }
}
