import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { graphqlValidateResponseSchema } from "@/lib/validation/responses";
import { POST } from "./route";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/graphql/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const sdl = readFileSync(join(process.cwd(), "samples/specs/books.graphql"), "utf8");

describe("POST /api/graphql/validate", () => {
  it("returns the schema as SDL, its info, and the selectable operations in groups", async () => {
    const response = await post({ schema: sdl });

    expect(response.status).toBe(200);
    const body = graphqlValidateResponseSchema.parse(await response.json());
    if (!body.ok) throw new Error("expected success");
    expect(body.kind).toBe("graphql");
    expect(body.schema).toContain("type Query");
    expect(body.info).toMatchObject({ subscriptionCount: 1 });
    expect(body.operations).toHaveLength(7);
    expect(body.groups.map((group) => group.name)).toEqual(["Queries", "Mutations"]);
  });

  it("accepts introspection JSON", async () => {
    const introspection = readFileSync(join(process.cwd(), "samples/specs/books-introspection.json"), "utf8");
    const response = await post({ schema: introspection });
    expect(response.status).toBe(200);
  });

  it("returns 422 with problems for an invalid schema", async () => {
    const response = await post({ schema: "type Query { books: [Missing] }" });

    expect(response.status).toBe(422);
    expect(graphqlValidateResponseSchema.parse(await response.json())).toMatchObject({
      ok: false,
      errors: [{ code: "invalid-schema" }],
    });
  });

  it("returns 400 for a malformed request", async () => {
    const response = await post({ sdl });
    expect(response.status).toBe(400);
  });
});
