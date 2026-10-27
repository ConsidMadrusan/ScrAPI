import { formatMegabytes, MAX_SPEC_BYTES, utf8ByteLength } from "@/lib/validation/limits";
import { formatLocation, type SpecError, type SpecResult } from "./errors";
import { exceedsExpansionBudget } from "./expansion";
import { isJsonObject, type JsonObject, type JsonValue } from "./json";
import { resolveRef } from "./pointer";

const SUPPORTED_VERSION = /^3\.0\.\d+$/;
const YAML_START = /^(---|%YAML|#|[A-Za-z_][\w.-]*\s*:)/;
const MAX_REFERENCE_ERRORS = 20;

/**
 * Deepest accepted nesting of objects and arrays. Real specifications stay far
 * below this; the limit keeps recursive processing safe from stack overflows.
 */
export const MAX_NESTING_DEPTH = 128;

/**
 * Checks everything that does not need the full OpenAPI validator: size, JSON
 * syntax, the OpenAPI version, that every reference is internal and
 * resolves, and that the references do not expand beyond what the validator
 * can process in reasonable time. Runs in the browser for fast feedback and
 * on the server.
 */
export function parseSpecification(text: string): SpecResult<JsonObject> {
  const content = text.replace(/^﻿/, "").trim();
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
      message: "This looks like YAML. ScrAPI accepts OpenAPI specifications in JSON only.",
    });
  }

  let document: JsonValue;
  try {
    document = JSON.parse(content) as JsonValue;
  } catch (error) {
    return fail(jsonSyntaxError(error, content));
  }

  if (!isJsonObject(document)) {
    return fail({
      code: "not-object",
      message: "The specification must be a JSON object with an \"openapi\" field.",
    });
  }

  const versionError = checkVersion(document);
  if (versionError) return fail(versionError);

  const referenceErrors = checkReferences(document);
  if (referenceErrors.length > 0) return { ok: false, errors: referenceErrors };

  // Needs resolvable internal references, so it runs after checkReferences.
  if (exceedsExpansionBudget(document)) {
    return fail({
      code: "too-many-references",
      message:
        "The specification's schemas reference each other so often that resolving the references makes it too large to process. Reduce the number of nested references.",
    });
  }

  return { ok: true, value: document };
}

function fail(error: SpecError): SpecResult<never> {
  return { ok: false, errors: [error] };
}

function jsonSyntaxError(error: unknown, content: string): SpecError {
  const message = error instanceof Error ? error.message : "";
  const result: SpecError = {
    code: "not-json",
    message: `The specification is not valid JSON: ${describeJsonError(message)}.`,
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

function checkVersion(document: JsonObject): SpecError | undefined {
  if (document.swagger !== undefined) {
    return {
      code: "swagger-2",
      message:
        "Swagger 2.0 specifications are not supported. Convert the specification to OpenAPI 3.0.x first.",
    };
  }
  const version = document.openapi;
  if (typeof version !== "string") {
    return {
      code: "missing-version",
      message: "The specification has no \"openapi\" version field. ScrAPI supports OpenAPI 3.0.x.",
    };
  }
  if (!SUPPORTED_VERSION.test(version)) {
    return {
      code: "unsupported-version",
      message: version.startsWith("3.1")
        ? `OpenAPI ${version} is not supported yet. ScrAPI supports OpenAPI 3.0.x.`
        : `OpenAPI version "${version}" is not supported. ScrAPI supports OpenAPI 3.0.x.`,
    };
  }
  return undefined;
}

/** An object or array still to visit, linked to its parent for error locations. */
interface Container {
  value: JsonObject | JsonValue[];
  key: string | undefined;
  parent: Container | undefined;
  depth: number;
}

/**
 * Every `$ref` must point inside `#/components/` and resolve. Walks the
 * document iteratively in linear time and rejects documents nested deeper
 * than `MAX_NESTING_DEPTH`, so later recursive steps (the OpenAPI validator,
 * filtering) cannot overflow the stack.
 */
function checkReferences(document: JsonObject): SpecError[] {
  const errors: SpecError[] = [];
  const pending: Container[] = [{ value: document, key: undefined, parent: undefined, depth: 1 }];

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (errors.length >= MAX_REFERENCE_ERRORS) break;
    if (next.depth > MAX_NESTING_DEPTH) {
      return [
        {
          code: "too-deep",
          message: `The specification is nested more than ${String(MAX_NESTING_DEPTH)} levels deep.`,
          location: formatLocation(segmentsOf(next)),
        },
      ];
    }
    const children: [string, JsonValue][] = Array.isArray(next.value)
      ? next.value.map((child, index) => [String(index), child])
      : Object.entries(next.value);

    // Push in reverse so containers are visited in document order.
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const entry = children[index];
      if (entry === undefined) continue;
      const [key, child] = entry;
      if (!Array.isArray(next.value) && key === "$ref" && typeof child === "string") {
        const error = checkReference(document, child, next);
        if (error) errors.push(error);
      } else if (Array.isArray(child) || isJsonObject(child)) {
        pending.push({ value: child, key, parent: next, depth: next.depth + 1 });
      }
    }
  }
  return errors;
}

/** Location segments of a container, built only when an error is reported. */
function segmentsOf(container: Container): string[] {
  const segments: string[] = [];
  for (let current: Container | undefined = container; current; current = current.parent) {
    if (current.key !== undefined) segments.push(current.key);
  }
  return segments.reverse();
}

function checkReference(
  document: JsonObject,
  ref: string,
  container: Container,
): SpecError | undefined {
  const location = formatLocation(segmentsOf(container));
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
  if (resolveRef(document, ref) === undefined) {
    return {
      code: "unresolved-ref",
      message: `The reference "${ref}" does not point to anything in the specification.`,
      location,
    };
  }
  return undefined;
}
