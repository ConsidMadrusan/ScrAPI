import { describe, expect, it } from "vitest";
import type { JsonObject } from "./json";
import { escapeSegment, pointerSegments, resolveRef, unescapeSegment } from "./pointer";

const document: JsonObject = {
  components: {
    schemas: { "a/b~c": { type: "string" }, list: [{ type: "integer" }] },
  },
};

describe("JSON pointer helpers", () => {
  it("escapes and unescapes segments symmetrically", () => {
    expect(escapeSegment("a/b~c")).toBe("a~1b~0c");
    expect(unescapeSegment("a~1b~0c")).toBe("a/b~c");
    expect(unescapeSegment("~01")).toBe("~1");
  });

  it("splits pointers into decoded segments", () => {
    expect(pointerSegments("/paths/~1users/get")).toEqual(["paths", "/users", "get"]);
    expect(pointerSegments("")).toEqual([]);
  });

  it("resolves internal references, including escaped names and array indexes", () => {
    expect(resolveRef(document, "#/components/schemas/a~1b~0c")).toEqual({ type: "string" });
    expect(resolveRef(document, "#/components/schemas/list/0")).toEqual({ type: "integer" });
    expect(resolveRef(document, "#")).toBe(document);
  });

  it("does not resolve missing, inherited, non-index, or external references", () => {
    expect(resolveRef(document, "#/components/schemas/Missing")).toBeUndefined();
    expect(resolveRef(document, "#/components/schemas/toString")).toBeUndefined();
    expect(resolveRef(document, "#/components/schemas/list/length")).toBeUndefined();
    expect(resolveRef(document, "#/components/schemas/list/00")).toBeUndefined();
    expect(resolveRef(document, "other.json#/components/schemas/list")).toBeUndefined();
    expect(resolveRef(document, "components/schemas/list")).toBeUndefined();
  });
});
