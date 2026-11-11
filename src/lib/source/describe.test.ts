import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeGraphql, describeOpenApi } from "./describe";

const spec = (name: string) => readFileSync(join(process.cwd(), "samples/specs", name), "utf8");

describe("describeOpenApi", () => {
  it("lists the operations grouped by tag", async () => {
    const result = await describeOpenApi(spec("todo.json"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations.map((operation) => operation.id)).toContain("GET /todos");
    expect(result.groups.map((group) => group.name)).toContain("todos");
  });

  it("returns the converted OpenAPI JSON for YAML input", async () => {
    const result = await describeOpenApi(spec("todo.yaml"));

    expect(result.ok && result.conversions).toEqual(["yaml"]);
    expect(result.ok && JSON.parse(result.spec)).toHaveProperty("openapi");
  });

  it("fails with 422 for an invalid document", async () => {
    const result = await describeOpenApi('{"openapi": "3.0.3"}');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(422);
  });
});

describe("describeGraphql", () => {
  it("lists the Query and Mutation fields", () => {
    const result = describeGraphql(spec("books.graphql"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations.map((operation) => operation.id)).toEqual(
      expect.arrayContaining(["query books", "mutation addBook"]),
    );
    expect(result.info.subscriptionCount).toBe(1);
  });

  it("fails when there is nothing to generate", () => {
    const result = describeGraphql("type Subscription { a: Int }\ntype Query");

    expect(result.ok).toBe(false);
  });
});
