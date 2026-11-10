import "server-only";

import { upgrade } from "@scalar/openapi-upgrader";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { SpecResult } from "./errors";
import { isJsonObject, type JsonValue } from "./json";
import { looksLikeJson } from "./convertible";

import type { Conversion } from "@/lib/validation/responses";

/** What normalization changed, shown to the user. */
export type { Conversion };

export interface NormalizedSpec {
  /** OpenAPI JSON text; the input itself when nothing had to be converted. */
  text: string;
  conversions: Conversion[];
}

/** Most YAML aliases resolved in one document, against "billion laughs" expansion. */
const MAX_YAML_ALIASES = 100;

/**
 * Turns the accepted input formats into OpenAPI JSON before validation:
 * YAML becomes JSON, and Swagger 2.0 becomes OpenAPI 3.0. Nothing is fetched:
 * references to other files or URLs stay as they are and are rejected later.
 * JSON OpenAPI 3.x input is returned unchanged, so error positions still
 * match what the user pasted. Other problems are left to `parseSpecification`.
 */
export function normalizeSpecification(text: string): SpecResult<NormalizedSpec> {
  const conversions: Conversion[] = [];
  let document: JsonValue;

  if (looksLikeJson(text)) {
    try {
      document = JSON.parse(text.replace(/^﻿/, "")) as JsonValue;
    } catch {
      return unchanged(text); // parseSpecification reports the syntax error with its position.
    }
  } else {
    const parsed = parseYamlDocument(text);
    if (!parsed.ok) return parsed;
    document = parsed.value;
    conversions.push("yaml");
  }

  if (isJsonObject(document) && document.swagger === "2.0") {
    try {
      document = toJsonValue(upgrade(document, "3.0"));
    } catch {
      return {
        ok: false,
        errors: [
          {
            code: "swagger-conversion-failed",
            message:
              "This Swagger 2.0 specification could not be converted to OpenAPI 3.0. Check that it is valid Swagger 2.0, or convert it to OpenAPI 3.0 with another tool first.",
          },
        ],
      };
    }
    conversions.push("swagger-2");
  }

  return conversions.length === 0 ? unchanged(text) : { ok: true, value: { text: JSON.stringify(document), conversions } };
}

function unchanged(text: string): SpecResult<NormalizedSpec> {
  return { ok: true, value: { text, conversions: [] } };
}

/**
 * Parses YAML 1.2 with the core schema only: no custom tags, no timestamps or
 * binary values, unique keys, and a small alias budget.
 */
function parseYamlDocument(text: string): SpecResult<JsonValue> {
  try {
    const value = parseYaml(text, {
      schema: "core",
      customTags: [],
      uniqueKeys: true,
      maxAliasCount: MAX_YAML_ALIASES,
      merge: false,
      // Unknown tags stay plain values; their warnings would only reach the server log.
      logLevel: "error",
    }) as JsonValue | undefined;
    return { ok: true, value: value ?? null };
  } catch (error) {
    const problem = {
      code: "invalid-yaml" as const,
      message: `The specification is not valid YAML: ${yamlReason(error)}.`,
    };
    const position = error instanceof YAMLParseError ? error.linePos?.[0] : undefined;
    return {
      ok: false,
      errors: [
        position
          ? { ...problem, location: `line ${String(position.line)}, column ${String(position.col)}` }
          : problem,
      ],
    };
  }
}

function yamlReason(error: unknown): string {
  if (error instanceof RangeError) return "it is nested too deeply";
  if (!(error instanceof Error)) return "it could not be read";
  if (/alias/i.test(error.message) && /resource|count|exhaust/i.test(error.message)) {
    return "it uses too many aliases";
  }
  // The first line only: later lines quote the input.
  const first = (error.message.split("\n")[0] ?? "").replace(/ at line \d+, column \d+:?$/, "").trim();
  return first.length > 0 ? first.charAt(0).toLowerCase() + first.slice(1) : "it could not be read";
}

/** The upgrader's typed result as plain JSON data (it only rearranges parsed JSON). */
function toJsonValue(document: object): JsonValue {
  return JSON.parse(JSON.stringify(document)) as JsonValue;
}
