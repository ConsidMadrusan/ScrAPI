import { readFileSync } from "node:fs";
import { join } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it } from "vitest";
import { isJsonObject, type JsonObject, type JsonValue } from "@/lib/openapi/json";
import { HTTP_METHODS, type OperationKey } from "@/lib/validation/operation";
import { filterSpec, SpecFilterError } from "./filter-spec";

function loadSample(name: string): JsonObject {
  const text = readFileSync(join(process.cwd(), "samples/specs", name), "utf8");
  const value = JSON.parse(text) as JsonValue;
  if (!isJsonObject(value)) throw new Error(`${name} is not a JSON object`);
  return value;
}

function deepFreeze<T extends JsonValue>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach((child: JsonValue) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}

function allOperations(spec: JsonObject): OperationKey[] {
  const paths = isJsonObject(spec.paths) ? spec.paths : {};
  return Object.entries(paths).flatMap(([path, item]) =>
    HTTP_METHODS.filter((method) => isJsonObject(item) && method in item).map(
      (method) => ({ method, path }),
    ),
  );
}

function section(spec: JsonObject, name: string): JsonObject | undefined {
  const components = spec.components;
  if (!isJsonObject(components)) return undefined;
  const value = components[name];
  return isJsonObject(value) ? value : undefined;
}

function names(spec: JsonObject, sectionName: string): string[] {
  return Object.keys(section(spec, sectionName) ?? {}).sort();
}

function tagNames(spec: JsonObject): string[] | undefined {
  if (!Array.isArray(spec.tags)) return undefined;
  return spec.tags.flatMap((tag) =>
    isJsonObject(tag) && typeof tag.name === "string" ? [tag.name] : [],
  );
}

type ParserDocument = Exclude<Parameters<typeof SwaggerParser.validate>[0], string>;

async function validate(spec: JsonObject) {
  // The validator dereferences in place, so give it its own copy.
  const copy = structuredClone(spec) as unknown as ParserDocument;
  return SwaggerParser.validate(copy, { resolve: { external: false } });
}

const library = deepFreeze(loadSample("library.json"));
const todo = deepFreeze(loadSample("todo.json"));

describe("filterSpec", () => {
  it("keeps one method of a shared path and its transitive schemas", () => {
    const result = filterSpec(library, [{ method: "get", path: "/books" }]);

    expect(Object.keys(result.paths ?? {})).toEqual(["/books"]);
    const books = (result.paths as JsonObject)["/books"] as JsonObject;
    expect(Object.keys(books).sort()).toEqual(["get", "parameters"]);

    expect(names(result, "schemas")).toEqual([
      "Author",
      "Book",
      "BookBase",
      "Error",
      "Genre",
      "MetadataValue",
      "Tag",
    ]);
    expect(names(result, "parameters")).toEqual(["Page", "PageSize"]);
    expect(names(result, "responses")).toEqual(["BadRequest"]);
    expect(section(result, "requestBodies")).toBeUndefined();
    expect(section(result, "securitySchemes")).toBeUndefined();
    expect(tagNames(result)).toEqual(["books"]);
  });

  it("selects POST independently of GET on the same path", () => {
    const result = filterSpec(library, [{ method: "post", path: "/books" }]);

    const books = (result.paths as JsonObject)["/books"] as JsonObject;
    expect(books).not.toHaveProperty("get");
    expect(books).toHaveProperty("post");
    expect(names(result, "requestBodies")).toEqual(["BookInput"]);
    expect(names(result, "schemas")).toContain("NewBook");
    expect(names(result, "securitySchemes")).toEqual(["apiKey"]);
    expect(tagNames(result)).toEqual(["books", "admin"]);
  });

  it("keeps referenced headers, responses, and path-level parameters", () => {
    const result = filterSpec(library, [
      { method: "get", path: "/books/{bookId}" },
    ]);

    expect(names(result, "headers")).toEqual(["RateLimit"]);
    expect(names(result, "responses")).toEqual(["NotFound"]);
    expect(names(result, "parameters")).toEqual(["BookId"]);
  });

  it("follows oneOf members and their nested references", () => {
    const result = filterSpec(library, [
      { method: "get", path: "/reviews/{reviewId}" },
    ]);

    expect(names(result, "schemas")).toEqual([
      "Rating",
      "RatingReview",
      "Review",
      "TextReview",
    ]);
    expect(tagNames(result)).toBeUndefined();
  });

  it("omits components entirely when an operation needs none", () => {
    const result = filterSpec(library, [{ method: "get", path: "/health" }]);

    expect(result).not.toHaveProperty("components");
    expect(result).not.toHaveProperty("tags");
  });

  it("drops only unused components when every operation is selected", () => {
    const result = filterSpec(library, allOperations(library));

    expect(result.paths).toEqual(library.paths);
    expect(names(result, "schemas")).not.toContain("Publisher");
    expect(names(result, "schemas")).toHaveLength(names(library, "schemas").length - 1);
    expect(names(result, "securitySchemes")).toEqual(["apiKey"]);
    expect(tagNames(result)).toEqual(["books", "authors", "admin"]);
  });

  it("keeps global security schemes for operations without their own", () => {
    const result = filterSpec(todo, [{ method: "get", path: "/todos" }]);

    expect(names(result, "securitySchemes")).toEqual(["bearer"]);
    expect(result.security).toEqual(todo.security);
  });

  it("drops global security when every kept operation declares its own", async () => {
    const spec: JsonObject = {
      openapi: "3.0.3",
      info: { title: "Secured", version: "1" },
      security: [{ global: [] }],
      paths: {
        "/public": {
          get: { security: [], responses: { "200": { description: "ok" } } },
        },
        "/keyed": {
          get: { security: [{ key: [] }], responses: { "200": { description: "ok" } } },
        },
        "/inherits": {
          get: { responses: { "200": { description: "ok" } } },
        },
      },
      components: {
        securitySchemes: {
          global: { type: "http", scheme: "bearer" },
          key: { type: "apiKey", in: "header", name: "X-Key" },
        },
      },
    };

    const result = filterSpec(spec, [
      { method: "get", path: "/public" },
      { method: "get", path: "/keyed" },
    ]);

    expect(result).not.toHaveProperty("security");
    expect(names(result, "securitySchemes")).toEqual(["key"]);
    expect(spec.security).toEqual([{ global: [] }]);
    await expect(validate(result)).resolves.toBeDefined();

    const inheriting = filterSpec(spec, [{ method: "get", path: "/inherits" }]);
    expect(inheriting.security).toEqual([{ global: [] }]);
    expect(names(inheriting, "securitySchemes")).toEqual(["global"]);
  });

  it("follows discriminator mappings by name and by reference", () => {
    const spec: JsonObject = {
      openapi: "3.0.3",
      info: { title: "Pets", version: "1" },
      paths: {
        "/pets": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Pet" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: "object",
            required: ["kind"],
            properties: { kind: { type: "string" } },
            discriminator: {
              propertyName: "kind",
              mapping: { cat: "Cat", dog: "#/components/schemas/Dog" },
            },
          },
          Cat: { type: "object" },
          Dog: { type: "object" },
          Unused: { type: "object" },
        },
      },
    };

    const result = filterSpec(spec, [{ method: "get", path: "/pets" }]);
    expect(names(result, "schemas")).toEqual(["Cat", "Dog", "Pet"]);
  });

  it("treats reference-like strings in data as data", () => {
    const spec: JsonObject = {
      openapi: "3.0.3",
      info: { title: "Data", version: "1" },
      paths: {
        "/x": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { type: "string", enum: ["#/components/schemas/Missing"] },
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(() => filterSpec(spec, [{ method: "get", path: "/x" }])).not.toThrow();
  });

  it("does not modify the input or share objects with it", () => {
    // `library` is deeply frozen: any write to it would throw.
    const result = filterSpec(library, [{ method: "post", path: "/books" }]);

    const bookInput = section(result, "requestBodies")?.BookInput as JsonObject;
    bookInput.required = false;
    expect(section(library, "requestBodies")?.BookInput).toHaveProperty("required", true);
  });

  it("rejects operations that do not exist", () => {
    expect(() =>
      filterSpec(library, [
        { method: "get", path: "/nope" },
        { method: "patch", path: "/books" },
      ]),
    ).toThrow(new SpecFilterError("Unknown operations in selection: GET /nope, PATCH /books."));
  });

  it("rejects references that do not resolve", () => {
    const spec = structuredClone(library);
    const schemas = section(spec, "schemas") as JsonObject;
    delete schemas.Genre;

    expect(() => filterSpec(spec, [{ method: "get", path: "/books" }])).toThrow(
      'Reference "#/components/schemas/Genre" does not resolve.',
    );
  });

  it("rejects external references", () => {
    const spec = structuredClone(library);
    const schemas = section(spec, "schemas") as JsonObject;
    schemas.Tag = { $ref: "other.json#/Tag" };

    expect(() => filterSpec(spec, [{ method: "get", path: "/books" }])).toThrow(
      SpecFilterError,
    );
  });

  describe("produces specifications that still validate", () => {
    const cases = [
      ...allOperations(library).map((op) => ({ name: "library", spec: library, selection: [op] })),
      ...allOperations(todo).map((op) => ({ name: "todo", spec: todo, selection: [op] })),
      { name: "library", spec: library, selection: allOperations(library) },
      { name: "todo", spec: todo, selection: allOperations(todo) },
    ];

    it.each(cases)("$name: $selection.length operation(s), first $selection.0.method $selection.0.path", async ({ spec, selection }) => {
      await expect(validate(filterSpec(spec, selection))).resolves.toBeDefined();
    });
  });
});
