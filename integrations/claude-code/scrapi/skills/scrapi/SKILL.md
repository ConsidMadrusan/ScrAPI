---
name: scrapi
description: Generate typed API client code (DTOs, enums, request/response types, HTTP client methods) from an OpenAPI 3.0/3.1 or Swagger 2.0 document or a GraphQL schema, and add it to a Next.js, Nuxt, Angular, or C#/.NET project, using the ScrAPI MCP tools. Use when the user wants an API client, typed models, or SDK generated from an API description, spec, swagger file, or GraphQL schema.
---

# ScrAPI: typed API clients from an API description

ScrAPI generates client code with deterministic generators (OpenAPI Generator, GraphQL Code Generator) through three MCP tools: `scrapi_list_targets`, `scrapi_validate`, and `scrapi_generate`. ScrAPI never writes files. You write the returned files into the project and follow the guide.

If the tools are missing or fail to connect, the ScrAPI server is not reachable. Tell the user to start it (`docker run --init --read-only --tmpfs /tmp --memory 512m -p 13000:13000 ghcr.io/considmadrusan/scrapi:<version>`) or, if it already runs elsewhere, to set its MCP URL (the server's address plus `/api/mcp`):

- Claude Code: `/plugin configure scrapi@scrapi`, then restart.
- Codex: `codex mcp add scrapi --url <url>`, then restart.
- OpenCode or VS Code: change `url` for `scrapi` in `opencode.json` or `.vscode/mcp.json`.

Do not write client code by hand instead.

## Workflow

1. **Find the API description.** Use the file or URL the user names, or look for one in the repository (`openapi.json`, `openapi.yaml`, `swagger.json`, `*.graphql`, `schema.json`). Read a URL yourself and pass its text; the tools take the description's contents, not a URL. If there is none, ask.

2. **Choose the framework combination(s).** Call `scrapi_list_targets` and match the project against each combination's `detect` hint:
   - `package.json` with `next` → `nextjs-axios` if `axios` is a dependency, otherwise `nextjs-fetch`.
   - `package.json` with `nuxt` → `nuxt-axios` or `nuxt-fetch`, the same way.
   - `package.json` with `@angular/core` → `angular`.
   - A `*.sln` or `*.csproj` → `csharp`.
   - A monorepo can need several. When nothing matches or the choice is ambiguous, ask the user.

3. **Validate and choose operations.** Call `scrapi_validate` with the description text. On an error, show the user the messages; they describe what is wrong in the description. Otherwise summarize the groups (tags, or Queries/Mutations). Unless the user already said which operations they need, ask them, or confirm before using all of them. Use the exact operation ids from the result (`GET /users/{id}`, `query books`).

4. **Generate.** Call `scrapi_generate` with the same `source`, the `combinations`, and either `operations` (ids) or `allOperations: true`. Set `project` to `"new"` only when the user is creating a new project; the default `"existing"` adds the client to the current one.
   - The first text block is JSON: `results` (one per combination, with `destinationRoot` and `files`) and `failures` (combinations that failed, with their problems; report them, the others are still usable).
   - The second text block is the integration guide in Markdown. It refers to ZIP folders such as `nextjs-axios/api-client/`; each file's `destinationPath` already gives its place in the project.
   - If the result is too large, generate fewer operations or one combination at a time.

5. **Write the files.** Write each file's `content` to its `destinationPath`, relative to the project root (for C#, next to the solution). If the destination folder (`api-client/`, `ApiClient/`) already exists, ask before replacing it, and replace that folder only. Do not edit or delete unrelated files.

6. **Follow the guide.** Apply its remaining steps: install the listed packages, add the project reference or registration code, and make the small edits it shows to existing configuration. Never replace an existing application file wholesale. Values in the guide's placeholders (base URL, tokens, credentials) are for the user to supply: leave them clearly marked and tell the user. Never invent credentials or endpoints.

7. **Verify.** Run the project's type check or build: `npx tsc --noEmit` (Next.js), `npx nuxi typecheck` (Nuxt), `npx ng build` (Angular), or `dotnet build` (C#). Report the result. If it fails because of the generated code, show the error; do not rewrite generated files by hand.

## Notes

- Regenerate instead of editing generated files; they are overwritten on the next run.
- GraphQL subscriptions are not generated. For C#, the GraphQL client is built by StrawberryShake during the user's `dotnet build`.
- The description must be self-contained: external `$ref`s are rejected.
