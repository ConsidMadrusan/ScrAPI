import { describe, expect, it } from "vitest";
import type { JsonObject } from "@/lib/openapi/json";
import { prepareGeneratorInput } from "./generator-input";

describe("prepareGeneratorInput: tags", () => {
  const spec: JsonObject = {
    openapi: "3.0.3",
    paths: {
      "/books": {
        parameters: [],
        get: { tags: ["books"], responses: {} },
        post: { tags: ["books", "admin"], responses: {} },
      },
      "/health": { get: { responses: {} } },
    },
  };

  it("keeps only the first tag of each operation", () => {
    const result = prepareGeneratorInput(spec);
    expect(result.paths).toEqual({
      "/books": {
        parameters: [],
        get: { tags: ["books"], responses: {} },
        post: { tags: ["books"], responses: {} },
      },
      "/health": { get: { responses: {} } },
    });
  });

  it("skips blank tags, as the operation list does", () => {
    const result = prepareGeneratorInput({
      openapi: "3.0.3",
      paths: { "/x": { get: { tags: ["", "b"], responses: {} }, post: { tags: [" "], responses: {} } } },
    });
    expect(result.paths).toEqual({ "/x": { get: { tags: ["b"], responses: {} }, post: { responses: {} } } });
  });

  it("does not modify its input", () => {
    const before = structuredClone(spec);
    prepareGeneratorInput(spec);
    expect(spec).toEqual(before);
  });
});

describe("prepareGeneratorInput: const", () => {
  const spec: JsonObject = {
    openapi: "3.1.0",
    paths: {},
    components: {
      schemas: {
        Todo: {
          type: "object",
          properties: {
            kind: { const: "todo" },
            version: { const: 2 },
            mixed: { const: "a", enum: ["a"] },
            nested: { const: { a: 1 } },
            const: { type: "string", description: "a property named const" },
          },
          example: { const: "data, not a keyword" },
        },
      },
    },
  };

  it("turns scalar const values into one-value enums, leaving names and data alone", () => {
    const result = prepareGeneratorInput(spec);
    expect(result.components).toEqual({
      schemas: {
        Todo: {
          type: "object",
          properties: {
            kind: { enum: ["todo"] },
            version: { enum: [2] },
            mixed: { const: "a", enum: ["a"] },
            nested: { const: { a: 1 } },
            const: { type: "string", description: "a property named const" },
          },
          example: { const: "data, not a keyword" },
        },
      },
    });
  });

  it("does not modify its input", () => {
    const before = structuredClone(spec);
    prepareGeneratorInput(spec);
    expect(spec).toEqual(before);
  });
});

describe("prepareGeneratorInput: missing responses", () => {
  const spec: JsonObject = {
    openapi: "3.1.0",
    paths: {
      "/users": {
        get: {
          security: [{ bearerAuth: ["read:users"] }],
          callbacks: { done: { "{$request.body#/url}": { post: {} } } },
        },
        post: { responses: { "201": { description: "Created" } } },
      },
    },
    components: {
      pathItems: { Shared: { delete: {} } },
      callbacks: { Reusable: { "{$url}": { put: {} } } },
    },
  };

  it("adds a default response where an operation declares none, everywhere operations live", () => {
    const result = prepareGeneratorInput(spec);
    const fallback = { default: { description: "Default response" } };
    const users = (result.paths as JsonObject)["/users"] as JsonObject;
    const get = users.get as JsonObject;
    const components = result.components as JsonObject;

    expect(get.responses).toEqual(fallback);
    expect((users.post as JsonObject).responses).toEqual({ "201": { description: "Created" } });
    expect(get.callbacks).toEqual({ done: { "{$request.body#/url}": { post: { responses: fallback } } } });
    expect(components.pathItems).toEqual({ Shared: { delete: { responses: fallback } } });
    expect(components.callbacks).toEqual({ Reusable: { "{$url}": { put: { responses: fallback } } } });
  });

  it("does not modify its input", () => {
    const before = structuredClone(spec);
    prepareGeneratorInput(spec);
    expect(spec).toEqual(before);
  });
});
