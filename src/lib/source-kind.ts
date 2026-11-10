/** The two kinds of API description ScrAPI accepts. */
export type SourceKind = "openapi" | "graphql";

const SDL_DEFINITION = /^(?:schema|type|interface|union|enum|input|scalar|directive|extend)\s+[A-Za-z_@{]/m;
const OPENAPI_KEY = /^(?:openapi|swagger)\s*:/m;

/**
 * Tells pasted or uploaded text apart: GraphQL introspection JSON or SDL, or
 * an OpenAPI/Swagger document (JSON or YAML). Anything unclear counts as
 * OpenAPI, whose validation then explains what is wrong.
 */
export function detectSourceKind(text: string): SourceKind {
  const content = text.replace(/^﻿/, "").trimStart();
  if (content.startsWith("{")) {
    return /"__schema"\s*:/.test(content) && !/"(?:openapi|swagger)"\s*:/.test(content) ? "graphql" : "openapi";
  }
  return SDL_DEFINITION.test(content) && !OPENAPI_KEY.test(content) ? "graphql" : "openapi";
}

/** True when a loaded document has an `openapi` or `swagger` field (JSON or YAML). */
export function looksLikeOpenApiDocument(text: string): boolean {
  return /"(?:openapi|swagger)"\s*:/.test(text) || OPENAPI_KEY.test(text);
}
