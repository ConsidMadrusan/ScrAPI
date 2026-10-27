import { isJsonObject, type JsonObject, type JsonValue } from "@/lib/openapi/json";
import {
  formatOperationKey,
  HTTP_METHODS,
  type HttpMethod,
  type OperationKey,
} from "@/lib/validation/operation";

/** Raised when a specification cannot be filtered for the given selection. */
export class SpecFilterError extends Error {
  override name = "SpecFilterError";
}

const HTTP_METHOD_SET = new Set<string>(HTTP_METHODS);
const COMPONENT_REF = /^#\/components\/([^/]+)\/([^/]+)(?:\/.*)?$/;

/** Component names to keep, per components section (e.g. `schemas`). */
type KeptComponents = Map<string, Set<string>>;

/**
 * Returns a new specification that contains only the selected operations and
 * every component they need, transitively. The input is never modified.
 */
export function filterSpec(
  spec: JsonObject,
  selection: readonly OperationKey[],
): JsonObject {
  const paths = spec.paths;
  if (!isJsonObject(paths)) {
    throw new SpecFilterError("The specification has no paths object.");
  }

  const keptPaths = selectOperations(paths, selection);
  const keptOperations = listOperationObjects(keptPaths);
  const components = isJsonObject(spec.components) ? spec.components : {};

  const securityRefs = securitySchemeNames(spec.security, keptOperations).map(
    (name) => `#/components/securitySchemes/${escapePointer(name)}`,
  );
  const kept = collectComponents(components, keptPaths, securityRefs);

  const result: JsonObject = { ...spec, paths: keptPaths };
  // Root security only applies to operations without their own. When no kept
  // operation inherits it, its schemes were not kept, so drop it as well.
  if (!keptOperations.some((operation) => operation.security === undefined)) {
    delete result.security;
  }
  const keptComponentsObject = pickComponents(components, kept);
  if (keptComponentsObject === undefined) {
    delete result.components;
  } else {
    result.components = keptComponentsObject;
  }

  const keptTags = pickTags(spec.tags, keptOperations);
  if (keptTags === undefined) {
    delete result.tags;
  } else {
    result.tags = keptTags;
  }

  return structuredClone(result);
}

/** Builds a paths object with only the selected methods, in spec order. */
function selectOperations(
  paths: JsonObject,
  selection: readonly OperationKey[],
): JsonObject {
  const wanted = new Set(selection.map(formatOperationKey));
  const found = new Set<string>();
  const keptPaths: JsonObject = {};

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isJsonObject(pathItem)) continue;

    const keptItem: JsonObject = {};
    let hasOperation = false;
    for (const [field, value] of Object.entries(pathItem)) {
      if (!isHttpMethod(field)) {
        // Path-level fields such as shared parameters apply to kept methods.
        keptItem[field] = value;
        continue;
      }
      const key = formatOperationKey({ method: field, path });
      if (wanted.has(key)) {
        keptItem[field] = value;
        found.add(key);
        hasOperation = true;
      }
    }

    if (hasOperation) {
      if (typeof keptItem.$ref === "string") {
        throw new SpecFilterError(
          `Path item references ("$ref" on ${path}) are not supported.`,
        );
      }
      keptPaths[path] = keptItem;
    }
  }

  const unknown = [...wanted].filter((key) => !found.has(key));
  if (unknown.length > 0) {
    throw new SpecFilterError(
      `Unknown operations in selection: ${unknown.join(", ")}.`,
    );
  }
  return keptPaths;
}

function isHttpMethod(field: string): field is HttpMethod {
  return HTTP_METHOD_SET.has(field);
}

function listOperationObjects(paths: JsonObject): JsonObject[] {
  const operations: JsonObject[] = [];
  for (const pathItem of Object.values(paths)) {
    if (!isJsonObject(pathItem)) continue;
    for (const [field, value] of Object.entries(pathItem)) {
      if (HTTP_METHOD_SET.has(field) && isJsonObject(value)) {
        operations.push(value);
      }
    }
  }
  return operations;
}

/**
 * Security scheme names used by the kept operations. Global security applies
 * to every operation that does not declare its own.
 */
function securitySchemeNames(
  globalSecurity: JsonValue | undefined,
  operations: readonly JsonObject[],
): string[] {
  const names = new Set<string>();
  const addRequirements = (requirements: JsonValue | undefined) => {
    if (!Array.isArray(requirements)) return;
    for (const requirement of requirements) {
      if (isJsonObject(requirement)) {
        for (const name of Object.keys(requirement)) names.add(name);
      }
    }
  };

  for (const operation of operations) {
    if (operation.security === undefined) {
      addRequirements(globalSecurity);
    } else {
      addRequirements(operation.security);
    }
  }
  return [...names];
}

/**
 * Walks the root, the extra references, and every component they reference,
 * transitively, and returns the set of components reached. Cycles are
 * visited once.
 */
function collectComponents(
  components: JsonObject,
  root: JsonValue,
  extraRefs: readonly string[],
): KeptComponents {
  const kept: KeptComponents = new Map();
  const pending: JsonValue[] = [root];

  const visitRef = (ref: string) => {
    const match = COMPONENT_REF.exec(ref);
    const section = match?.[1];
    const encodedName = match?.[2];
    if (section === undefined || encodedName === undefined) {
      throw new SpecFilterError(
        `Unsupported reference "${ref}". Only "#/components/..." references can be used.`,
      );
    }
    const name = unescapePointer(encodedName);
    const sectionObject = components[section];
    const target = isJsonObject(sectionObject) ? sectionObject[name] : undefined;
    if (target === undefined) {
      throw new SpecFilterError(`Reference "${ref}" does not resolve.`);
    }

    const names = kept.get(section) ?? new Set<string>();
    kept.set(section, names);
    if (!names.has(name)) {
      names.add(name);
      pending.push(target);
    }
  };

  const walk = (value: JsonValue) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    // Strings outside "$ref" and discriminator mappings are plain data.
    if (!isJsonObject(value)) return;

    for (const [field, child] of Object.entries(value)) {
      if (field === "$ref" && typeof child === "string") {
        visitRef(child);
        continue;
      }
      if (field === "discriminator" && isJsonObject(child)) {
        visitDiscriminatorMapping(child.mapping, visitRef);
      }
      // Still walk "discriminator": it may be a property name holding a schema.
      walk(child);
    }
  };

  extraRefs.forEach(visitRef);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    walk(next);
  }
  return kept;
}

/** Discriminator mapping values are schema names or references. */
function visitDiscriminatorMapping(
  mapping: JsonValue | undefined,
  visitRef: (ref: string) => void,
) {
  if (!isJsonObject(mapping)) return;
  for (const target of Object.values(mapping)) {
    if (typeof target !== "string") continue;
    visitRef(
      target.startsWith("#/")
        ? target
        : `#/components/schemas/${escapePointer(target)}`,
    );
  }
}

/** Copies kept components in their original order. */
function pickComponents(
  components: JsonObject,
  kept: KeptComponents,
): JsonObject | undefined {
  const result: JsonObject = {};
  for (const [section, sectionObject] of Object.entries(components)) {
    const names = kept.get(section);
    if (names === undefined || !isJsonObject(sectionObject)) continue;
    const picked: JsonObject = {};
    for (const [name, component] of Object.entries(sectionObject)) {
      if (names.has(name)) picked[name] = component;
    }
    result[section] = picked;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Keeps tag definitions that at least one kept operation uses. */
function pickTags(
  tags: JsonValue | undefined,
  operations: readonly JsonObject[],
): JsonValue[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  const used = new Set<string>();
  for (const operation of operations) {
    if (!Array.isArray(operation.tags)) continue;
    for (const tag of operation.tags) {
      if (typeof tag === "string") used.add(tag);
    }
  }
  const kept = tags.filter(
    (tag) => isJsonObject(tag) && typeof tag.name === "string" && used.has(tag.name),
  );
  return kept.length > 0 ? kept : undefined;
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapePointer(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}
