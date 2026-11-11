import "server-only";

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { describeGraphql, describeOpenApi } from "@/lib/source/describe";
import { detectSourceKind } from "@/lib/source-kind";
import { combinationKey, combinationLabel, COMBINATIONS } from "@/lib/targets/catalog";
import { resolveTarget } from "@/lib/targets/config";
import type { Problem } from "@/lib/validation/problems";
import { version } from "../../../package.json";
import { generateForAgent } from "./generate-all";
import { generateToolInputSchema, validateToolInputSchema } from "./schemas";
import { resolveSourceText } from "./source";

/** Tool names, also referenced by the agent skills in `integrations/`. */
export const TOOL_NAMES = ["scrapi_list_targets", "scrapi_validate", "scrapi_generate"] as const;

const INSTRUCTIONS = `ScrAPI turns an API description (OpenAPI 3.0/3.1, Swagger 2.0, or a GraphQL schema) into typed client code for Next.js, Nuxt, Angular, or C#/.NET projects, using deterministic generators.
Workflow: scrapi_list_targets to pick framework combinations for the user's project, scrapi_validate to list the operations (pass the description text as source, or its public URL as url when you cannot load it yourself), then scrapi_generate with the chosen operations. scrapi_generate returns every file with its destination path in the project and an integration guide. ScrAPI never writes files: you write them into the project and follow the guide's edit steps.`;

/** Project markers an agent can look for to choose a combination. */
const DETECTION_HINTS: Record<string, string> = {
  "nextjs-axios": 'package.json depends on "next" and "axios"',
  "nextjs-fetch": 'package.json depends on "next" (no axios)',
  "nuxt-axios": 'package.json depends on "nuxt" and "axios"',
  "nuxt-fetch": 'package.json depends on "nuxt" (no axios)',
  angular: 'package.json depends on "@angular/core"',
  csharp: "a *.sln or *.csproj file",
};

/** A fresh MCP server for one request: stateless, holds nothing between requests. */
export function createScrapiMcpServer(): McpServer {
  const server = new McpServer({ name: "scrapi", version }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "scrapi_list_targets",
    {
      title: "List ScrAPI targets",
      description:
        "Lists the framework combinations ScrAPI generates clients for, with the folder each one goes into and how to recognize a matching project.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () =>
      json({
        combinations: COMBINATIONS.map((options) => {
          const key = combinationKey(options);
          return {
            combination: key,
            label: combinationLabel(options),
            destinationRoot: resolveTarget(options).destinationRoot,
            detect: DETECTION_HINTS[key] ?? "",
          };
        }),
      }),
  );

  server.registerTool(
    "scrapi_validate",
    {
      title: "Validate an API description",
      description:
        "Validates an OpenAPI/Swagger document or GraphQL schema and lists its operations, grouped by tag (OpenAPI) or root type (GraphQL). Pass the description as source, or its public URL as url (ScrAPI's server loads it; GraphQL endpoints are introspected). Pass the same source or url and the operation ids to scrapi_generate.",
      inputSchema: validateToolInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input, ctx) => {
      const loaded = await resolveSourceText(input, ctx.mcpReq.signal);
      if (!loaded.ok) return failure(loaded.problems);
      const source = loaded.text;
      if (detectSourceKind(source) === "graphql") {
        const result = describeGraphql(source);
        if (!result.ok) return failure(result.errors);
        const byId = new Map(result.operations.map((operation) => [operation.id, operation]));
        return json({
          kind: "graphql",
          info: result.info,
          groups: result.groups.map((group) => ({
            name: group.name,
            operations: group.operationIds.flatMap((id) => {
              const operation = byId.get(id);
              return operation === undefined
                ? []
                : [compact({ id, name: operation.name, description: operation.description, requiresInput: operation.requiresInput, deprecated: operation.deprecated })];
            }),
          })),
        });
      }

      const result = await describeOpenApi(source);
      if (!result.ok) return failure(result.errors);
      const byId = new Map(result.operations.map((operation) => [operation.id, operation]));
      return json({
        kind: "openapi",
        info: result.info,
        conversions: result.conversions,
        groups: result.groups.map((group) => ({
          name: group.name,
          operations: group.operationIds.flatMap((id) => {
            const operation = byId.get(id);
            return operation === undefined
              ? []
              : [compact({ id, summary: operation.summary, operationId: operation.operationId, requiresInput: operation.requiresInput, deprecated: operation.deprecated })];
          }),
        })),
      });
    },
  );

  server.registerTool(
    "scrapi_generate",
    {
      title: "Generate typed API clients",
      description:
        "Generates typed client code for the selected operations and framework combinations. Returns each file's destination path (relative to the project root) and content, plus an integration guide in Markdown. Write the files yourself; the guide's ZIP folder paths correspond to the destination paths given here.",
      inputSchema: generateToolInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input, ctx) => {
      const result = await generateForAgent(input, ctx.mcpReq.signal);
      if (!result.ok) return failure(result.problems);
      const { guide, ...files } = result.value;
      return {
        content: [
          { type: "text", text: JSON.stringify(files) },
          { type: "text", text: guide },
        ],
      };
    },
  );

  return server;
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function failure(problems: readonly Problem[]): CallToolResult {
  const text = problems.map((problem) => `- ${problem.message}${problem.location ? ` (at ${problem.location})` : ""}`).join("\n");
  return { isError: true, content: [{ type: "text", text: `ScrAPI could not complete the request:\n${text}` }] };
}

/** Drops undefined properties so tool results stay small. */
function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
