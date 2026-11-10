import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateResponseSchema } from "@/lib/validation/responses";
import { POST } from "./route";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/graphql/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const schema = readFileSync(join(process.cwd(), "samples/specs/books.graphql"), "utf8");

describe("POST /api/graphql/generate", () => {
  it("generates the client for one combination", async () => {
    const response = await post({
      schema,
      options: { target: "typescript-angular" },
      selection: [{ operationType: "query", field: "books" }],
    });

    expect(response.status).toBe(200);
    const body = generateResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ ok: true, kind: "graphql", destinationRoot: "src/app/api-client" });
  });

  it("rejects empty selections and invalid field names before generating", async () => {
    const empty = await post({ schema, options: { target: "csharp" }, selection: [] });
    expect(empty.status).toBe(400);
    const invalid = await post({
      schema,
      options: { target: "csharp" },
      selection: [{ operationType: "query", field: "books { id }" }],
    });
    expect(invalid.status).toBe(400);
  });

  it("rejects fields that are not in the schema", async () => {
    const response = await post({
      schema,
      options: { target: "csharp" },
      selection: [{ operationType: "query", field: "authors" }],
    });
    expect(response.status).toBe(422);
  });
});
