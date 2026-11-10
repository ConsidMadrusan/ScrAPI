import { isIntrospectionType, isSpecifiedScalarType, printSchema } from "graphql";
import { groupGraphqlOperations, listGraphqlOperations, subscriptionCount } from "@/lib/graphql/operations";
import { parseGraphqlSchema } from "@/lib/graphql/parse";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { problemsFromZod, type Problem } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { graphqlValidateRequestSchema } from "@/lib/validation/requests";
import type { FailureResponse, GraphqlValidateSuccess } from "@/lib/validation/responses";

/**
 * Validates a GraphQL schema (SDL or introspection JSON) and lists the root
 * fields that can be selected. The schema comes from the request body only;
 * the server never fetches it from a URL.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return failure(body.status, [body.problem]);

  const input = graphqlValidateRequestSchema.safeParse(body.value);
  if (!input.success) return failure(400, problemsFromZod(input.error));

  try {
    const parsed = parseGraphqlSchema(input.data.schema);
    if (!parsed.ok) return failure(422, parsed.errors);
    const schema = parsed.value;

    const operations = listGraphqlOperations(schema);
    if (operations.length === 0) {
      return failure(422, [
        { code: "no-operations", message: "The schema has no Query or Mutation fields to generate." },
      ]);
    }
    const title = schema.description?.split("\n")[0]?.trim() ?? "";
    const response: GraphqlValidateSuccess = {
      ok: true,
      kind: "graphql",
      schema: printSchema(schema),
      info: {
        title: title === "" ? "GraphQL API" : title,
        typeCount: Object.values(schema.getTypeMap()).filter(
          (type) => !isIntrospectionType(type) && !isSpecifiedScalarType(type),
        ).length,
        subscriptionCount: subscriptionCount(schema),
      },
      operations,
      groups: groupGraphqlOperations(operations),
    };
    return Response.json(response);
  } catch (error) {
    // Unexpected server problem: report its type only, never details or content.
    console.error("GraphQL validation crashed", { error: error instanceof Error ? error.name : typeof error });
    return failure(500, [{ code: "internal", message: "Something went wrong while validating. Try again." }]);
  }
}

function failure(status: number, errors: Problem[]): Response {
  const response: FailureResponse = { ok: false, errors };
  return Response.json(response, { status });
}
