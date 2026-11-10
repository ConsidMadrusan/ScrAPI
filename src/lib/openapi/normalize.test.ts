import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isJsonObject, type JsonObject } from "./json";
import { normalizeSpecification } from "./normalize";

function sample(name: string): string {
  return readFileSync(join(process.cwd(), "samples/specs", name), "utf8");
}

function normalized(text: string) {
  const result = normalizeSpecification(text);
  if (!result.ok) throw new Error(`expected success: ${JSON.stringify(result.errors)}`);
  return { ...result.value, document: JSON.parse(result.value.text) as JsonObject };
}

describe("normalizeSpecification", () => {
  it("returns OpenAPI 3.x JSON unchanged, so error positions still match the input", () => {
    const text = sample("todo.json");
    expect(normalizeSpecification(text)).toEqual({ ok: true, value: { text, conversions: [] } });
    expect(normalizeSpecification("{ not json")).toEqual({ ok: true, value: { text: "{ not json", conversions: [] } });
  });

  it("converts YAML to the same document as the JSON sample", () => {
    const { document, conversions } = normalized(sample("todo.yaml"));
    const json = JSON.parse(sample("todo.json")) as JsonObject;
    expect(conversions).toEqual(["yaml"]);
    expect(document.paths).toEqual(json.paths);
    expect(document.components).toEqual(json.components);
  });

  it("converts Swagger 2.0 to OpenAPI 3.0 with request bodies and components", () => {
    const { document, conversions } = normalized(sample("todo-swagger2.json"));
    expect(conversions).toEqual(["swagger-2"]);
    expect(document.openapi).toMatch(/^3\.0\.\d+$/);
    expect(document.swagger).toBeUndefined();
    const post = ((document.paths as JsonObject)["/todos"] as JsonObject).post as JsonObject;
    expect(post.requestBody).toMatchObject({
      required: true,
      content: { "application/json": { schema: { $ref: "#/components/schemas/NewTodo" } } },
    });
    expect(Object.keys((document.components as JsonObject).schemas as JsonObject).sort()).toEqual([
      "NewTodo",
      "Todo",
      "TodoStatus",
    ]);
  });

  it("converts Swagger 2.0 written in YAML in one go", () => {
    const yaml = "swagger: '2.0'\ninfo: { title: T, version: '1' }\npaths:\n  /a:\n    get:\n      responses:\n        '200': { description: OK }\n";
    const { document, conversions } = normalized(yaml);
    expect(conversions).toEqual(["yaml", "swagger-2"]);
    expect(document.openapi).toMatch(/^3\.0\./);
  });

  it("keeps references to other files, so validation can reject them", () => {
    const swagger = JSON.parse(sample("todo-swagger2.json")) as JsonObject;
    ((swagger.definitions as JsonObject).Todo as JsonObject).allOf = [{ $ref: "common.yaml#/Base" }];
    const { document } = normalized(JSON.stringify(swagger));
    expect(JSON.stringify(document)).toContain("common.yaml#/Base");
  });

  it("rejects invalid YAML with its position", () => {
    expect(normalizeSpecification("openapi: 3.0.3\ninfo: [unclosed\n")).toMatchObject({
      ok: false,
      errors: [{ code: "invalid-yaml", location: expect.stringMatching(/^line \d+, column \d+$/) as string }],
    });
  });

  it("rejects duplicate keys", () => {
    expect(normalizeSpecification("openapi: 3.0.3\nopenapi: 3.1.0\n")).toMatchObject({
      ok: false,
      errors: [{ code: "invalid-yaml" }],
    });
  });

  it("rejects alias expansion attacks", () => {
    const levels = ["a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let level = 1; level < 9; level += 1) {
      const previous = String.fromCharCode(96 + level);
      const name = String.fromCharCode(97 + level);
      levels.push(`${name}: &${name} [${Array.from({ length: 10 }, () => `*${previous}`).join(", ")}]`);
    }
    expect(normalizeSpecification(levels.join("\n"))).toMatchObject({
      ok: false,
      errors: [{ code: "invalid-yaml", message: expect.stringContaining("too many aliases") as string }],
    });
  });

  it("does not interpret custom tags", () => {
    const { document } = normalized('openapi: 3.0.3\nx-code: !js/function "function () {}"\n');
    expect(typeof document["x-code"]).toBe("string");
    expect(isJsonObject(document)).toBe(true);
  });
});

describe("unquoted YAML versions", () => {
  it("converts Swagger 2.0 written as `swagger: 2.0`, which YAML reads as a number", () => {
    const yaml = ["swagger: 2.0", "info:", "  title: T", "  version: '1'", "paths:", "  /x:", "    get:", "      responses:", "        '200':", "          description: ok", ""].join("\n");

    const result = normalizeSpecification(yaml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.conversions).toEqual(["yaml", "swagger-2"]);
    expect(JSON.parse(result.value.text)).toMatchObject({ openapi: expect.stringMatching(/^3\.0\./) as string });
  });
});
