import "server-only";
import { isIntrospectionType, isSpecifiedScalarType, printSchema } from "graphql";
import { groupGraphqlOperations, listGraphqlOperations, subscriptionCount } from "@/lib/graphql/operations";
import { parseGraphqlSchema } from "@/lib/graphql/parse";
import { specFailureStatus } from "@/lib/openapi/errors";
import { isJsonObject } from "@/lib/openapi/json";
import { validateSpecification } from "@/lib/openapi/validate";
import { groupByTag } from "@/lib/selection/operations";
import type { Problem } from "@/lib/validation/problems";
import type { GraphqlValidateSuccess, ValidateSuccess } from "@/lib/validation/responses";

/** A description that failed validation, with the HTTP status a route answers. */
export interface DescribeFailure {
  ok: false;
  status: number;
  errors: Problem[];
}

/**
 * Validates an OpenAPI or Swagger document (JSON or YAML) and lists its
 * operations grouped by tag. Shared by `/api/validate` and the MCP tools.
 */
export async function describeOpenApi(text: string): Promise<ValidateSuccess | DescribeFailure> {
  const result = await validateSpecification(text);
  if (!result.ok) return { ok: false, status: specFailureStatus(result.errors), errors: result.errors };

  const { document, operations, text: converted, conversions } = result.value;
  const info = isJsonObject(document.info) ? document.info : {};
  return {
    ok: true,
    spec: converted,
    conversions,
    info: {
      title: typeof info.title === "string" ? info.title : "Untitled API",
      version: typeof info.version === "string" ? info.version : "",
      openapi: typeof document.openapi === "string" ? document.openapi : "",
    },
    operations,
    groups: groupByTag(document, operations),
  };
}

/**
 * Validates a GraphQL schema (SDL or introspection JSON) and lists the Query
 * and Mutation root fields that can be selected. Shared by
 * `/api/graphql/validate` and the MCP tools.
 */
export function describeGraphql(text: string): GraphqlValidateSuccess | DescribeFailure {
  const parsed = parseGraphqlSchema(text);
  if (!parsed.ok) return { ok: false, status: 422, errors: parsed.errors };
  const schema = parsed.value;

  const operations = listGraphqlOperations(schema);
  if (operations.length === 0) {
    return {
      ok: false,
      status: 422,
      errors: [{ code: "no-operations", message: "The schema has no Query or Mutation fields to generate." }],
    };
  }
  const title = schema.description?.split("\n")[0]?.trim() ?? "";
  return {
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
}
