import { formatMegabytes, MAX_SPEC_BYTES, utf8ByteLength } from "@/lib/validation/limits";
import {
  formatLocation,
  pointerSegments,
  type SpecError,
  type SpecResult,
} from "./errors";
import { isJsonObject, type JsonObject, type JsonValue } from "./json";

const SUPPORTED_VERSION = /^3\.0\.\d+$/;
const YAML_START = /^(---|%YAML|#|[A-Za-z_][\w.-]*\s*:)/;
const MAX_REFERENCE_ERRORS = 20;

/**
 * Checks everything that does not need the full OpenAPI validator: size, JSON
 * syntax, the OpenAPI version, and that every reference is internal and
 * resolves. Runs in the browser for fast feedback and on the server.
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

/** Every `$ref` must point inside `#/components/` and resolve. */
function checkReferences(document: JsonObject): SpecError[] {
  const errors: SpecError[] = [];

  const visit = (value: JsonValue, segments: string[]) => {
    if (errors.length >= MAX_REFERENCE_ERRORS) return;
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
  if (resolvePointer(document, ref.slice(1)) === undefined) {
    return {
      code: "unresolved-ref",
      message: `The reference "${ref}" does not point to anything in the specification.`,
      location,
    };
  }
  return undefined;
}

function resolvePointer(document: JsonObject, pointer: string): JsonValue | undefined {
  let current: JsonValue | undefined = document;
  for (const segment of pointerSegments(pointer)) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (isJsonObject(current)) {
      current = Object.hasOwn(current, segment) ? current[segment] : undefined;
    } else {
      return undefined;
    }
  }
  return current;
}
