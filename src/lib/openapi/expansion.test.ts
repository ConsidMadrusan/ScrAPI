import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exceedsExpansionBudget, MAX_EXPANDED_VALUES } from "./expansion";
import type { JsonObject } from "./json";

function sample(name: string): JsonObject {
  return JSON.parse(readFileSync(join(process.cwd(), "samples/specs", name), "utf8")) as JsonObject;
}

/** `count` schemas where each one references the next twice: 2^count values when expanded. */
function doublingChain(count: number): JsonObject {
  const schemas: JsonObject = {};
  for (let index = 0; index < count; index += 1) {
    const ref = `#/components/schemas/S${String(index + 1)}`;
    schemas[`S${String(index)}`] =
      index === count - 1
        ? { type: "string" }
        : { type: "object", properties: { a: { $ref: ref }, b: { $ref: ref } } };
  }
  return {
    openapi: "3.0.3",
    info: { title: "Doubling", version: "1" },
    paths: {},
    components: { schemas },
  };
}

describe("exceedsExpansionBudget", () => {
  it("accepts the sample specifications", () => {
    expect(exceedsExpansionBudget(sample("todo.json"))).toBe(false);
    expect(exceedsExpansionBudget(sample("library.json"))).toBe(false);
  });

  it("counts every value once, and a reference as its target", () => {
    const document: JsonObject = {
      a: { $ref: "#/components/x" },
      components: { x: { type: "string" } },
    };
    // root, a → x (object + 1 value), components, x (object + 1 value)
    expect(exceedsExpansionBudget(document, 6)).toBe(false);
    expect(exceedsExpansionBudget(document, 5)).toBe(true);
  });

  it("rejects small documents whose references expand exponentially, in linear time", () => {
    const document = doublingChain(60);
    const startedAt = Date.now();
    expect(exceedsExpansionBudget(document)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("counts circular references once instead of following them", () => {
    const document: JsonObject = {
      openapi: "3.0.3",
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: { next: { $ref: "#/components/schemas/Node" } },
          },
        },
      },
    };
    expect(exceedsExpansionBudget(document)).toBe(false);
  });

  it("handles long reference chains without overflowing the stack", () => {
    const schemas: JsonObject = {};
    const count = 50_000;
    for (let index = 0; index < count; index += 1) {
      schemas[`S${String(index)}`] =
        index === count - 1 ? { type: "string" } : { $ref: `#/components/schemas/S${String(index + 1)}` };
    }
    expect(exceedsExpansionBudget({ components: { schemas } }, MAX_EXPANDED_VALUES)).toBe(false);
  });
});
