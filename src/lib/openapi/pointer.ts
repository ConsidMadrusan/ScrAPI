import { isJsonObject, type JsonValue } from "./json";

const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

/** Encodes one JSON pointer segment (`~` → `~0`, `/` → `~1`). */
export function escapeSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Decodes one JSON pointer segment (`~1` → `/`, `~0` → `~`). */
export function unescapeSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Splits a JSON pointer such as `/paths/~1users/get` into decoded segments. */
export function pointerSegments(pointer: string): string[] {
  return pointer.split("/").slice(1).map(unescapeSegment);
}

/**
 * Resolves an internal reference such as `#/components/schemas/User` in
 * `document`. Returns `undefined` for external references and for references
 * that do not resolve. Only own properties are followed, and array elements
 * are addressed by their decimal index.
 */
export function resolveRef(document: JsonValue, ref: string): JsonValue | undefined {
  if (ref !== "#" && !ref.startsWith("#/")) return undefined;
  let current: JsonValue | undefined = document;
  for (const segment of pointerSegments(ref.slice(1))) {
    if (Array.isArray(current)) {
      current = ARRAY_INDEX.test(segment) ? current[Number(segment)] : undefined;
    } else if (isJsonObject(current)) {
      current = Object.hasOwn(current, segment) ? current[segment] : undefined;
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}
