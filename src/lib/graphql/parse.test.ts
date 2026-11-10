import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGraphqlSchema } from "./parse";

function sample(name: string): string {
  return readFileSync(join(process.cwd(), "samples/specs", name), "utf8");
}

describe("parseGraphqlSchema", () => {
  it("builds a schema from SDL", () => {
    const result = parseGraphqlSchema(sample("books.graphql"));
    expect(result.ok && Object.keys(result.value.getQueryType()?.getFields() ?? {})).toEqual([
      "books",
      "book",
      "node",
      "search",
      "health",
    ]);
  });

  it("builds the same schema from an introspection result, with or without the data wrapper", () => {
    const wrapped = sample("books-introspection.json");
    const unwrapped = JSON.stringify((JSON.parse(wrapped) as { data: unknown }).data);
    for (const text of [wrapped, unwrapped]) {
      const result = parseGraphqlSchema(text);
      expect(result.ok && result.value.getMutationType()?.name).toBe("Mutation");
    }
  });

  it("reports SDL syntax errors with their position", () => {
    expect(parseGraphqlSchema("type Query {\n  books: [Book!\n}")).toMatchObject({
      ok: false,
      errors: [{ code: "invalid-schema", location: expect.stringMatching(/^line \d+, column \d+$/) as string }],
    });
  });

  it("reports invalid schemas, such as unknown types", () => {
    expect(parseGraphqlSchema("type Query { books: [Book] }")).toMatchObject({
      ok: false,
      errors: [{ code: "invalid-schema", message: expect.stringContaining("Book") as string }],
    });
  });

  it("explains JSON that is not an introspection result", () => {
    expect(parseGraphqlSchema('{"openapi": "3.0.3"}')).toMatchObject({
      ok: false,
      errors: [{ code: "not-introspection" }],
    });
  });

  it("rejects empty input", () => {
    expect(parseGraphqlSchema("  \n")).toMatchObject({ ok: false, errors: [{ code: "empty" }] });
  });

  it("reports invalid introspection JSON with its line and column", () => {
    const result = parseGraphqlSchema('{\n  "__schema": {\n    "types": []\n  },\n}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "not-json",
      message: expect.stringMatching(/^The schema is not valid JSON: /) as string,
      location: "line 5, column 1",
    });
  });
});
