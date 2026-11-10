import { describe, expect, it } from "vitest";
import type { JsonObject } from "./json";
import { followReferences, resolvePathItem, resolveReference } from "./resolve";

const document: JsonObject = {
  components: {
    schemas: { Todo: { type: "object" }, "a/b": { type: "string" } },
    parameters: {
      A: { $ref: "#/components/parameters/B" },
      B: { name: "b", in: "query" },
      Loop: { $ref: "#/components/parameters/Loop" },
    },
    pathItems: { Item: { summary: "Shared", get: { responses: {} } } },
  },
  tags: [{ name: "first" }],
};

describe("resolveReference", () => {
  it("resolves JSON pointers, including escaped names and array indexes", () => {
    expect(resolveReference(document, "#/components/schemas/Todo")).toEqual({ type: "object" });
    expect(resolveReference(document, "#/components/schemas/a~1b")).toEqual({ type: "string" });
    expect(resolveReference(document, "#/tags/0/name")).toBe("first");
  });

  it("does not resolve missing, inherited, or external targets", () => {
    expect(resolveReference(document, "#/components/schemas/Missing")).toBeUndefined();
    expect(resolveReference(document, "#/components/schemas/constructor")).toBeUndefined();
    expect(resolveReference(document, "#/tags/first")).toBeUndefined();
    expect(resolveReference(document, "other.json#/Todo")).toBeUndefined();
  });
});

describe("followReferences", () => {
  it("follows a chain of references to the final object", () => {
    expect(followReferences(document, { $ref: "#/components/parameters/A" })).toEqual({ name: "b", in: "query" });
  });

  it("returns non-references unchanged and stops on cycles", () => {
    expect(followReferences(document, { name: "x" })).toEqual({ name: "x" });
    expect(followReferences(document, { $ref: "#/components/parameters/Loop" })).toBeUndefined();
  });
});

describe("resolvePathItem", () => {
  it("merges the referenced path item with the fields next to the reference", () => {
    expect(resolvePathItem(document, { $ref: "#/components/pathItems/Item", summary: "Local" })).toEqual({
      summary: "Local",
      get: { responses: {} },
    });
  });

  it("returns path items without a reference unchanged, and undefined for broken references", () => {
    const item = { get: { responses: {} } };
    expect(resolvePathItem(document, item)).toBe(item);
    expect(resolvePathItem(document, { $ref: "#/components/pathItems/Missing" })).toBeUndefined();
  });
});
