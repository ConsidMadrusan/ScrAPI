import { isJsonObject, type JsonObject, type JsonValue } from "@/lib/openapi/json";
import { resolveRef } from "@/lib/openapi/pointer";
import type { OperationGroup, OperationSummary } from "@/lib/validation/responses";
import {
  formatOperationKey,
  HTTP_METHODS,
  type OperationKey,
} from "@/lib/validation/operation";

export type { OperationGroup, OperationSummary };

export const UNTAGGED_GROUP_KEY = "untagged";
export const UNTAGGED_GROUP_NAME = "Other";

/** Lists operations in document order, one per method + path. */
export function listOperations(document: JsonObject): OperationSummary[] {
  const paths = isJsonObject(document.paths) ? document.paths : {};
  const operations: OperationSummary[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isJsonObject(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isJsonObject(operation)) continue;

      const summary: OperationSummary = {
        id: formatOperationKey({ method, path }),
        method,
        path,
        tags: uniqueStrings(operation.tags),
        requiresInput: requiresInput(document, pathItem, operation),
      };
      if (typeof operation.summary === "string") summary.summary = operation.summary;
      if (typeof operation.operationId === "string") {
        summary.operationId = operation.operationId;
      }
      if (operation.deprecated === true) summary.deprecated = true;
      operations.push(summary);
    }
  }
  return operations;
}

/**
 * Groups operations by tag: declared tags first (in declaration order), then
 * undeclared tags in order of use, then untagged operations under "Other".
 * An operation with several tags appears in each of their groups.
 */
export function groupByTag(
  document: JsonObject,
  operations: readonly OperationSummary[],
): OperationGroup[] {
  const declared = Array.isArray(document.tags)
    ? document.tags.flatMap((tag) =>
        isJsonObject(tag) && typeof tag.name === "string" ? [tag.name] : [],
      )
    : [];

  const byTag = new Map<string, string[]>();
  const untagged: string[] = [];
  for (const operation of operations) {
    if (operation.tags.length === 0) untagged.push(operation.id);
    for (const tag of operation.tags) {
      const ids = byTag.get(tag) ?? [];
      ids.push(operation.id);
      byTag.set(tag, ids);
    }
  }

  const order = [...new Set([...declared, ...byTag.keys()])];
  const groups: OperationGroup[] = order.flatMap((tag) => {
    const ids = byTag.get(tag);
    return ids ? [{ key: `tag:${tag}`, name: tag, operationIds: ids }] : [];
  });
  if (untagged.length > 0) {
    groups.push({
      key: UNTAGGED_GROUP_KEY,
      name: UNTAGGED_GROUP_NAME,
      operationIds: untagged,
    });
  }
  return groups;
}

/** operationIds used by more than one operation, with the operations using them. */
export function findDuplicateOperationIds(
  operations: readonly OperationSummary[],
): Map<string, OperationSummary[]> {
  const byId = new Map<string, OperationSummary[]>();
  for (const operation of operations) {
    if (operation.operationId === undefined) continue;
    const users = byId.get(operation.operationId) ?? [];
    users.push(operation);
    byId.set(operation.operationId, users);
  }
  return new Map([...byId].filter(([, users]) => users.length > 1));
}

export type SelectionResult =
  | { ok: true; selected: OperationSummary[] }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "unknown"; unknownIds: string[] };

/**
 * Checks a submitted selection against the operations in the specification.
 * Returns the selected operations once each, in document order.
 */
export function resolveSelection(
  operations: readonly OperationSummary[],
  selection: readonly OperationKey[],
): SelectionResult {
  const requested = new Set(selection.map(formatOperationKey));
  if (requested.size === 0) return { ok: false, reason: "empty" };

  const known = new Set(operations.map((operation) => operation.id));
  const unknownIds = [...requested].filter((id) => !known.has(id));
  if (unknownIds.length > 0) return { ok: false, reason: "unknown", unknownIds };

  const selected = operations.filter((operation) => requested.has(operation.id));
  return { ok: true, selected };
}

/**
 * True when calling the operation needs arguments: a required parameter
 * (path parameters always are) or a required request body.
 */
function requiresInput(document: JsonObject, pathItem: JsonObject, operation: JsonObject): boolean {
  const parameters = [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ];
  const requiredParameter = parameters.some((parameter) => {
    const resolved = resolveLocal(document, parameter);
    return isJsonObject(resolved) && (resolved.required === true || resolved.in === "path");
  });
  const body = resolveLocal(document, operation.requestBody);
  return requiredParameter || (isJsonObject(body) && body.required === true);
}

/** Follows one internal reference; other values are returned as they are. */
function resolveLocal(
  document: JsonObject,
  value: JsonValue | undefined,
): JsonValue | undefined {
  if (!isJsonObject(value) || typeof value.$ref !== "string") return value;
  return resolveRef(document, value.$ref);
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}
