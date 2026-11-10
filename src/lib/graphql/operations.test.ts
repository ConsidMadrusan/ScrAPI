import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSchema } from "graphql";
import { describe, expect, it } from "vitest";
import {
  groupGraphqlOperations,
  listGraphqlOperations,
  resolveGraphqlSelection,
  subscriptionCount,
} from "./operations";

const books = buildSchema(readFileSync(join(process.cwd(), "samples/specs/books.graphql"), "utf8"));

describe("listGraphqlOperations", () => {
  it("lists Query and Mutation fields with operation names and whether they need input", () => {
    expect(
      listGraphqlOperations(books).map(({ id, name, requiresInput }) => [id, name, requiresInput]),
    ).toEqual([
      ["query books", "Books", false],
      ["query book", "Book", true],
      ["query node", "Node", true],
      ["query search", "Search", true],
      ["query health", "Health", false],
      ["mutation addBook", "AddBook", true],
      ["mutation deleteBook", "DeleteBook", true],
    ]);
  });

  it("gives a mutation a distinct name when a query already uses it", () => {
    const schema = buildSchema(
      "type Query { book: String, Book: String } type Mutation { book: String }",
    );
    expect(listGraphqlOperations(schema).map((operation) => operation.name)).toEqual([
      "Book",
      "BookQuery",
      "BookMutation",
    ]);
  });

  it("counts subscriptions, which are not listed", () => {
    expect(subscriptionCount(books)).toBe(1);
    expect(listGraphqlOperations(books).some((operation) => operation.id.startsWith("subscription"))).toBe(false);
  });

  it("marks deprecated fields and keeps descriptions", () => {
    const schema = buildSchema('type Query { "All items." items: [String] old: String @deprecated(reason: "Use items") }');
    expect(listGraphqlOperations(schema)).toMatchObject([
      { field: "items", description: "All items." },
      { field: "old", deprecated: true },
    ]);
  });
});

describe("groupGraphqlOperations", () => {
  it("groups queries and mutations", () => {
    expect(groupGraphqlOperations(listGraphqlOperations(books)).map((group) => [group.name, group.operationIds.length])).toEqual([
      ["Queries", 5],
      ["Mutations", 2],
    ]);
  });
});

describe("resolveGraphqlSelection", () => {
  const operations = listGraphqlOperations(books);

  it("returns the selected operations once each, in schema order", () => {
    const result = resolveGraphqlSelection(operations, [
      { operationType: "mutation", field: "addBook" },
      { operationType: "query", field: "books" },
      { operationType: "query", field: "books" },
    ]);
    expect(result.ok && result.selected.map((operation) => operation.id)).toEqual(["query books", "mutation addBook"]);
  });

  it("rejects empty selections and unknown fields", () => {
    expect(resolveGraphqlSelection(operations, [])).toEqual({ ok: false, reason: "empty" });
    expect(resolveGraphqlSelection(operations, [{ operationType: "mutation", field: "books" }])).toEqual({
      ok: false,
      reason: "unknown",
      unknownIds: ["mutation books"],
    });
  });
});
