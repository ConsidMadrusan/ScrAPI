import { describe, expect, it } from "vitest";
import { MAX_SPEC_BYTES } from "@/lib/validation/limits";
import type { SpecResult } from "./errors";
import type { JsonObject } from "./json";
import { parseSpecification } from "./parse";

function spec(extra: JsonObject = {}): string {
  return JSON.stringify({
    openapi: "3.0.3",
    info: { title: "T", version: "1" },
    paths: {},
    ...extra,
  });
}

function errorCodes(result: SpecResult<unknown>): string[] {
  return result.ok ? [] : result.errors.map((error) => error.code);
}

describe("parseSpecification", () => {
  it("accepts a minimal OpenAPI 3.0 document, including a byte order mark", () => {
    const result = parseSpecification(`﻿  ${spec()}\n`);
    expect(result.ok).toBe(true);
  });

  it.each(["", "   \n\t"])("rejects empty input %#", (text) => {
    expect(errorCodes(parseSpecification(text))).toEqual(["empty"]);
  });

  it("rejects input over the size limit", () => {
    const text = `{"x":"${"a".repeat(MAX_SPEC_BYTES)}"}`;
    expect(errorCodes(parseSpecification(text))).toEqual(["too-large"]);
  });

  it.each([
    "openapi: 3.0.3\ninfo:\n  title: T",
    "---\nopenapi: 3.0.3",
    "# comment\nopenapi: 3.0.3",
  ])("recognizes YAML and explains that only JSON is accepted %#", (text) => {
    const result = parseSpecification(text);
    expect(errorCodes(result)).toEqual(["yaml"]);
  });

  it("reports malformed JSON with line and column", () => {
    const result = parseSpecification('{\n  "openapi": "3.0.3",\n  info: {}\n}');
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "not-json",
          message: expect.stringMatching(/^The specification is not valid JSON: .+\.$/) as string,
          location: "line 3, column 3",
        },
      ],
    });
  });

  it("explains a truncated document", () => {
    const result = parseSpecification('{"openapi": "3.0.3"');
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors[0]?.message).toContain("not valid JSON");
  });

  it.each(['["openapi"]', '"text"', "42"])("rejects JSON that is not an object: %s", (text) => {
    expect(errorCodes(parseSpecification(text))).toEqual(["not-object"]);
  });

  it("rejects Swagger 2.0", () => {
    const result = parseSpecification(JSON.stringify({ swagger: "2.0", info: {}, paths: {} }));
    expect(errorCodes(result)).toEqual(["swagger-2"]);
  });

  it("rejects a missing version", () => {
    const result = parseSpecification(JSON.stringify({ info: {}, paths: {} }));
    expect(errorCodes(result)).toEqual(["missing-version"]);
  });

  it.each(["3.1.0", "3.0", "4.0.0", "3.0.x"])("rejects unsupported version %s", (version) => {
    const result = parseSpecification(spec({ openapi: version }));
    expect(errorCodes(result)).toEqual(["unsupported-version"]);
  });

  it("names OpenAPI 3.1 explicitly", () => {
    const result = parseSpecification(spec({ openapi: "3.1.0" }));
    expect(result.ok ? "" : result.errors[0]?.message).toBe(
      "OpenAPI 3.1.0 is not supported yet. ScrAPI supports OpenAPI 3.0.x.",
    );
  });

  it("rejects external references with their location", () => {
    const result = parseSpecification(
      spec({
        components: {
          schemas: {
            A: { $ref: "other.json#/A" },
            B: { $ref: "https://example.com/b.json" },
          },
        },
      }),
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "external-ref",
          message: 'External references are not supported ("other.json#/A"). Make the specification self-contained.',
          location: "components › schemas › A",
        },
        expect.objectContaining({ code: "external-ref", location: "components › schemas › B" }),
      ],
    });
  });

  it("rejects internal references outside components and unresolved references", () => {
    const result = parseSpecification(
      spec({
        components: {
          schemas: {
            A: { $ref: "#/paths/~1x" },
            B: { $ref: "#/components/schemas/Missing" },
            C: { type: "array", items: { $ref: "#/components/schemas/A" } },
          },
        },
      }),
    );
    expect(errorCodes(result)).toEqual(["unsupported-ref", "unresolved-ref"]);
  });

  it("resolves escaped pointer segments", () => {
    const result = parseSpecification(
      spec({
        components: {
          schemas: {
            "a/b~c": { type: "string" },
            D: { $ref: "#/components/schemas/a~1b~0c" },
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
  });
});
