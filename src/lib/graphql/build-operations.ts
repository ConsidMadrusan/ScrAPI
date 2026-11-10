import {
  getNamedType,
  isInterfaceType,
  isLeafType,
  isNonNullType,
  isObjectType,
  isUnionType,
  parse,
  validate,
  type DocumentNode,
  type GraphQLField,
  type GraphQLObjectType,
  type GraphQLOutputType,
  type GraphQLSchema,
} from "graphql";
import type { GraphqlOperation } from "./operations";

/**
 * How deep the selection of an operation goes: the root field's own scalar and
 * enum fields (depth 1), plus those of the objects it returns (depth 2).
 * Deeper data needs operations written by hand.
 */
export const SELECTION_DEPTH = 2;

/** Raised when an operation that ScrAPI built does not validate against the schema. */
export class OperationBuildError extends Error {
  override name = "OperationBuildError";
}

/**
 * Builds one GraphQL operation per selected root field, as input for the
 * code generators (ScrAPI generates no client code itself). For each field:
 *
 * - every argument becomes a variable of the same type;
 * - the selection has the leaf (scalar and enum) fields of the returned type,
 *   and of nested object types down to SELECTION_DEPTH;
 * - nested fields that need arguments without defaults are skipped;
 * - interfaces and unions select `__typename` plus one inline fragment with
 *   the leaf fields of each possible type;
 * - a type with nothing selectable selects `__typename`, which every type has.
 *
 * Recursive types are cut off by the depth limit. The document is validated
 * against the schema before it is returned.
 */
export function buildOperations(schema: GraphQLSchema, operations: readonly GraphqlOperation[]): DocumentNode {
  const text = operations.map((operation) => buildOperation(schema, operation)).join("\n\n");
  const document = parse(text);
  const errors = validate(schema, document);
  if (errors.length > 0) {
    throw new OperationBuildError(errors[0]?.message ?? "The operations do not match the schema.");
  }
  return document;
}

function buildOperation(schema: GraphQLSchema, operation: GraphqlOperation): string {
  const root = operation.operationType === "query" ? schema.getQueryType() : schema.getMutationType();
  const field = root?.getFields()[operation.field];
  if (field === undefined) throw new OperationBuildError(`The schema has no ${operation.id} field.`);

  const variables = field.args.map((argument) => `$${argument.name}: ${argument.type.toString()}`);
  const args = field.args.map((argument) => `${argument.name}: $${argument.name}`);
  const selection = selectionSet(schema, field.type, 1);
  return [
    `${operation.operationType} ${operation.name}${variables.length > 0 ? `(${variables.join(", ")})` : ""} {`,
    `  ${field.name}${args.length > 0 ? `(${args.join(", ")})` : ""}${selection === "" ? "" : ` ${selection}`}`,
    "}",
  ].join("\n");
}

/** The selection set for a field of this type, or "" for scalars and enums. */
function selectionSet(schema: GraphQLSchema, type: GraphQLOutputType, depth: number): string {
  const named = getNamedType(type);
  if (isLeafType(named)) return "";
  if (isUnionType(named)) {
    return braces(["__typename", ...named.getTypes().map((member) => inlineFragment(member))]);
  }
  if (!isObjectType(named) && !isInterfaceType(named)) return braces(["__typename"]);

  const selections: string[] = [];
  for (const field of Object.values(named.getFields())) {
    if (needsArguments(field)) continue;
    if (isLeafType(getNamedType(field.type))) {
      selections.push(field.name);
    } else if (depth < SELECTION_DEPTH) {
      selections.push(`${field.name} ${selectionSet(schema, field.type, depth + 1)}`);
    }
  }
  if (isInterfaceType(named)) {
    selections.unshift("__typename");
    for (const implementation of schema.getPossibleTypes(named)) selections.push(inlineFragment(implementation));
  }
  return braces(selections.length > 0 ? selections : ["__typename"]);
}

function inlineFragment(type: GraphQLObjectType): string {
  const leaves = Object.values(type.getFields())
    .filter((field) => !needsArguments(field) && isLeafType(getNamedType(field.type)))
    .map((field) => field.name);
  return `... on ${type.name} ${braces(leaves.length > 0 ? leaves : ["__typename"])}`;
}

function needsArguments(field: GraphQLField<unknown, unknown>): boolean {
  return field.args.some((argument) => isNonNullType(argument.type) && argument.defaultValue === undefined);
}

function braces(selections: readonly string[]): string {
  return `{ ${selections.join(" ")} }`;
}
