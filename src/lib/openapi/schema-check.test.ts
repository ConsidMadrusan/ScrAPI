import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "./json";
import { checkAgainstOfficialSchema, OFFICIAL_SCHEMA_IDS } from "./schema-check";

function sample(name: string): JsonObject {
  return JSON.parse(readFileSync(join(process.cwd(), "samples/specs", name), "utf8")) as JsonObject;
}

function specWithSecurityScheme(scheme: JsonObject): JsonObject {
  return {
    openapi: "3.0.3",
    info: { title: "T", version: "1" },
    paths: { "/a": { get: { responses: { "200": { description: "OK" } } } } },
    components: { securitySchemes: { auth: scheme } },
  };
}

describe("checkAgainstOfficialSchema", () => {
  it("uses the vendored revisions of the official schemas", () => {
    expect(OFFICIAL_SCHEMA_IDS).toEqual({
      "3.0": "https://spec.openapis.org/oas/3.0/schema/2024-10-18",
      "3.1": "https://spec.openapis.org/oas/3.1/schema/2026-08-03",
    });
  });

  it("accepts a valid specification", () => {
    expect(checkAgainstOfficialSchema(sample("todo.json"), "3.0")).toEqual([]);
  });

  it("accepts a capitalized Bearer scheme with a bearer format, which the 2019 revision rejected", () => {
    const spec = specWithSecurityScheme({ type: "http", scheme: "Bearer", bearerFormat: "JWT" });
    expect(checkAgainstOfficialSchema(spec, "3.0")).toEqual([]);
  });

  it("rejects an OAuth2 flow without scopes, with the location of the problem", () => {
    const spec = specWithSecurityScheme({
      type: "oauth2",
      flows: { clientCredentials: { tokenUrl: "https://example.com/token" } },
    });

    const errors = checkAgainstOfficialSchema(spec, "3.0");

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instancePath: "/components/securitySchemes/auth/flows/clientCredentials",
          params: { missingProperty: "scopes" },
        }),
      ]),
    );
  });

  it("accepts the 3.1 sample specification against the 3.1 schema", () => {
    expect(checkAgainstOfficialSchema(sample("todo-3.1.json"), "3.1")).toEqual([]);
  });

  it("reports 3.1 violations at their location, despite the schema's dynamic references", () => {
    const spec = sample("todo-3.1.json");
    const paths = spec.paths as JsonObject;
    const todos = paths["/todos"] as JsonObject;
    const get = todos.get as JsonObject;
    get.parameters = [{ name: "q", in: "nowhere", schema: { type: "string" } }];
    spec.info = { title: "T" };

    const locations = checkAgainstOfficialSchema(spec, "3.1").map((error) => error.instancePath);

    expect(locations).toEqual(expect.arrayContaining(["/info", "/paths/~1todos/get/parameters/0/in"]));
  });
});
