import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GraphqlGenerateRequest } from "@/lib/validation/requests";
import { generateGraphqlClient } from "./generate";

const schema = readFileSync(join(process.cwd(), "samples/specs/books.graphql"), "utf8");

const selection: GraphqlGenerateRequest["selection"] = [
  { operationType: "query", field: "books" },
  { operationType: "query", field: "book" },
  { operationType: "mutation", field: "addBook" },
];

function file(result: Awaited<ReturnType<typeof generateGraphqlClient>>, path: string): string {
  if (!result.ok) throw new Error(`expected success: ${JSON.stringify(result.errors)}`);
  const found = result.value.files.find((candidate) => candidate.archivePath === path);
  if (!found) throw new Error(`missing ${path}`);
  return found.content;
}

describe("generateGraphqlClient", () => {
  it("generates a typed SDK with one method per selected operation for TypeScript targets", async () => {
    const result = await generateGraphqlClient({ schema, options: { target: "typescript-next", httpClient: "fetch" }, selection });

    expect(result.ok && result.value).toMatchObject({
      kind: "graphql",
      archiveRoot: "api-client",
      destinationRoot: "src/lib/api-client",
      files: [
        { archivePath: "api-client/graphql.ts", destinationPath: "src/lib/api-client/graphql.ts" },
        { archivePath: "api-client/operations.graphql", destinationPath: "src/lib/api-client/operations.graphql" },
      ],
    });
    const sdk = file(result, "api-client/graphql.ts");
    expect(sdk).toContain("export function getSdk<C>(requester: Requester<C>)");
    expect(sdk).toMatch(/^\s+Books\(variables\?: BooksQueryVariables/m);
    expect(sdk).toMatch(/^\s+Book\(variables: BookQueryVariables/m);
    expect(sdk).toMatch(/^\s+AddBook\(variables: AddBookMutationVariables/m);
    // Custom scalars carry no type information: they are typed as unknown.
    expect(sdk).toContain("publishedAt: unknown");
  });

  it("writes a StrawberryShake project for C#, without generated C# code", async () => {
    const result = await generateGraphqlClient({ schema, options: { target: "csharp" }, selection });

    expect(result.ok && result.value.files.map((candidate) => candidate.archivePath)).toEqual([
      "ApiClient/.graphqlrc.json",
      "ApiClient/ApiClient.csproj",
      "ApiClient/Operations.graphql",
      "ApiClient/schema.extensions.graphql",
      "ApiClient/schema.graphql",
    ]);
    expect(file(result, "ApiClient/ApiClient.csproj")).toContain('<PackageReference Include="StrawberryShake.Server" Version="16.7.5" />');
    expect(JSON.parse(file(result, "ApiClient/.graphqlrc.json"))).toMatchObject({
      extensions: { strawberryShake: { name: "GraphQLClient", namespace: "ApiClient" } },
    });
    expect(file(result, "ApiClient/Operations.graphql")).toMatch(/^query Books\(/m);
    expect(file(result, "ApiClient/schema.graphql")).toContain("type Book implements Node");
  });

  it("rejects selections that are not in the schema", async () => {
    const result = await generateGraphqlClient({
      schema,
      options: { target: "csharp" },
      selection: [{ operationType: "mutation", field: "books" }],
    });
    expect(result).toMatchObject({ ok: false, status: 422, errors: [{ code: "unknown-operations" }] });
  });

  it("rejects invalid schemas", async () => {
    const result = await generateGraphqlClient({
      schema: "type Query { books: [Missing] }",
      options: { target: "csharp" },
      selection,
    });
    expect(result).toMatchObject({ ok: false, status: 422, errors: [{ code: "invalid-schema" }] });
  });
});
