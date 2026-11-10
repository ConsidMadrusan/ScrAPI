import "server-only";

import SwaggerParser from "@apidevtools/swagger-parser";
import { HTTP_METHODS } from "@/lib/validation/operation";
import {
  findDuplicateOperationIds,
  listOperations,
  type OperationSummary,
} from "@/lib/selection/operations";
import { formatLocation, pointerSegments, type SpecError, type SpecResult } from "./errors";
import { isJsonObject, type JsonObject, type JsonValue } from "./json";
import { openApiVersion, parseSpecification, type OpenApiVersion } from "./parse";
import { normalizeSpecification, type Conversion } from "./normalize";
import { checkAgainstOfficialSchema } from "./schema-check";

const MAX_VALIDATION_ERRORS = 20;

/** Most specifications that may be validated at once; further requests are rejected as busy. */
export const MAX_CONCURRENT_VALIDATIONS = 4;

let runningValidations = 0;

export interface ValidatedSpec {
  /** The parsed document, unchanged (after any YAML or Swagger 2.0 conversion). */
  document: JsonObject;
  operations: OperationSummary[];
  /** OpenAPI JSON text of the document: the input itself, or its conversion. */
  text: string;
  /** What was converted to reach OpenAPI JSON, if anything. */
  conversions: Conversion[];
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
 * the official OpenAPI schema for its version, then rules the generator enforces. At most
 * MAX_CONCURRENT_VALIDATIONS run at once, so parallel large specifications
 * cannot pile up on the server.
 */
export async function validateSpecification(
  text: string,
): Promise<SpecResult<ValidatedSpec>> {
  if (runningValidations >= MAX_CONCURRENT_VALIDATIONS) {
    return {
      ok: false,
      errors: [
        {
          code: "validator-busy",
          message: "The server is busy validating other specifications. Try again in a moment.",
        },
      ],
    };
  }
  runningValidations += 1;
  try {
    return await validate(text);
  } finally {
    runningValidations -= 1;
  }
}

async function validate(input: string): Promise<SpecResult<ValidatedSpec>> {
  const normalized = normalizeSpecification(input);
  if (!normalized.ok) return normalized;
  const { text, conversions } = normalized.value;

  const parsed = parseSpecification(text);
  if (!parsed.ok) return parsed;
  const document = parsed.value;

  const validatorErrors = await runValidator(document);
  if (validatorErrors.length > 0) return { ok: false, errors: validatorErrors };

  const securityErrors = unknownSecuritySchemes(document);
  if (securityErrors.length > 0) return { ok: false, errors: securityErrors };

  const operations = listOperations(document);
  if (operations.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: "no-operations",
          message:
            document.webhooks === undefined
              ? "The specification has no operations to generate. Add at least one operation under \"paths\"."
              : "The specification has no operations under \"paths\". ScrAPI generates clients for API operations; webhooks are not generated.",
        },
      ],
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

  return { ok: true, value: { document, operations, text, conversions } };
}

/**
 * Two passes: the official OpenAPI JSON Schema for the version (see schema-check.ts), then
 * swagger-parser, which resolves every reference in a copy of the document.
 * Swagger-parser's own schema check is off because it uses an older schema
 * revision, and its extra rule checks apply to Swagger 2.0 only.
 */
async function runValidator(document: JsonObject): Promise<SpecError[]> {
  const version = openApiVersion(document);
  const schemaErrors = checkAgainstOfficialSchema(document, version);
  if (schemaErrors.length > 0) {
    return schemaErrors.slice(0, MAX_VALIDATION_ERRORS).map((detail) => schemaProblem(detail));
  }
  try {
    // The validator dereferences its input in place, so it gets a copy.
    const copy = structuredClone(document) as unknown as ParserDocument;
    await SwaggerParser.validate(copy, { resolve: { external: false }, validate: { schema: false, spec: false } });
    return [];
  } catch (error) {
    return validatorProblems(error, version);
  }
}

/**
 * Security requirements must name schemes declared in components.securitySchemes.
 * The OpenAPI validator does not check this, and the generator input could not
 * be built for such an operation, so it is reported here with its location.
 */
function unknownSecuritySchemes(document: JsonObject): SpecError[] {
  const components = isJsonObject(document.components) ? document.components : {};
  const schemes = isJsonObject(components.securitySchemes) ? components.securitySchemes : {};
  const errors: SpecError[] = [];

  const check = (requirements: JsonValue | undefined, segments: string[]) => {
    if (!Array.isArray(requirements)) return;
    requirements.forEach((requirement, index) => {
      if (!isJsonObject(requirement)) return;
      for (const name of Object.keys(requirement)) {
        if (Object.hasOwn(schemes, name) || errors.length >= MAX_VALIDATION_ERRORS) continue;
        errors.push({
          code: "unknown-security-scheme",
          message: `The security requirement "${name}" has no matching entry in components › securitySchemes. Declare the scheme or remove the requirement.`,
          location: formatLocation([...segments, String(index)]),
        });
      }
    });
  };

  check(document.security, ["security"]);
  const paths = isJsonObject(document.paths) ? document.paths : {};
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isJsonObject(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (isJsonObject(operation)) check(operation.security, ["paths", path, method, "security"]);
    }
  }
  return errors;
}

function validatorProblems(error: unknown, version: OpenApiVersion): SpecError[] {
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
        ? `The specification is not valid OpenAPI ${version}: ${message}`
        : `The specification is not valid OpenAPI ${version}.`,
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
