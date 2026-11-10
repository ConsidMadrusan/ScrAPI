import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_SPEC_BYTES, MAX_SPEC_DEPTH } from "@/lib/validation/limits";
import type { SpecResult } from "./errors";
import type { JsonObject } from "./json";
import { parseSpecification } from "./parse";

function sample(name: string): string {
  return readFileSync(join(process.cwd(), "samples/specs", name), "utf8");
}

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

  it("rejects deeply nested documents without overflowing the stack", () => {
    const depth = 200_000;
    const text = spec().replace(/}$/, `,"x":${"[".repeat(depth)}${"]".repeat(depth)}}`);
    expect(errorCodes(parseSpecification(text))).toEqual(["too-deep"]);
  });

  it("accepts nesting up to the depth limit", () => {
    // The document object is level 1 and the "x" array is level 2.
    const arrays = MAX_SPEC_DEPTH - 1;
    const text = spec().replace(/}$/, `,"x":${"[".repeat(arrays)}${"]".repeat(arrays)}}`);
    expect(parseSpecification(text).ok).toBe(true);
    const tooDeep = spec().replace(/}$/, `,"x":${"[".repeat(arrays + 1)}${"]".repeat(arrays + 1)}}`);
    expect(errorCodes(parseSpecification(tooDeep))).toEqual(["too-deep"]);
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

  it("counts lines from the start of the pasted text, including leading blank lines", () => {
    const result = parseSpecification('\n\n  {\n  "openapi": "3.0.3",\n  info: {}\n}');
    expect(result).toMatchObject({ ok: false, errors: [{ code: "not-json", location: "line 5, column 3" }] });
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

  it("rejects a missing version and explains how to add it to an OpenAPI-shaped document", () => {
    const result = parseSpecification(JSON.stringify({ info: {}, paths: {} }));
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "missing-version", message: expect.stringContaining('"openapi": "3.0.3" or "openapi": "3.1.0"') as string }],
    });
  });

  it("recognizes the official OpenAPI meta-schema and says what to paste instead", () => {
    const metaSchema = {
      id: "https://spec.openapis.org/oas/3.0/schema/2024-10-18",
      $schema: "http://json-schema.org/draft-04/schema#",
      type: "object",
      required: ["openapi", "info", "paths"],
      properties: { openapi: { type: "string" } },
      definitions: { Info: { type: "object" } },
    };
    const result = parseSpecification(JSON.stringify(metaSchema));
    expect(result).toMatchObject({
      ok: false,
      errors: [
        {
          code: "json-schema",
          message: expect.stringContaining("defines the OpenAPI format itself") as string,
        },
      ],
    });
  });

  it("recognizes other JSON Schema documents", () => {
    const result = parseSpecification(JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" }));
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "json-schema", message: expect.stringContaining("This is a JSON Schema") as string }],
    });
  });

  it("says that a document without OpenAPI fields is not a specification", () => {
    const result = parseSpecification(JSON.stringify({ foo: 1 }));
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "missing-version", message: expect.stringContaining("not an OpenAPI specification") as string }],
    });
  });

  it.each(['{"openapi": 3.0, "info": {}, "paths": {}}', '{"openapi": 3, "info": {}, "paths": {}}'])(
    "rejects a version that is not a string: %s",
    (text) => {
      expect(parseSpecification(text)).toEqual({
        ok: false,
        errors: [
          {
            code: "invalid-version",
            message:
              'The "openapi" field must be a string such as "3.0.3", not a number. In YAML, put the version in quotes, for example openapi: "3.0.0".',
            location: "openapi",
          },
        ],
      });
    },
  );

  it("suggests the quoted form of an unquoted YAML version such as 3.1", () => {
    const result = parseSpecification('{"openapi": 3.1, "info": {}, "paths": {}}');
    expect(result.ok ? "" : result.errors[0]?.message).toContain('openapi: "3.1.0"');
  });

  it("does not suggest YAML quoting for other wrong types", () => {
    const result = parseSpecification('{"openapi": true, "info": {}, "paths": {}}');
    expect(result.ok ? "" : result.errors[0]?.message).toBe('The "openapi" field must be a string such as "3.0.3", not a boolean.');
  });

  it("reports every unresolved reference beyond the shown ones in one extra line", () => {
    const properties = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`p${String(index)}`, { $ref: `#/components/schemas/Missing${String(index)}` }]),
    );
    const text = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {},
      components: { schemas: { Thing: { type: "object", properties } } },
    });

    const result = parseSpecification(text);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(21);
    expect(result.errors.slice(0, 20).every((error) => error.code === "unresolved-ref")).toBe(true);
    expect(result.errors[20]).toEqual({
      code: "more-problems",
      message: "…and 5 more problems. Fix the ones above and check again.",
    });
  });

  it("names YAML as accepted input when the document is not OpenAPI at all", () => {
    const result = parseSpecification('{"hello": "world"}');
    expect(result.ok ? "" : result.errors[0]?.message).toContain("(JSON or YAML)");
  });

  it.each(["3.0.0", "3.0.4", "3.1.0", "3.1.2"])("accepts supported version %s", (version) => {
    expect(parseSpecification(spec({ openapi: version })).ok).toBe(true);
  });

  it.each(["3.2.0", "3.0", "4.0.0", "3.0.x", "3.1"])("rejects unsupported version %s", (version) => {
    const result = parseSpecification(spec({ openapi: version }));
    expect(errorCodes(result)).toEqual(["unsupported-version"]);
  });

  it("says that OpenAPI 3.2 is not supported yet and names the supported versions", () => {
    const result = parseSpecification(spec({ openapi: "3.2.0" }));
    expect(result.ok ? "" : result.errors[0]?.message).toBe(
      "OpenAPI 3.2.0 is not supported yet. ScrAPI supports OpenAPI 3.0.x and 3.1.x.",
    );
  });

  it("accepts the 3.1 sample specification", () => {
    expect(parseSpecification(sample("todo-3.1.json")).ok).toBe(true);
  });

  it.each(["$id", "$anchor", "$dynamicRef", "$dynamicAnchor"])(
    "rejects the 3.1 schema keyword %s with its location",
    (keyword) => {
      const text = spec({
        openapi: "3.1.0",
        components: { schemas: { Todo: { type: "object", [keyword]: "todo" } } },
      });
      expect(parseSpecification(text)).toEqual({
        ok: false,
        errors: [
          expect.objectContaining({
            code: "unsupported-keyword",
            location: `components › schemas › Todo › ${keyword}`,
          }),
        ],
      });
    },
  );

  it("does not mistake properties or example data named like 3.1 keywords for the keywords", () => {
    const text = spec({
      openapi: "3.1.0",
      components: {
        schemas: {
          Item: {
            type: "object",
            properties: { $id: { type: "string" } },
            example: { $anchor: "data" },
          },
        },
      },
    });
    expect(parseSpecification(text).ok).toBe(true);
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
