import { isJsonObject, type JsonObject, type JsonValue } from "@/lib/openapi/json";
import { forEachObject } from "@/lib/openapi/walk";
import { HTTP_METHODS } from "@/lib/validation/operation";

/**
 * The generator's copy of a filtered specification. The original is never
 * changed. Each rewrite here is lossless and exists because a verified target
 * needs it (OpenAPI Generator 7.26.0); re-check them when the pinned version changes.
 */
export function prepareGeneratorInput(spec: JsonObject): JsonObject {
  const copy = structuredClone(spec);
  keepFirstTagOnly(copy);
  constAsSingleEnum(copy);
  addMissingResponses(copy);
  return copy;
}

/** Described for operations that declare no responses; no content, so no response type. */
const DEFAULT_RESPONSE: JsonObject = { default: { description: "Default response" } };

/**
 * OpenAPI 3.1 makes an operation's `responses` optional, but the generator's
 * own spec check still requires it and fails the whole run. Operations without
 * responses get a single `default` response without content, which describes
 * the same thing: nothing is known about the response body. Covers operations
 * in paths, in callbacks, and in reusable path items and callbacks.
 */
function addMissingResponses(spec: JsonObject): void {
  const visitPathItem = (pathItem: JsonValue | undefined): void => {
    if (!isJsonObject(pathItem)) return;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isJsonObject(operation)) continue;
      if (operation.responses === undefined) operation.responses = structuredClone(DEFAULT_RESPONSE);
      if (isJsonObject(operation.callbacks)) Object.values(operation.callbacks).forEach(visitCallback);
    }
  };
  const visitCallback = (callback: JsonValue): void => {
    if (isJsonObject(callback)) Object.values(callback).forEach(visitPathItem);
  };

  if (isJsonObject(spec.paths)) Object.values(spec.paths).forEach(visitPathItem);
  const components = isJsonObject(spec.components) ? spec.components : {};
  if (isJsonObject(components.pathItems)) Object.values(components.pathItems).forEach(visitPathItem);
  if (isJsonObject(components.callbacks)) Object.values(components.callbacks).forEach(visitCallback);
}

/**
 * Each operation keeps only its first tag. Generators emit one API class per
 * tag, so an operation with several tags would be generated several times
 * (and duplicate TypeScript exports would not compile).
 */
function keepFirstTagOnly(spec: JsonObject): void {
  if (!isJsonObject(spec.paths)) return;
  for (const pathItem of Object.values(spec.paths)) {
    if (!isJsonObject(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (isJsonObject(operation) && Array.isArray(operation.tags) && operation.tags.length > 1) {
        operation.tags = operation.tags.slice(0, 1);
      }
    }
  }
}

/**
 * OpenAPI 3.1 `const: X` becomes `enum: [X]`, which means the same. Every
 * target types a `const` property as `any` / `Object?`, but a one-value enum
 * as a typed enum. Only scalar values are rewritten, and only where the
 * schema has no `enum` of its own.
 */
function constAsSingleEnum(spec: JsonObject): void {
  forEachObject(spec, (node) => {
    const value = node.const;
    if (node.enum !== undefined) return;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return;
    node.enum = [value];
    delete node.const;
  });
}
