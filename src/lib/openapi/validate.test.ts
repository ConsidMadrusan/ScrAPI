import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSpecification } from "./validate";

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
    const result = await validateSpecification("openapi: 3.0.3");
    expect(result).toEqual({ ok: false, errors: [expect.objectContaining({ code: "yaml" })] });
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
});
