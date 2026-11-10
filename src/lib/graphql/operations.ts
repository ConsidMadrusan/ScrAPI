import {
  isNonNullType,
  type GraphQLField,
  type GraphQLObjectType,
  type GraphQLSchema,
} from "graphql";
import type { GraphqlOperationKey, GraphqlOperationType } from "@/lib/validation/requests";
import type { GraphqlOperation, OperationGroup } from "@/lib/validation/responses";

export type { GraphqlOperation };

const GROUP_NAMES: Record<GraphqlOperationType, string> = { query: "Queries", mutation: "Mutations" };

/** `query books`: the canonical id of a GraphQL operation. */
export function graphqlOperationId(key: GraphqlOperationKey): string {
  return `${key.operationType} ${key.field}`;
}

/**
 * Lists the selectable operations: every root field of the Query and Mutation
 * types, in schema order. Each gets the name of the operation ScrAPI builds
 * for it: the field in PascalCase (`books` → `Books`), or with a `Mutation`
 * suffix when a query already uses that name.
 */
export function listGraphqlOperations(schema: GraphQLSchema): GraphqlOperation[] {
  const operations: GraphqlOperation[] = [];
  const usedNames = new Set<string>();
  for (const [operationType, root] of rootTypes(schema)) {
    for (const field of Object.values(root.getFields())) {
      const name = uniqueName(pascalCase(field.name), operationType, usedNames);
      usedNames.add(name);
      const operation: GraphqlOperation = {
        id: graphqlOperationId({ operationType, field: field.name }),
        operationType,
        field: field.name,
        name,
        requiresInput: hasRequiredArguments(field),
      };
      if (field.description) operation.description = field.description;
      if (field.deprecationReason !== undefined && field.deprecationReason !== null) operation.deprecated = true;
      operations.push(operation);
    }
  }
  return operations;
}

/** One group per root type: "Queries", then "Mutations". */
export function groupGraphqlOperations(operations: readonly GraphqlOperation[]): OperationGroup[] {
  return (["query", "mutation"] as const).flatMap((operationType) => {
    const ids = operations.filter((operation) => operation.operationType === operationType).map((operation) => operation.id);
    return ids.length > 0 ? [{ key: operationType, name: GROUP_NAMES[operationType], operationIds: ids }] : [];
  });
}

/** Number of Subscription fields, which ScrAPI does not generate. */
export function subscriptionCount(schema: GraphQLSchema): number {
  return Object.keys(schema.getSubscriptionType()?.getFields() ?? {}).length;
}

export type GraphqlSelectionResult =
  | { ok: true; selected: GraphqlOperation[] }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "unknown"; unknownIds: string[] };

/** Checks a submitted selection against the schema's operations; returns them once each, in schema order. */
export function resolveGraphqlSelection(
  operations: readonly GraphqlOperation[],
  selection: readonly GraphqlOperationKey[],
): GraphqlSelectionResult {
  const requested = new Set(selection.map(graphqlOperationId));
  if (requested.size === 0) return { ok: false, reason: "empty" };
  const known = new Set(operations.map((operation) => operation.id));
  const unknownIds = [...requested].filter((id) => !known.has(id));
  if (unknownIds.length > 0) return { ok: false, reason: "unknown", unknownIds };
  return { ok: true, selected: operations.filter((operation) => requested.has(operation.id)) };
}

/** `Books`, else `BooksMutation`, else `BooksMutation2`, … (GraphQL names are case-sensitive, PascalCase is not). */
function uniqueName(base: string, operationType: GraphqlOperationType, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  const suffixed = `${base}${pascalCase(operationType)}`;
  let name = suffixed;
  for (let counter = 2; used.has(name); counter += 1) name = `${suffixed}${String(counter)}`;
  return name;
}

function rootTypes(schema: GraphQLSchema): [GraphqlOperationType, GraphQLObjectType][] {
  const query = schema.getQueryType();
  const mutation = schema.getMutationType();
  return [
    ...(query ? [["query", query] as [GraphqlOperationType, GraphQLObjectType]] : []),
    ...(mutation ? [["mutation", mutation] as [GraphqlOperationType, GraphQLObjectType]] : []),
  ];
}

function hasRequiredArguments(field: GraphQLField<unknown, unknown>): boolean {
  return field.args.some((argument) => isNonNullType(argument.type) && argument.defaultValue === undefined);
}

/** GraphQL names are `[_A-Za-z][_0-9A-Za-z]*`, so upper-casing the first letter keeps them valid. */
function pascalCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
