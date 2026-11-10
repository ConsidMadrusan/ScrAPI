import {
  concatAST,
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

  /** `operationId`: the operation that could not be built, e.g. `query books`. */
  constructor(
    readonly operationId: string,
    message: string,
  ) {
    super(message);
  }
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
 *   the leaf fields of each possible type (an interface's own fields are
 *   selected once, outside the fragments);
 * - a leaf field that two possible types declare with different types (for
 *   example `id: ID!` and `id: ID`) gets an alias per type (`idOnBook: id`),
 *   because GraphQL does not allow one response key with two types;
 * - a type with nothing selectable selects `__typename`, which every type has.
 *
 * Recursive types are cut off by the depth limit. Each operation is validated
 * against the schema on its own, so a failure names the operation.
 */
export function buildOperations(schema: GraphQLSchema, operations: readonly GraphqlOperation[]): DocumentNode {
  return concatAST(
    operations.map((operation) => {
      const document = parse(buildOperation(schema, operation));
      const [error] = validate(schema, document);
      if (error !== undefined) throw new OperationBuildError(operation.id, error.message);
      return document;
    }),
  );
}

function buildOperation(schema: GraphQLSchema, operation: GraphqlOperation): string {
  const root = operation.operationType === "query" ? schema.getQueryType() : schema.getMutationType();
  const field = root?.getFields()[operation.field];
  if (field === undefined) throw new OperationBuildError(operation.id, `The schema has no ${operation.id} field.`);

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
    return braces(["__typename", ...inlineFragments(named.getTypes(), new Set())]);
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
    // Fields of the interface itself are already selected above, with the interface's types.
    const selected = new Set(Object.keys(named.getFields()));
    selections.unshift("__typename");
    selections.push(...inlineFragments(schema.getPossibleTypes(named), selected));
  }
  return braces(selections.length > 0 ? selections : ["__typename"]);
}

/**
 * One inline fragment per possible type with its leaf fields, leaving out
 * `alreadySelected`. Fields whose type differs between the possible types are
 * aliased per type, so their response keys cannot conflict.
 */
function inlineFragments(types: readonly GraphQLObjectType[], alreadySelected: ReadonlySet<string>): string[] {
  const leavesOf = (type: GraphQLObjectType) =>
    Object.values(type.getFields()).filter(
      (field) => !needsArguments(field) && isLeafType(getNamedType(field.type)) && !alreadySelected.has(field.name),
    );

  const typesByName = new Map<string, Set<string>>();
  for (const type of types) {
    for (const field of leavesOf(type)) {
      const declared = typesByName.get(field.name) ?? new Set<string>();
      declared.add(field.type.toString());
      typesByName.set(field.name, declared);
    }
  }
  const conflicting = new Set([...typesByName].filter(([, declared]) => declared.size > 1).map(([name]) => name));
  // Response keys in use at this level, so an alias never reuses one.
  const used = new Set([...alreadySelected, ...typesByName.keys()]);

  return types.map((type) => {
    const selections = leavesOf(type).map((field) => {
      if (!conflicting.has(field.name)) return field.name;
      let alias = `${field.name}On${type.name}`;
      while (used.has(alias)) alias = `${alias}_`;
      used.add(alias);
      return `${alias}: ${field.name}`;
    });
    return `... on ${type.name} ${braces(selections.length > 0 ? selections : ["__typename"])}`;
  });
}

function needsArguments(field: GraphQLField<unknown, unknown>): boolean {
  return field.args.some((argument) => isNonNullType(argument.type) && argument.defaultValue === undefined);
}

function braces(selections: readonly string[]): string {
  return `{ ${selections.join(" ")} }`;
}
