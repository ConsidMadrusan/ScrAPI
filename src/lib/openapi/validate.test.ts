import { readFileSync } from "node:fs";
import { join } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it, vi } from "vitest";
import { specFailureStatus } from "./errors";
import { MAX_CONCURRENT_VALIDATIONS, validateSpecification } from "./validate";

function sample(name: string): string {
  return readFileSync(join(process.cwd(), "samples/specs", name), "utf8");
}

const todo = sample("todo.json");

describe("validateSpecification", () => {
  it("accepts a valid specification and lists its operations", async () => {
    const result = await validateSpecification(todo);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operations.map((operation) => operation.id)).toEqual([
      "GET /todos",
      "POST /todos",
      "GET /todos/{todoId}",
      "PUT /todos/{todoId}",
      "DELETE /todos/{todoId}",
    ]);
    expect(result.value.document).toEqual(JSON.parse(todo));
  });

  it("returns the quick-check errors without running the validator", async () => {
    const result = await validateSpecification('{"swagger": "1.2"}');
    expect(result).toEqual({ ok: false, errors: [expect.objectContaining({ code: "swagger-2" })] });
  });

  it("maps OpenAPI schema violations to readable problems with locations", async () => {
    const text = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "T" },
      paths: { "/a": { get: {} }, b: {} },
    });

    const result = await validateSpecification(text);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        {
          code: "invalid-spec",
          message: "Must have required property 'version'.",
          location: "info",
        },
        {
          code: "invalid-spec",
          message: 'Must NOT have additional properties: "b".',
          location: "paths",
        },
      ]),
    );
    for (const error of result.errors) {
      expect(error.message).not.toMatch(/\bat \S+:\d+/); // no stack frames
    }
  });

  it.each([
    ["todo.yaml", ["yaml"]],
    ["todo-swagger2.json", ["swagger-2"]],
  ])("accepts %s after converting it, and returns the OpenAPI JSON to generate from", async (name, conversions) => {
    const result = await validateSpecification(sample(name));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.conversions).toEqual(conversions);
    expect(JSON.parse(result.value.text)).toEqual(result.value.document);
    expect(result.value.operations.map((operation) => operation.id)).toEqual(
      expect.arrayContaining(["GET /todos", "POST /todos", "GET /todos/{todoId}"]),
    );
  });

  it("still rejects references to other files after converting Swagger 2.0", async () => {
    const swagger = JSON.parse(sample("todo-swagger2.json")) as Record<string, Record<string, Record<string, unknown>>>;
    const definitions = swagger.definitions ?? {};
    definitions.Todo = { $ref: "common.json#/Todo" };

    const result = await validateSpecification(JSON.stringify(swagger));

    expect(result).toMatchObject({ ok: false, errors: [{ code: "external-ref" }] });
  });

  it("accepts the OpenAPI 3.1 sample and lists the operations of referenced path items", async () => {
    const result = await validateSpecification(sample("todo-3.1.json"));

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.operations.map((operation) => operation.id)).toEqual([
      "GET /todos",
      "POST /todos",
      "GET /todos/{todoId}",
      "PUT /todos/{todoId}",
      "DELETE /todos/{todoId}",
    ]);
  });

  it("accepts 3.1 operations without responses, which 3.1 allows", async () => {
    const text = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Non-oAuth Scopes example", version: "1.0.0" },
      paths: { "/users": { get: { security: [{ bearerAuth: ["read:users", "public"] }] } } },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "jwt" } } },
    });

    const result = await validateSpecification(text);

    expect(result.ok && result.value.operations.map((operation) => operation.id)).toEqual(["GET /users"]);
  });

  it("reports 3.1 schema violations with the 3.1 schema", async () => {
    const spec = JSON.parse(sample("todo-3.1.json")) as Record<string, unknown>;
    spec.info = { title: "T" };

    const result = await validateSpecification(JSON.stringify(spec));

    expect(result).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: "invalid-spec", location: "info" })],
    });
  });

  it("explains that webhooks are not generated when a 3.1 document has only webhooks", async () => {
    const text = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "T", version: "1" },
      webhooks: { ping: { post: { responses: { "200": { description: "OK" } } } } },
    });

    const result = await validateSpecification(text);

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "no-operations",
          message: expect.stringContaining("webhooks are not generated") as string,
        }),
      ],
    });
  });

  it("rejects specifications without operations", async () => {
    const text = JSON.stringify({ openapi: "3.0.3", info: { title: "T", version: "1" }, paths: {} });
    const result = await validateSpecification(text);
    expect(result).toEqual({ ok: false, errors: [expect.objectContaining({ code: "no-operations" })] });
  });

  it("rejects duplicate operationIds, which the generator cannot handle", async () => {
    const result = await validateSpecification(sample("library.json"));

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "duplicate-operation-id",
          message:
            'The operationId "getItem" is used by more than one operation (GET /authors/{authorId}, GET /reviews/{reviewId}). OpenAPI requires operationIds to be unique.',
        },
      ],
    });
  });

  it("rejects security requirements that name undeclared schemes, with their location", async () => {
    const text = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-Key" } } },
      security: [{ apiKey: [] }],
      paths: {
        "/a": { get: { security: [{ bearer: [] }], responses: { "200": { description: "OK" } } } },
        "/b": { get: { responses: { "200": { description: "OK" } } } },
      },
    });

    const result = await validateSpecification(text);

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "unknown-security-scheme",
          message: expect.stringContaining('"bearer"') as string,
          location: "paths › /a › get › security › 0",
        }),
      ],
    });
  });

  it("rejects validations beyond the concurrency limit as busy, then accepts again", async () => {
    const releases: (() => void)[] = [];
    const validateSpy = vi.spyOn(SwaggerParser, "validate").mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => {
            resolve({} as never);
          });
        }),
    );
    try {
      const running = Array.from({ length: MAX_CONCURRENT_VALIDATIONS }, () =>
        validateSpecification(todo),
      );
      await vi.waitFor(() => {
        expect(releases).toHaveLength(MAX_CONCURRENT_VALIDATIONS);
      });

      const busy = await validateSpecification(todo);
      expect(busy).toEqual({ ok: false, errors: [expect.objectContaining({ code: "validator-busy" })] });
      expect(!busy.ok && specFailureStatus(busy.errors)).toBe(503);

      for (const release of releases) release();
      for (const result of await Promise.all(running)) expect(result.ok).toBe(true);
    } finally {
      validateSpy.mockRestore();
    }

    expect((await validateSpecification(todo)).ok).toBe(true);
  });
});
