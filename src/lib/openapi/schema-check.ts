import "server-only";

import Ajv2020 from "ajv/dist/2020";
import AjvDraft04, { type ErrorObject } from "ajv-draft-04";
import type { JsonObject, JsonValue } from "./json";
import { isJsonObject } from "./json";
import type { OpenApiVersion } from "./parse";
import schema30 from "./schemas/oas-3.0-2024-10-18.json";
import schema31 from "./schemas/oas-3.1-2026-08-03.json";

/** Identifiers of the vendored official schemas, as published by the OpenAPI Initiative. */
export const OFFICIAL_SCHEMA_IDS: Record<OpenApiVersion, string> = {
  "3.0": schema30.id,
  "3.1": schema31.$id,
};

/** Same options as swagger-parser: report every error, accept unknown keywords, skip formats. */
const AJV_OPTIONS = { allErrors: true, strict: false, validateFormats: false } as const;

/**
 * The official OpenAPI JSON Schemas, vendored in the repository and never
 * fetched. 3.0 uses JSON Schema draft-04; 3.1 uses draft 2020-12 and checks
 * Schema Objects only as "object or boolean", by design of that schema.
 * Each is compiled once per process: a constant, not request state.
 */
const validators: Record<OpenApiVersion, (document: JsonObject) => ErrorObject[]> = {
  "3.0": errorsOf(new AjvDraft04(AJV_OPTIONS).compile(schema30)),
  "3.1": errorsOf(new Ajv2020(AJV_OPTIONS).compile(withoutDynamicReferences(schema31 as JsonObject))),
};

/**
 * Checks a parsed specification against the official schema for its version.
 * Runs on the original document: the schemas accept Reference objects wherever
 * they are allowed, so nothing needs to be dereferenced first. Returns the
 * schema violations, or an empty list when the document conforms.
 */
export function checkAgainstOfficialSchema(document: JsonObject, version: OpenApiVersion): ErrorObject[] {
  return validators[version](document);
}

function errorsOf(validate: { (data: unknown): boolean; errors?: ErrorObject[] | null }) {
  return (document: JsonObject): ErrorObject[] => (validate(document) ? [] : [...(validate.errors ?? [])]);
}

/**
 * The 3.1 schema points every Schema Object position at `{ "$dynamicRef": "#meta" }`,
 * which Ajv resolves to the wrong definition (ajv-validator/ajv#1573). As in
 * swagger-parser, each such reference is replaced by a plain `$ref` to the
 * schema's own `$defs/schema`, and the dynamic anchor is removed. The vendored
 * file itself stays unchanged.
 */
function withoutDynamicReferences(schema: JsonObject): JsonObject {
  const rewrite = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!isJsonObject(value)) return value;
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "$dynamicAnchor") continue;
      if (key === "$dynamicRef" && child === "#meta") {
        result.$ref = "#/$defs/schema";
        continue;
      }
      result[key] = rewrite(child);
    }
    return result;
  };
  const rewritten = rewrite(schema);
  return isJsonObject(rewritten) ? rewritten : schema;
}
