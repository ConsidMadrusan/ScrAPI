import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSchema, print, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { buildOperations, type OperationBuildError } from "./build-operations";
import { listGraphqlOperations } from "./operations";

const books = buildSchema(readFileSync(join(process.cwd(), "samples/specs/books.graphql"), "utf8"));
const operations = listGraphqlOperations(books);

function built(...ids: string[]): string {
  return print(buildOperations(books, operations.filter((operation) => ids.includes(operation.id))));
}

describe("buildOperations", () => {
  it("builds one valid operation per selected field", () => {
    const document = buildOperations(books, operations);
    expect(validate(books, document)).toEqual([]);
    expect(document.definitions).toHaveLength(operations.length);
  });

  it("passes every argument as a variable of the same type", () => {
    expect(built("query books")).toContain("query Books($genre: Genre, $first: Int) {\n  books(genre: $genre, first: $first)");
    expect(built("mutation addBook")).toContain("mutation AddBook($input: NewBook!) {\n  addBook(input: $input)");
  });

  it("selects leaf fields two levels deep and stops there", () => {
    const text = built("query book");
    expect(text).toContain("title");
    expect(text).toMatch(/author \{\s+id\s+name\s+\}/);
    // Author.books and Author.bestBook would be a third level.
    expect(text).not.toContain("bestBook");
  });

  it("skips nested fields that need arguments without defaults", () => {
    // Book.reviews(first: Int!) has no default, so it cannot be selected without a variable.
    expect(built("query book")).not.toContain("reviews");
  });

  it("selects __typename and inline fragments for interfaces and unions", () => {
    const node = built("query node");
    expect(node).toContain("__typename");
    expect(node).toContain("... on Author");
    expect(node).toContain("... on Book");
    const search = built("query search");
    expect(search).toMatch(/search\(text: \$text\) \{\s+__typename\s+\.\.\. on Book/);
  });

  it("selects __typename when a type has nothing else that can be selected", () => {
    const schema = buildSchema("type Query { wrapper: Wrapper } type Wrapper { inner(id: ID!): String }");
    const document = buildOperations(schema, listGraphqlOperations(schema));
    expect(print(document)).toContain("wrapper {\n    __typename\n  }");
    expect(validate(schema, document)).toEqual([]);
  });

  it("selects scalar root fields without a selection set", () => {
    expect(built("query health")).toBe("query Health {\n  health\n}");
  });

  it("aliases union members' fields whose types differ, so the operation stays valid", () => {
    const schema = buildSchema(`
      type Book { id: ID! title: String }
      type Film { id: ID title: String }
      union Media = Book | Film
      type Query { media: [Media!]! }
    `);

    const document = buildOperations(schema, listGraphqlOperations(schema));

    expect(validate(schema, document)).toEqual([]);
    const text = print(document);
    expect(text).toContain("... on Book {\n      idOnBook: id\n      title\n    }");
    expect(text).toContain("... on Film {\n      idOnFilm: id\n      title\n    }");
  });

  it("selects an interface's own fields once and aliases conflicting implementation fields", () => {
    const schema = buildSchema(`
      interface Item { id: ID }
      type Book implements Item { id: ID! code: Int }
      type Film implements Item { id: ID code: String codeOnFilm: String }
      type Query { item: Item }
    `);

    const document = buildOperations(schema, listGraphqlOperations(schema));

    expect(validate(schema, document)).toEqual([]);
    const text = print(document);
    expect(text).toMatch(/item \{\s+__typename\s+id\s+\.\.\. on Book/);
    expect(text).toContain("codeOnBook: code");
    // The obvious alias is a real field of Film, so it gets another one.
    expect(text).toContain("codeOnFilm_: code");
    expect(text).toContain("codeOnFilm\n");
  });

  it("names the operation that could not be built", () => {
    const schema = buildSchema("type Query { a: String }");
    expect(() =>
      buildOperations(schema, [
        { id: "query missing", operationType: "query", field: "missing", name: "Missing", requiresInput: false },
      ]),
    ).toThrow(expect.objectContaining({ operationId: "query missing" }) as OperationBuildError);
  });
});
