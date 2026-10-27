import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@/lib/openapi/json";
import {
  findDuplicateOperationIds,
  groupByTag,
  listOperations,
  resolveSelection,
  UNTAGGED_GROUP_KEY,
} from "./operations";

const library = JSON.parse(
  readFileSync(join(process.cwd(), "samples/specs/library.json"), "utf8"),
) as JsonObject;
const operations = listOperations(library);

describe("listOperations", () => {
  it("lists one operation per method and path, in document order", () => {
    expect(operations.map((operation) => operation.id)).toEqual([
      "GET /books",
      "POST /books",
      "GET /books/{bookId}",
      "DELETE /books/{bookId}",
      "GET /authors/{authorId}",
      "GET /reviews/{reviewId}",
      "GET /health",
    ]);
  });

  it("keeps summary, tags, and operationId, and omits what is missing", () => {
    expect(operations[1]).toEqual({
      id: "POST /books",
      method: "post",
      path: "/books",
      tags: ["books", "admin"],
      requiresInput: true,
      summary: "Create a book",
      operationId: "createBook",
    });
    expect(operations[2]).not.toHaveProperty("operationId");
  });

  it.each([
    ["GET /books", false], // only optional (referenced) query parameters
    ["POST /books", true], // referenced required request body
    ["GET /books/{bookId}", true], // referenced path-level path parameter
    ["GET /authors/{authorId}", true], // inline path parameter
    ["GET /health", false],
  ])("knows whether %s needs arguments", (id, expected) => {
    expect(operations.find((operation) => operation.id === id)?.requiresInput).toBe(expected);
  });

  it("removes repeated tags on one operation", () => {
    const spec: JsonObject = {
      paths: { "/x": { get: { tags: ["a", "a", "b"], responses: {} } } },
    };
    expect(listOperations(spec)[0]?.tags).toEqual(["a", "b"]);
  });
});

describe("groupByTag", () => {
  const groups = groupByTag(library, operations);

  it("orders declared tags first and puts untagged operations under Other", () => {
    expect(groups.map((group) => [group.name, group.operationIds])).toEqual([
      ["books", ["GET /books", "POST /books", "GET /books/{bookId}"]],
      ["authors", ["GET /authors/{authorId}"]],
      ["admin", ["POST /books", "DELETE /books/{bookId}"]],
      ["Other", ["GET /reviews/{reviewId}", "GET /health"]],
    ]);
    expect(groups.at(-1)?.key).toBe(UNTAGGED_GROUP_KEY);
  });

  it("shows a multi-tag operation in each group but it is still one operation", () => {
    const appearances = groups.flatMap((group) => group.operationIds);
    expect(appearances.filter((id) => id === "POST /books")).toHaveLength(2);
    expect(new Set(appearances).size).toBe(operations.length);
  });

  it("adds tags that are used but not declared, after declared ones", () => {
    const spec: JsonObject = {
      tags: [{ name: "declared" }],
      paths: {
        "/a": { get: { tags: ["undeclared"], responses: {} } },
        "/b": { get: { tags: ["declared"], responses: {} } },
      },
    };
    expect(groupByTag(spec, listOperations(spec)).map((group) => group.name)).toEqual([
      "declared",
      "undeclared",
    ]);
  });

  it("keeps a tag named Other separate from the untagged group", () => {
    const spec: JsonObject = {
      paths: {
        "/a": { get: { tags: ["Other"], responses: {} } },
        "/b": { get: { responses: {} } },
      },
    };
    const keys = groupByTag(spec, listOperations(spec)).map((group) => group.key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("findDuplicateOperationIds", () => {
  it("reports operationIds used more than once", () => {
    const duplicates = findDuplicateOperationIds(operations);
    expect([...duplicates.keys()]).toEqual(["getItem"]);
    expect(duplicates.get("getItem")?.map((operation) => operation.id)).toEqual([
      "GET /authors/{authorId}",
      "GET /reviews/{reviewId}",
    ]);
  });
});

describe("resolveSelection", () => {
  it("returns selected keys once each, in document order", () => {
    const result = resolveSelection(operations, [
      { method: "get", path: "/health" },
      { method: "post", path: "/books" },
      { method: "get", path: "/health" },
    ]);
    expect(result).toEqual({
      ok: true,
      keys: [
        { method: "post", path: "/books" },
        { method: "get", path: "/health" },
      ],
    });
  });

  it("selects methods on the same path independently", () => {
    const result = resolveSelection(operations, [{ method: "post", path: "/books" }]);
    expect(result).toEqual({ ok: true, keys: [{ method: "post", path: "/books" }] });
  });

  it("rejects an empty selection", () => {
    expect(resolveSelection(operations, [])).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects operations that are not in the specification", () => {
    const result = resolveSelection(operations, [
      { method: "get", path: "/books" },
      { method: "patch", path: "/books" },
    ]);
    expect(result).toEqual({ ok: false, reason: "unknown", unknownIds: ["PATCH /books"] });
  });
});
