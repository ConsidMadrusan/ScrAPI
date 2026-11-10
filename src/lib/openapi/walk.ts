import { isJsonObject, type JsonObject, type JsonValue } from "./json";

/**
 * Fields whose object value maps user-chosen names to objects, e.g.
 * `properties`, `components.schemas`, `paths`, or `content`. Their keys are
 * names, never keywords, so a property called "const" is not the keyword.
 */
const NAME_MAP_FIELDS = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
  "schemas",
  "responses",
  "parameters",
  "requestBodies",
  "headers",
  "securitySchemes",
  "links",
  "callbacks",
  "pathItems",
  "paths",
  "webhooks",
  "content",
  "encoding",
  "variables",
  "mapping",
  "scopes",
]);

/** Fields that hold example or literal data, which is never walked. */
const DATA_FIELDS = new Set(["example", "examples", "default", "enum", "const"]);

/**
 * Calls `visit` for every OpenAPI or Schema object in the document (never for
 * a name map itself, and never inside example or literal data or `x-`
 * extensions), with the JSON pointer segments of its location. `visit` may
 * change the object it receives; children are read after it returns.
 */
export function forEachObject(
  document: JsonObject,
  visit: (node: JsonObject, segments: readonly string[]) => void,
): void {
  const walkNode = (node: JsonValue | undefined, segments: string[]): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => {
        walkNode(child, [...segments, String(index)]);
      });
      return;
    }
    if (!isJsonObject(node)) return;

    visit(node, segments);
    for (const [field, child] of Object.entries(node)) {
      if (DATA_FIELDS.has(field) || field.startsWith("x-")) continue;
      if (NAME_MAP_FIELDS.has(field) && isJsonObject(child)) {
        for (const [name, value] of Object.entries(child)) walkNode(value, [...segments, field, name]);
      } else {
        walkNode(child, [...segments, field]);
      }
    }
  };
  walkNode(document, []);
}
