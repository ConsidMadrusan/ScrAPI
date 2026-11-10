import {
  formatMegabytes,
  MAX_SPEC_BYTES,
  MAX_SPEC_DEPTH,
  utf8ByteLength,
} from "@/lib/validation/limits";
import {
  capProblems,
  formatLocation,
  type SpecError,
  type SpecResult,
} from "./errors";
import { isJsonObject, type JsonObject, type JsonValue } from "./json";
import { resolveReference } from "./resolve";
import { forEachObject } from "./walk";

/**
 * OpenAPI versions ScrAPI has verified end to end (validation, filtering,
 * generation for every target, compiled output). 3.2 is rejected: OpenAPI
 * Generator 7.26.0 cannot read it. Add a minor version only after verifying it.
 */
const SUPPORTED_VERSION = /^3\.([01])\.\d+$/;
const SUPPORTED_DESCRIPTION = "OpenAPI 3.0.x and 3.1.x";

export type OpenApiVersion = "3.0" | "3.1";

/** The minor version of a document that passed `parseSpecification`. */
export function openApiVersion(document: JsonObject): OpenApiVersion {
  return typeof document.openapi === "string" && document.openapi.startsWith("3.1") ? "3.1" : "3.0";
}

/**
 * JSON Schema identifier keywords that 3.1 schemas may use but ScrAPI does not
 * support yet: references based on them cannot be checked or filtered, and
 * the generator's handling of them is not verified.
 */
const UNSUPPORTED_31_KEYWORDS = ["$id", "$anchor", "$dynamicRef", "$dynamicAnchor"] as const;
const YAML_START = /^(---|%YAML|#|[A-Za-z_][\w.-]*\s*:)/;

/**
 * Checks everything that does not need the full OpenAPI validator: size, JSON
 * syntax, the OpenAPI version, and that every reference is internal and
 * resolves. Runs in the browser for fast feedback and on the server.
 */
export function parseSpecification(text: string): SpecResult<JsonObject> {
  // Only the BOM is removed before parsing. Leading whitespace is valid JSON and
  // stays, so error positions match the lines and columns the user sees.
  const source = text.replace(/^\uFEFF/, "");
  const content = source.trim();
  if (content.length === 0) {
    return fail({ code: "empty", message: "Paste or upload a specification." });
  }
  if (utf8ByteLength(content) > MAX_SPEC_BYTES) {
    return fail({
      code: "too-large",
      message: `The specification is larger than ${formatMegabytes(MAX_SPEC_BYTES)}.`,
    });
  }
  if (!content.startsWith("{") && YAML_START.test(content)) {
    return fail({
      code: "yaml",
      message: "This looks like YAML, which is converted on the server. Submit it again to validate it there.",
    });
  }

  let document: JsonValue;
  try {
    document = JSON.parse(source) as JsonValue;
  } catch (error) {
    return fail(jsonSyntaxError(error, source));
  }

  if (!isJsonObject(document)) {
    return fail({
      code: "not-object",
      message: "The specification must be an object with an \"openapi\" field, not a single value or a list.",
    });
  }

  if (exceedsDepth(document, MAX_SPEC_DEPTH)) {
    return fail({
      code: "too-deep",
      message: `The specification is nested more than ${String(MAX_SPEC_DEPTH)} levels deep.`,
    });
  }

  const versionError = checkVersion(document);
  if (versionError) return fail(versionError);

  const referenceErrors = checkReferences(document);
  if (referenceErrors.length > 0) return { ok: false, errors: capProblems(referenceErrors) };

  if (openApiVersion(document) === "3.1") {
    const keywordErrors = checkUnsupportedKeywords(document);
    if (keywordErrors.length > 0) return { ok: false, errors: capProblems(keywordErrors) };
  }

  return { ok: true, value: document };
}

function fail(error: SpecError): SpecResult<never> {
  return { ok: false, errors: [error] };
}

/**
 * A JSON syntax error with a short reason and its line and column. `subject`
 * names the input in the message, e.g. "specification" or "schema".
 */
export function jsonSyntaxError(error: unknown, content: string, subject = "specification"): SpecError {
  const message = error instanceof Error ? error.message : "";
  const result: SpecError = {
    code: "not-json",
    message: `The ${subject} is not valid JSON: ${describeJsonError(message)}.`,
  };
  const location = jsonErrorLocation(message, content);
  if (location) result.location = location;
  return result;
}

function describeJsonError(message: string): string {
  const reason = message.replace(/ in JSON at position[\s\S]*$/, "").trim();
  // Some engines quote part of the input; keep the message short instead.
  if (reason.length === 0 || reason.includes("is not valid JSON")) {
    return "unexpected character";
  }
  if (/end of (json )?input/i.test(reason)) return "the document ends unexpectedly";
  return reason.charAt(0).toLowerCase() + reason.slice(1);
}

function jsonErrorLocation(message: string, content: string): string | undefined {
  const lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn) return `line ${lineColumn[1] ?? ""}, column ${lineColumn[2] ?? ""}`;

  const position = /position (\d+)/.exec(message)?.[1];
  if (position === undefined) return undefined;
  const before = content.slice(0, Number(position)).split("\n");
  const line = before.length;
  const column = (before.at(-1)?.length ?? 0) + 1;
  return `line ${String(line)}, column ${String(column)}`;
}

/** Iterative, so a hostile document cannot overflow the stack while being measured. */
export function exceedsDepth(document: JsonObject, maxDepth: number): boolean {
  const stack: { value: JsonValue; depth: number }[] = [{ value: document, depth: 1 }];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (item.depth > maxDepth) return true;
    const children = Array.isArray(item.value)
      ? item.value
      : isJsonObject(item.value)
        ? Object.values(item.value)
        : [];
    for (const child of children) {
      if (typeof child === "object" && child !== null) {
        stack.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
  return false;
}

function checkVersion(document: JsonObject): SpecError | undefined {
  if (document.swagger !== undefined) {
    return {
      code: "swagger-2",
      message:
        "Only Swagger 2.0 can be converted. Convert this specification to OpenAPI 3.0.x first.",
    };
  }
  const version = document.openapi;
  if (version === undefined && isJsonSchema(document)) {
    return {
      code: "json-schema",
      message: isOpenApiMetaSchema(document)
        ? "This is a JSON Schema that defines the OpenAPI format itself, not a description of an API. ScrAPI already checks every specification against the official schema for its version. Paste your API's OpenAPI document instead: the JSON or YAML document with \"openapi\", \"info\", and \"paths\", usually served by the API (for example at /swagger/v1/swagger.json or /openapi.json)."
        : `This is a JSON Schema, not an OpenAPI specification. Paste your API's OpenAPI document (${SUPPORTED_DESCRIPTION}): the JSON or YAML document with "openapi", "info", and "paths".`,
    };
  }
  if (version === undefined) {
    // The field is required by the standard, so the version is never guessed.
    const looksLikeOpenApi = document.paths !== undefined || document.info !== undefined;
    return {
      code: "missing-version",
      message: looksLikeOpenApi
        ? `The specification has no "openapi" field. Add the version it was written for at the top level, for example "openapi": "3.0.3" or "openapi": "3.1.0". ScrAPI supports ${SUPPORTED_DESCRIPTION}.`
        : `This is not an OpenAPI specification: it has no "openapi" field. ScrAPI supports ${SUPPORTED_DESCRIPTION} documents (JSON or YAML), Swagger 2.0, and GraphQL schemas.`,
    };
  }
  if (typeof version !== "string") {
    // YAML reads an unquoted `openapi: 3.1` as a number.
    const example = typeof version === "number" ? (Number.isInteger(version) ? `${String(version)}.0.0` : `${String(version)}.0`) : "";
    const yamlHint = example === "" ? "" : ` In YAML, put the version in quotes, for example openapi: "${example}".`;
    return {
      code: "invalid-version",
      message: `The "openapi" field must be a string such as "3.0.3", not ${describeType(version)}.${yamlHint}`,
      location: "openapi",
    };
  }
  if (!SUPPORTED_VERSION.test(version)) {
    return {
      code: "unsupported-version",
      message: /^3\.\d+\./.test(version)
        ? `OpenAPI ${version} is not supported yet. ScrAPI supports ${SUPPORTED_DESCRIPTION}.`
        : `OpenAPI version "${version}" is not supported. ScrAPI supports ${SUPPORTED_DESCRIPTION}.`,
    };
  }
  return undefined;
}

/** A JSON Schema document: it declares `$schema`, or has schema definitions but no API fields. */
function isJsonSchema(document: JsonObject): boolean {
  if (typeof document.$schema === "string") return true;
  const hasDefinitions = isJsonObject(document.definitions) || isJsonObject(document.$defs);
  return hasDefinitions && document.paths === undefined && document.info === undefined;
}

/** The schema published at spec.openapis.org that describes OpenAPI documents. */
function isOpenApiMetaSchema(document: JsonObject): boolean {
  const id = typeof document.$id === "string" ? document.$id : document.id;
  return typeof id === "string" && id.includes("spec.openapis.org/oas/");
}

function describeType(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

/** 3.1 only: schema identifier keywords ScrAPI cannot handle yet, with their locations. */
function checkUnsupportedKeywords(document: JsonObject): SpecError[] {
  const errors: SpecError[] = [];
  forEachObject(document, (node, segments) => {
    for (const keyword of UNSUPPORTED_31_KEYWORDS) {
      if (typeof node[keyword] !== "string") continue;
      errors.push({
        code: "unsupported-keyword",
        message: `The "${keyword}" keyword is not supported yet. Refer to schemas with "$ref": "#/components/schemas/..." instead.`,
        location: formatLocation([...segments, keyword]),
      });
    }
  });
  return errors;
}

/** Every `$ref` must point inside `#/components/` and resolve. */
function checkReferences(document: JsonObject): SpecError[] {
  const errors: SpecError[] = [];

  const visit = (value: JsonValue, segments: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        visit(child, [...segments, String(index)]);
      });
      return;
    }
    if (!isJsonObject(value)) return;

    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") {
        const error = checkReference(document, child, segments);
        if (error) errors.push(error);
      } else {
        visit(child, [...segments, key]);
      }
    }
  };

  visit(document, []);
  return errors;
}

function checkReference(
  document: JsonObject,
  ref: string,
  segments: string[],
): SpecError | undefined {
  const location = formatLocation(segments);
  if (!ref.startsWith("#")) {
    return {
      code: "external-ref",
      message: `External references are not supported ("${ref}"). Make the specification self-contained.`,
      location,
    };
  }
  if (!ref.startsWith("#/components/")) {
    return {
      code: "unsupported-ref",
      message: `Only references to "#/components/..." are supported ("${ref}").`,
      location,
    };
  }
  if (resolveReference(document, ref) === undefined) {
    return {
      code: "unresolved-ref",
      message: `The reference "${ref}" does not point to anything in the specification.`,
      location,
    };
  }
  return undefined;
}

