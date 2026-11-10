import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildResultZip, checkArchivableAll } from "@/lib/archive/result-zip";
import { generateGraphqlClient } from "@/lib/graphql/generate";
import { COMBINATIONS } from "@/lib/targets/catalog";
import type { GenerationOptions } from "@/lib/validation/requests";
import type { GraphqlGenerateSuccess } from "@/lib/validation/responses";
import { renderChainedGuide } from "./chained";
import { renderGuideMarkdown } from "./markdown";
import { renderGuide } from "./render";

const schema = readFileSync(join(process.cwd(), "samples/specs/books.graphql"), "utf8");

async function result(options: GenerationOptions): Promise<GraphqlGenerateSuccess> {
  const generated = await generateGraphqlClient({
    schema,
    options,
    selection: [
      { operationType: "query", field: "book" },
      { operationType: "query", field: "books" },
      { operationType: "mutation", field: "addBook" },
    ],
  });
  if (!generated.ok) throw new Error(JSON.stringify(generated.errors));
  return generated.value;
}

function code(guide: ReturnType<typeof renderGuide>): string {
  return guide.steps
    .flatMap((step) => step.blocks)
    .flatMap((block) => (block.kind === "code" ? [block.code] : []))
    .join("\n");
}

describe("renderGuide for GraphQL results", () => {
  it.each(COMBINATIONS)("calls a query without required variables from the generated client for %j", async (options) => {
    const guide = renderGuide(await result(options));
    const text = code(guide);

    expect(guide.placeholders.map((placeholder) => placeholder.token)).toContain("<YOUR_GRAPHQL_ENDPOINT>");
    if (options.target === "csharp") {
      expect(text).toContain(".AddGraphQLClient()");
      expect(text).toContain("client.Books.ExecuteAsync(genre: null, first: null, cancellationToken)");
    } else {
      expect(text).toContain("getSdk(");
      expect(text).toMatch(/api\.Books\(\)/);
    }
  });

  it("uses the chosen HTTP client in the TypeScript requester", async () => {
    expect(code(renderGuide(await result({ target: "typescript-nuxt", httpClient: "axios" })))).toContain(
      "axios.post<GraphQLResponse<R>>",
    );
    expect(code(renderGuide(await result({ target: "typescript-nuxt", httpClient: "fetch" })))).toContain(
      "await fetch(endpoint",
    );
  });

  it("starts with the official CLI commands in the new-project guide", async () => {
    const guide = renderGuide(await result({ target: "csharp" }), { project: "new" });
    const commands = guide.steps[0]?.blocks.flatMap((block) => (block.kind === "command" ? [block.command] : []));
    expect(commands).toContain("dotnet new webapi -n MyApp.Api -o src/MyApp.Api -f net10.0");
  });
});

describe("archiving GraphQL results", () => {
  it("builds a ZIP with every combination and the guide", async () => {
    // One at a time: the server runs at most two GraphQL generations at once.
    const results: GraphqlGenerateSuccess[] = [];
    for (const options of COMBINATIONS) results.push(await result(options));
    expect(checkArchivableAll(results)).toBeUndefined();

    const guide = renderChainedGuide(results);
    const zip = await buildResultZip(guide);
    expect(zip.byteLength).toBeGreaterThan(0);
    const markdown = renderGuideMarkdown(guide);
    expect(markdown).toContain("`csharp/ApiClient/Operations.graphql`");
    expect(markdown).toContain("`nextjs-axios/api-client/graphql.ts`");
  });
});
