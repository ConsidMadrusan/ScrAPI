import "server-only";

import SwaggerParser from "@apidevtools/swagger-parser";
import {
  findDuplicateOperationIds,
  listOperations,
  type OperationSummary,
} from "@/lib/selection/operations";
import { formatLocation, pointerSegments, type SpecError, type SpecResult } from "./errors";
import type { JsonObject } from "./json";
import { parseSpecification } from "./parse";

const MAX_VALIDATION_ERRORS = 20;

export interface ValidatedSpec {
  /** The parsed document, unchanged. */
  document: JsonObject;
  operations: OperationSummary[];
}

type ParserDocument = Exclude<Parameters<typeof SwaggerParser.validate>[0], string>;

/** Shape of the schema errors swagger-parser attaches as `details`. */
interface SchemaErrorDetail {
  instancePath?: unknown;
  message?: unknown;
  params?: unknown;
}

/**
 * Authoritative validation: the quick checks from `parseSpecification`, then
 * the OpenAPI 3.0 validator, then rules the generator enforces.
 */
export async function validateSpecification(
  text: string,
): Promise<SpecResult<ValidatedSpec>> {
  const parsed = parseSpecification(text);
  if (!parsed.ok) return parsed;
  const document = parsed.value;

  const validatorErrors = await runValidator(document);
  if (validatorErrors.length > 0) return { ok: false, errors: validatorErrors };

  const operations = listOperations(document);
  if (operations.length === 0) {
    return {
      ok: false,
      errors: [{ code: "no-operations", message: "The specification has no operations to generate." }],
    };
  }

  const duplicates = findDuplicateOperationIds(operations);
  if (duplicates.size > 0) {
    return {
      ok: false,
      errors: [...duplicates].map(([operationId, users]) => ({
        code: "duplicate-operation-id",
        message: `The operationId "${operationId}" is used by more than one operation (${users
          .map((operation) => operation.id)
          .join(", ")}). OpenAPI requires operationIds to be unique.`,
      })),
    };
  }

  return { ok: true, value: { document, operations } };
}

async function runValidator(document: JsonObject): Promise<SpecError[]> {
  try {
    // The validator dereferences its input in place, so it gets a copy.
    const copy = structuredClone(document) as unknown as ParserDocument;
    await SwaggerParser.validate(copy, { resolve: { external: false } });
    return [];
  } catch (error) {
    return validatorProblems(error);
  }
}

function validatorProblems(error: unknown): SpecError[] {
  const details = error instanceof Error && "details" in error ? error.details : undefined;
  if (Array.isArray(details) && details.length > 0) {
    return details
      .slice(0, MAX_VALIDATION_ERRORS)
      .map((detail: SchemaErrorDetail) => schemaProblem(detail));
  }
  const message = error instanceof Error ? firstLine(error.message) : "";
  return [
    {
      code: "invalid-spec",
      message: message
        ? `The specification is not valid OpenAPI 3.0: ${message}`
        : "The specification is not valid OpenAPI 3.0.",
    },
  ];
}

function schemaProblem(detail: SchemaErrorDetail): SpecError {
  const message = typeof detail.message === "string" ? detail.message : "is invalid";
  const problem: SpecError = {
    code: "invalid-spec",
    message: `${capitalize(message)}${describeParams(detail.params)}.`,
  };
  if (typeof detail.instancePath === "string") {
    problem.location = formatLocation(pointerSegments(detail.instancePath)) || "(root)";
  }
  return problem;
}

function describeParams(params: unknown): string {
  if (typeof params !== "object" || params === null) return "";
  if ("additionalProperty" in params && typeof params.additionalProperty === "string") {
    return `: "${params.additionalProperty}"`;
  }
  if ("allowedValues" in params && Array.isArray(params.allowedValues)) {
    return ` (${params.allowedValues.map(String).join(", ")})`;
  }
  return "";
}

function firstLine(message: string): string {
  return (message.split("\n")[0] ?? "").trim();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
