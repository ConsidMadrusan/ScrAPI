import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectSourceKind, looksLikeOpenApiDocument } from "./source-kind";

function sample(name: string): string {
  return readFileSync(join(process.cwd(), "samples/specs", name), "utf8");
}

describe("detectSourceKind", () => {
  it.each([
    ["todo.json", "openapi"],
    ["todo.yaml", "openapi"],
    ["todo-swagger2.json", "openapi"],
    ["todo-3.1.json", "openapi"],
    ["books.graphql", "graphql"],
    ["books-introspection.json", "graphql"],
  ] as const)("recognizes %s as %s", (name, kind) => {
    expect(detectSourceKind(sample(name))).toBe(kind);
  });

  it("treats unclear text as OpenAPI, whose validation explains the problem", () => {
    expect(detectSourceKind("hello")).toBe("openapi");
    expect(detectSourceKind("")).toBe("openapi");
  });

  it("does not mistake YAML with a `type:` key for SDL", () => {
    expect(detectSourceKind("openapi: 3.0.3\ncomponents:\n  schemas:\n    A:\n      type: object\n")).toBe("openapi");
  });
});

describe("looksLikeOpenApiDocument", () => {
  it("finds the version field in JSON and YAML", () => {
    expect(looksLikeOpenApiDocument(sample("todo.json"))).toBe(true);
    expect(looksLikeOpenApiDocument(sample("todo.yaml"))).toBe(true);
    expect(looksLikeOpenApiDocument(sample("books.graphql"))).toBe(false);
  });
});
