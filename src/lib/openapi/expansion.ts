import { isJsonObject, type JsonObject, type JsonValue } from "./json";
import { resolveRef } from "./pointer";

/**
 * Largest accepted size of the specification with every non-circular `$ref`
 * replaced by its target, counted in JSON values. The OpenAPI validator
 * dereferences the document and then walks the result once per path, so a
 * small document whose schemas reference each other repeatedly can expand
 * exponentially and block the server. At this budget the validator takes
 * about a second; real specifications stay well below it.
 */
export const MAX_EXPANDED_VALUES = 3_000_000;

type Container = JsonObject | JsonValue[];

/** A container being measured, with its children still to visit. */
interface Frame {
  container: Container;
  children: JsonValue[];
  next: number;
  size: number;
}

/**
 * Whether the document, with its references expanded the way the OpenAPI
 * validator expands them, has more than `budget` JSON values. Runs in linear
 * time: the expanded size of every container is computed once and reused for
 * every reference to it. A reference back to a container that is still being
 * measured is circular; the validator leaves those unexpanded, so it counts
 * as one value. Iterative, so long reference chains cannot overflow the stack.
 * Expects every `$ref` to be internal and to resolve (see parseSpecification).
 */
export function exceedsExpansionBudget(
  document: JsonObject,
  budget: number = MAX_EXPANDED_VALUES,
): boolean {
  const sizes = new Map<Container, number>();
  const active = new Set<Container>();
  const stack: Frame[] = [];

  const enter = (container: Container) => {
    active.add(container);
    stack.push({ container, children: childrenOf(document, container), next: 0, size: 0 });
  };

  enter(document);
  for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
    const child = frame.children[frame.next];
    if (frame.next < frame.children.length) {
      frame.next += 1;
      if (child === undefined || !isContainer(child)) {
        frame.size += 1;
      } else if (active.has(child)) {
        frame.size += 1;
      } else {
        const known = sizes.get(child);
        if (known === undefined) enter(child);
        else frame.size += known;
      }
      continue;
    }

    stack.pop();
    active.delete(frame.container);
    // A reference object is replaced by its target, so it adds no value of its own.
    const size = frame.size + (isReference(frame.container) ? 0 : 1);
    if (size > budget) return true;
    sizes.set(frame.container, size);
    const parent = stack.at(-1);
    if (parent) parent.size += size;
  }
  return false;
}

function childrenOf(document: JsonObject, container: Container): JsonValue[] {
  if (Array.isArray(container)) return container;
  if (isReference(container)) {
    const target = resolveRef(document, container.$ref);
    return target === undefined ? [] : [target];
  }
  return Object.values(container);
}

function isContainer(value: JsonValue): value is Container {
  return Array.isArray(value) || isJsonObject(value);
}

function isReference(container: Container): container is JsonObject & { $ref: string } {
  return !Array.isArray(container) && typeof container.$ref === "string";
}
