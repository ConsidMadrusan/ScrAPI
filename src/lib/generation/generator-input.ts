import { isJsonObject, type JsonObject } from "@/lib/openapi/json";
import { HTTP_METHODS } from "@/lib/validation/operation";

/**
 * Returns a copy in which each operation keeps only its first tag. Generators
 * emit one API class per tag, so an operation with several tags would be
 * generated several times (and duplicate TypeScript exports would not compile).
 */
export function keepFirstTagOnly(spec: JsonObject): JsonObject {
  const copy = structuredClone(spec);
  if (!isJsonObject(copy.paths)) return copy;

  for (const pathItem of Object.values(copy.paths)) {
    if (!isJsonObject(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (isJsonObject(operation) && Array.isArray(operation.tags) && operation.tags.length > 1) {
        operation.tags = operation.tags.slice(0, 1);
      }
    }
  }
  return copy;
}
