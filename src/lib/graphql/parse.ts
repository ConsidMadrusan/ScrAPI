import {
  buildClientSchema,
  buildSchema,
  GraphQLError,
  validateSchema,
  type GraphQLSchema,
  type IntrospectionQuery,
} from "graphql";
import type { SpecResult } from "@/lib/openapi/errors";
import { isJsonObject, type JsonObject, type JsonValue } from "@/lib/openapi/json";
import { exceedsDepth } from "@/lib/openapi/parse";
import { looksLikeJson } from "@/lib/openapi/convertible";
import { MAX_SPEC_DEPTH } from "@/lib/validation/limits";

/**
 * Most tokens accepted in a schema's SDL. Keeps parsing bounded for hostile
 * input; real schemas, even large public ones, stay far below it.
 */
const MAX_SDL_TOKENS = 1_000_000;

/** Most schema problems reported at once. */
const MAX_SCHEMA_ERRORS = 20;

/**
 * Builds a schema from SDL or from an introspection result (`{ "data": { "__schema" } }`
 * or `{ "__schema" }`), and checks that it is a valid GraphQL schema with a
 * Query type. Nothing is fetched.
 */
export function parseGraphqlSchema(text: string): SpecResult<GraphQLSchema> {
  const content = text.replace(/^﻿/, "");
  if (content.trim() === "") {
    return fail("empty", "Paste, upload, or load a GraphQL schema.");
  }

  let schema: GraphQLSchema;
  try {
    schema = looksLikeJson(content) ? fromIntrospection(content) : buildSchema(content, { maxTokens: MAX_SDL_TOKENS });
  } catch (error) {
    if (error instanceof SchemaInputError) return { ok: false, errors: [error.problem] };
    return { ok: false, errors: [graphqlProblem(error)] };
  }

  const problems = validateSchema(schema);
  if (problems.length > 0) {
    return { ok: false, errors: problems.slice(0, MAX_SCHEMA_ERRORS).map((problem) => graphqlProblem(problem)) };
  }
  return { ok: true, value: schema };
}

class SchemaInputError extends Error {
  constructor(readonly problem: { code: "not-json" | "not-introspection" | "too-deep"; message: string }) {
    super(problem.message);
  }
}

function fromIntrospection(content: string): GraphQLSchema {
  let value: JsonValue;
  try {
    value = JSON.parse(content) as JsonValue;
  } catch {
    throw new SchemaInputError({ code: "not-json", message: "The schema is not valid JSON." });
  }
  if (!isJsonObject(value)) {
    throw new SchemaInputError({ code: "not-introspection", message: introspectionHint() });
  }
  if (exceedsDepth(value, MAX_SPEC_DEPTH)) {
    throw new SchemaInputError({
      code: "too-deep",
      message: `The introspection result is nested more than ${String(MAX_SPEC_DEPTH)} levels deep.`,
    });
  }
  const data = isJsonObject(value.data) ? value.data : value;
  if (!isJsonObject(data.__schema)) {
    throw new SchemaInputError({ code: "not-introspection", message: introspectionHint() });
  }
  return buildClientSchema(introspectionOf(data));
}

/** `buildClientSchema` checks the introspection's structure itself and throws clear errors. */
function introspectionOf(data: JsonObject): IntrospectionQuery {
  return data as unknown as IntrospectionQuery;
}

function introspectionHint(): string {
  return 'This JSON is not a GraphQL introspection result. Paste the result of an introspection query (with "__schema"), or the schema in SDL.';
}

function graphqlProblem(error: unknown): { code: "invalid-schema"; message: string; location?: string } {
  const message = error instanceof Error ? (error.message.split("\n")[0] ?? "").trim() : "";
  const problem: { code: "invalid-schema"; message: string; location?: string } = {
    code: "invalid-schema",
    message: message ? `The GraphQL schema is not valid: ${message}` : "The GraphQL schema is not valid.",
  };
  const position = error instanceof GraphQLError ? error.locations?.[0] : undefined;
  if (position) problem.location = `line ${String(position.line)}, column ${String(position.column)}`;
  return problem;
}

function fail(code: "empty", message: string): SpecResult<never> {
  return { ok: false, errors: [{ code, message }] };
}
