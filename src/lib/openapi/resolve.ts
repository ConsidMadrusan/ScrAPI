import { pointerSegments } from "./errors";
import { isJsonObject, type JsonObject, type JsonValue } from "./json";

/** Most references followed in one chain (`A` → `B` → …), which also stops cycles. */
const MAX_REFERENCE_CHAIN = 10;

/**
 * The value an internal reference such as `#/components/schemas/Todo` points
 * to, or undefined when it does not resolve. Only own properties count, so
 * names such as `constructor` never resolve to built-in values.
 */
export function resolveReference(document: JsonObject, ref: string): JsonValue | undefined {
  if (!ref.startsWith("#")) return undefined;
  let current: JsonValue | undefined = document;
  for (const segment of pointerSegments(ref.slice(1))) {
    if (Array.isArray(current)) {
      current = /^\d+$/.test(segment) ? current[Number(segment)] : undefined;
    } else if (isJsonObject(current)) {
      current = Object.hasOwn(current, segment) ? current[segment] : undefined;
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Follows a Reference object (`{ "$ref": "#/..." }`) through any chain of
 * references to the object it finally stands for. Other values are returned
 * unchanged; an unresolvable or too long chain returns undefined.
 */
export function followReferences(document: JsonObject, value: JsonValue | undefined): JsonValue | undefined {
  let current = value;
  for (let step = 0; step <= MAX_REFERENCE_CHAIN; step += 1) {
    if (!isJsonObject(current) || typeof current.$ref !== "string") return current;
    current = resolveReference(document, current.$ref);
  }
  return undefined;
}

/**
 * A path item with its `$ref` (OpenAPI 3.1, e.g. to `#/components/pathItems/X`)
 * replaced by the referenced fields. Fields declared next to the `$ref` win,
 * as the standard leaves conflicts undefined. Path items without `$ref` are
 * returned unchanged; undefined when the reference does not resolve.
 */
export function resolvePathItem(document: JsonObject, pathItem: JsonValue | undefined): JsonObject | undefined {
  if (!isJsonObject(pathItem)) return undefined;
  if (typeof pathItem.$ref !== "string") return pathItem;
  const target = followReferences(document, pathItem);
  if (!isJsonObject(target)) return undefined;
  const siblings: JsonObject = { ...pathItem };
  delete siblings.$ref;
  return { ...target, ...siblings };
}
