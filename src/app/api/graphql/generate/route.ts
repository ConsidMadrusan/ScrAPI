import { generateGraphqlClient } from "@/lib/graphql/generate";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { problemsFromZod, type Problem } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { graphqlGenerateRequestSchema } from "@/lib/validation/requests";
import type { FailureResponse } from "@/lib/validation/responses";

/** Generates the GraphQL client for one framework combination. */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return failure(body.status, [body.problem]);

  const input = graphqlGenerateRequestSchema.safeParse(body.value);
  if (!input.success) return failure(400, problemsFromZod(input.error));

  try {
    const result = await generateGraphqlClient(input.data);
    if (!result.ok) return failure(result.status, result.errors);
    return Response.json(result.value);
  } catch (error) {
    // Unexpected server problem: report its type only, never details or content.
    console.error("GraphQL generation crashed", { error: error instanceof Error ? error.name : typeof error });
    return failure(500, [{ code: "internal", message: "Something went wrong while generating. Try again." }]);
  }
}

function failure(status: number, errors: Problem[]): Response {
  const response: FailureResponse = { ok: false, errors };
  return Response.json(response, { status });
}
