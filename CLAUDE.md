# CLAUDE.md

Guidance for coding agents working in this repository. Read this file and `README.md` before making changes.

## Current status

The **MVP is implemented** (all four phases). Release is pending: no version tag has been pushed. The repository contains:

- The full flow from API description to ZIP download:
  - input from paste, upload, or a URL loaded **in the browser** (`src/components/workflow/fetch-source.ts`; GraphQL endpoints by introspection)
  - OpenAPI validation (`src/lib/openapi/`), including YAML and Swagger 2.0 conversion (`normalize.ts`)
  - GraphQL schema parsing, root-field listing, operation building, and generation (`src/lib/graphql/`)
  - operation listing, grouping, and filtering (`src/lib/selection/`)
  - target configuration (`src/lib/targets/`)
  - generation (`src/lib/generation/`)
  - ZIP building (`src/lib/archive/`)
  - the `/api/validate`, `/api/generate` (one framework combination per request), `/api/graphql/validate`, `/api/graphql/generate`, and `/api/archive` (one ZIP built on the server from all results of a generation run, one folder per combination) Route Handlers
  - the workflow UI: one route per stage in `src/app/(workflow)/` (`/`, `/select`, `/targets`, `/generating`, `/implement` as a landing screen for ZIP download or guide, and `/implement/guide` for the one-step-at-a-time guide), screens in `src/components/workflow/`, and shared state in a React context provider (`workflow-context.tsx`) mounted by the route group layout
- Integration guides: deterministic templates in `src/lib/guides/` (`render.ts` for OpenAPI, `render-graphql.ts` for GraphQL, shared steps in `common.ts`), chained into one guide for all combinations (`chained.ts`), rendered in the UI (`src/components/guide/`) and as `INTEGRATION.md` in the ZIP, both from the same generation results.
- The `typescript-fetch` and `typescript-axios` template overrides in `generator-templates/`.
- Sample specifications in `samples/specs/`, and shared test fixtures in `src/test/`.
- The root `Dockerfile` and `.dockerignore`, and the CI and release workflows in `.github/workflows/`.

Do not assume any other script, command, folder, or package is present until you have verified it.

This project uses **Next.js 16**, which differs from older versions. Read `AGENTS.md` and the bundled docs in `node_modules/next/dist/docs/` before writing Next.js code. For example, with `cacheComponents` enabled, route files must not export `runtime` (Node.js is the default and only supported runtime).

## Project purpose

ScrAPI is a web application that turns an API description (an OpenAPI or Swagger document, or a GraphQL schema) into typed API integration code for an existing project.

It helps developers who consume HTTP APIs from .NET or TypeScript front-end projects. It removes the repetitive, error-prone work of hand-writing DTOs, enums, request/response types, and HTTP client methods, and of figuring out where those files belong in a project.

Workflow:

1. Paste, upload, or load from a URL an OpenAPI 3.0/3.1 or Swagger 2.0 document (JSON or YAML) or a GraphQL schema (SDL or introspection JSON; a GraphQL URL is introspected). URLs are loaded by the browser, never by ScrAPI's server. Input is validated immediately (typed input uses a "Continue" button) with understandable errors; a valid description opens the next stage.
2. Select which API operations to generate (endpoint selection: HTTP operations, or GraphQL Query/Mutation root fields), then press "Next".
3. Choose whether the code goes into an existing project or a new one, and select one or more framework combinations: C#/.NET, TypeScript for Next.js/React or Nuxt/Vue (each with the `axios` and/or `fetch` HTTP client), or TypeScript for Angular. The project choice changes only the guide (and `INTEGRATION.md`), never the generated files.
4. Generate typed integration files with an existing deterministic generator, one combination at a time, behind a loading screen.
5. On the implementation landing screen, download one ZIP with every combination (the card then shows it was downloaded), or open the visual step-by-step guide: one step at a time with Back/Next, covering every combination in turn. Failed combinations are listed with a retry; the successful ones remain usable.

ScrAPI generates API integration code only: no UI, databases, or business logic. It never writes into the user's project. The application uses **no AI, LLM APIs, or paid generation services**.

## Technology stack and rationale

### Implementation stack (what ScrAPI is built with)

| Technology | Purpose |
| --- | --- |
| Next.js App Router, TypeScript (strict mode) | One codebase for UI and server work. Server Components by default; Route Handlers / server code for validation, generation orchestration, and ZIP responses. Strict mode catches typing mistakes early. |
| Tailwind CSS | Utility styling without a custom CSS framework. |
| shadcn/ui | Accessible, owned UI components (copied into the repo, not a black-box library). |
| Motion for React (formerly Framer Motion) | Step transitions and small feedback animations. Free features only. Must honor reduced-motion preferences. |
| Zod | Runtime validation of application-owned data boundaries: request payloads, generation options, operation selections, target identifiers, and similar contracts. TypeScript types are inferred from these schemas where appropriate. |
| Zustand (optional) | Only if shared client state becomes awkward with local React state. Not installed by default. |
| OpenAPI Generator, via the npm CLI `@openapitools/openapi-generator-cli` | Existing deterministic generator for all targets, installed as a regular npm dependency. The CLI is a Node.js wrapper that downloads and runs the OpenAPI Generator JAR, so it needs a Java runtime on the server. |
| Docker | The single way to run ScrAPI outside development. One image bundles the Next.js server, the Java runtime, and the generator, so every deployment has the same runtime. |
| GitHub Actions + GitHub Container Registry (ghcr.io) | Builds and publishes the Docker image on version tags. |

### Generated output targets (what ScrAPI produces)

These are **outputs**, not parts of ScrAPI's own stack: C#/.NET, framework-independent TypeScript (shared by Next.js/React and Nuxt/Vue, with different usage instructions), and an Angular client/service structure.

Verified in the Phase 1 spike with OpenAPI Generator 7.26.0:

| Target | Generator | Verified against |
| --- | --- | --- |
| C#/.NET | `csharp`, library `generichost`, `nullableReferenceTypes=true` | `dotnet build` with .NET 10 (`net10.0`), no warnings |
| TypeScript for Next.js/React and Nuxt/Vue: HTTP client chosen by the user | `typescript-axios` (default; `supportsES6`, `withSeparateModelsAndApi`, `apiPackage=api`, `modelPackage=model`, plus the `modelIndex.mustache` override in `generator-templates/typescript-axios/`) or `typescript-fetch` (`supportsES6`, plus the `runtime.ts` override in `generator-templates/typescript-fetch/`) | `tsc` with Next.js 16 defaults and with Nuxt 4.6 defaults, for both clients. Without the override, `typescript-fetch` fails Nuxt's `noUncheckedIndexedAccess` and `noImplicitOverride`. When the pinned generator version changes, re-check the override against the new upstream template. |
| TypeScript for Angular | `typescript-angular` (`ngVersion` default 22.0.0) | `tsc` 6.0 with Angular 22 strict workspace defaults |

Rules for preparing generator input:

- The generator rejects duplicate `operationId`s. ScrAPI rejects such specifications during validation with a clear error.
- Operations with several tags produce duplicate exports in TypeScript output. The generator's copy of the specification keeps only each operation's **first** tag, and the guide reflects that class placement. The original specification is unchanged.
- OpenAPI 3.1 (the generator marks it beta) needs four lossless rewrites, verified with 7.26.0; re-check them when the pinned version changes:
  - `webhooks` are removed (`filter-spec.ts`); otherwise `typescript-fetch` emits a `DefaultApi` that does not compile.
  - Path items referenced from `components.pathItems` are inlined (`filter-spec.ts`); otherwise the generator silently drops their operations.
  - Scalar `const` becomes a one-value `enum` (`generator-input.ts`); otherwise every target types it as `any` / `Object?`.
  - Operations without `responses` (optional in 3.1) get `default: { description: "Default response" }` (`generator-input.ts`), also in callbacks and reusable path items; otherwise the generator's own spec check fails the whole run.
- The guide finds generated methods with regular expressions over the generated files (`src/lib/guides/usage.ts` for OpenAPI, including the generator's method name for operations without an `operationId`; `render-graphql.ts` for GraphQL). Re-check them when the pinned generator or GraphQL Code Generator versions change; when they no longer match, the guide shows no example instead of guessing.
- `typescript-axios` uses the `modelIndex.mustache` override in `generator-templates/typescript-axios/`: when a selection uses no models, upstream writes an empty `model/index.ts`, which is not a module, so the package index fails to compile (TS2306). Re-check it against the upstream template when the pinned version changes.
- Verified for 3.1 with `samples/specs/todo-3.1.json` (type lists, `const`, `$defs`, `$ref` siblings, numeric `exclusiveMinimum`, `components.pathItems`, webhooks) plus `prefixItems`, `if`/`then`/`else`, and multi-type lists: all six combinations generated in the Docker image and built in projects created with the "new project" commands below (`npx tsc --noEmit` + `npm run build`, `nuxi typecheck` + build, `ng build`, `dotnet build`). `prefixItems` is typed loosely and `if`/`then`/`else` is ignored. `$id`, `$anchor`, `$dynamicRef`, and `$dynamicAnchor` are rejected during validation (not verified).

Accepted input formats (verified like the targets above):

- **OpenAPI 3.0.x and 3.1.x**, JSON or YAML.
- **Swagger 2.0**, JSON or YAML: converted to OpenAPI 3.0 on the server with `@scalar/openapi-upgrader` (`upgrade(document, "3.0")`, pure, no network), then handled like 3.0. Verified with `samples/specs/todo-swagger2.json` for all six combinations.
- **YAML** is parsed with `yaml` (core schema, no custom tags, unique keys, at most 100 aliases).
- The server returns the converted OpenAPI JSON (`ValidateSuccess.spec`) and the client generates from it; the user's input stays unchanged.

### GraphQL targets (what ScrAPI produces from a GraphQL schema)

GraphQL has no endpoints, so ScrAPI builds one operation per selected Query or Mutation root field (`src/lib/graphql/build-operations.ts`): all arguments become variables, and the selection has the scalar and enum fields of the result two levels deep (interfaces and unions with `__typename` and inline fragments; nested fields that need arguments are skipped). Operations are named after the field in PascalCase (`books` → `Books`); a mutation that collides with a query gets a `Mutation` suffix. Subscriptions are not generated. Every built operation is validated against the schema. Verified with `samples/specs/books.graphql` in projects created with the "new project" commands below:

| Target | Generator | Verified against |
| --- | --- | --- |
| TypeScript (Next.js, Nuxt, Angular) | GraphQL Code Generator, in-process: `@graphql-codegen/core` 6.2.2 with `typescript-operations` 6.2.0 and `typescript-generic-sdk` 5.0.1, `graphql` 16.14.2. Config: `documentMode: "documentNode"`, `dedupeOperationSuffix`, custom scalars → `unknown`. Not the `typescript` plugin: in 6.x `typescript-operations` emits the enums and inputs itself, and both together declare them twice. | Output `graphql.ts` (typed `getSdk(requester)`) + `operations.graphql`. The guide's requester (fetch, axios, or Angular `HttpClient` with `print()` from `graphql`): `npx tsc --noEmit` + `npm run build` (Next.js, both clients), `nuxi typecheck` + build (Nuxt, both clients), `ng build` plus `tsc` over all `src/` files (Angular). |
| C#/.NET | StrawberryShake.Server 16.7.5, run by the **user's** `dotnet build` (no .NET SDK in the image). ScrAPI writes `ApiClient.csproj`, `.graphqlrc.json` (`name: GraphQLClient`, `namespace: ApiClient`), `schema.graphql`, `schema.extensions.graphql`, and `Operations.graphql` (`src/lib/graphql/csharp-project.ts`). | `dotnet build` of a `dotnet new webapi` solution that references the project, registers `AddGraphQLClient().ConfigureHttpClient(...)`, and calls `client.Books.ExecuteAsync(genre: null, first: null, ct)`: 0 errors. `ExecuteAsync` takes every variable as a parameter; unknown custom scalars become `string`. |

GraphQL results use the same ZIP folders and destinations as the OpenAPI targets (`api-client/`, `ApiClient/`). In Vitest, `@graphql-codegen` and `@graphql-tools` are inlined (`vitest.config.mts`) so they share the tests' copy of `graphql`; two copies make graphql-js reject schemas "from another realm". The Next.js bundle has one copy.

Supported destination layouts (the paths are set in `src/lib/targets/config.ts`):

| Target | ZIP folder | Project destination |
| --- | --- | --- |
| Next.js (App Router, `src/` directory) | `api-client/` | `src/lib/api-client/` |
| Nuxt 4 (`app/` directory) | `api-client/` | `app/lib/api-client/` |
| Angular (Angular CLI workspace) | `api-client/` | `src/app/api-client/` |
| C#/.NET | `ApiClient/` (`ApiClient.csproj`, namespace `ApiClient`) | `src/ApiClient/`, next to the solution |

In the downloaded ZIP, each combination's folder sits inside a folder named by its combination key, for example `nextjs-axios/api-client/` or `csharp/ApiClient/`, next to one root `INTEGRATION.md`.

Only the client source files are kept. Generator scaffolding (READMEs, docs, tests, solution files, CI files, `git_push.sh`, `.openapi-generator/`) is left out. C# files named after generic types lose the .NET arity suffix (``ApiResponse`1.cs`` → `ApiResponse.cs`, `dropGenericArity` in `src/lib/targets/config.ts`) unless that would clash with another file; SDK-style projects include every `.cs` file, so names do not affect the build.

"New project" guides start with the official CLI commands that create the supported layout. They were verified (project created, guide followed, framework build run) with: `npx create-next-app@16` (16.4.5), `npx create-nuxt@4` (4.0.3, Nuxt 4.6), `npx @angular/cli@22 new --defaults` (22.2), and `dotnet new sln` + `dotnet new webapi -f net10.0` (SDK 10.0.301). Re-verify when changing these commands or versions.

Do not claim other generators, options, or framework versions without verifying them the same way.

### Zod vs. OpenAPI validation

- Zod validates **ScrAPI's own** inputs (e.g. "is this a supported target?", "is this selection a list of method+path pairs?", "is the payload within size limits?").
- Zod does **not** validate the OpenAPI document or the GraphQL schema against their standards. GraphQL schemas are validated with `graphql` (`buildSchema` / `buildClientSchema` + `validateSchema`).
- Zod does **not** validate the OpenAPI document against the OpenAPI standard. Use a dedicated OpenAPI validator/parser for that. Never try to recreate the OpenAPI schema in Zod.
- The specification is checked against the official OpenAPI JSON Schema for its version, vendored in `src/lib/openapi/schemas/` and never fetched at runtime (`src/lib/openapi/schema-check.ts`): 3.0 revision 2024-10-18 with `ajv-draft-04`, 3.1 revision 2026-08-03 with `ajv/dist/2020`. The 3.1 schema's `$dynamicRef`s are rewritten to plain `$ref`s in memory because of an Ajv bug (as swagger-parser does). swagger-parser then resolves references; its own schema check (older revisions) is turned off.
- A Zod schema may describe the minimal envelope ScrAPI reads (e.g. presence of `openapi`, `paths`), but the dedicated validator decides whether the specification is valid.

### State management

- Prefer local React state (and lifting state up) for the linear workflow. The workflow stages share state through a React context provider in the `(workflow)` route group layout, which persists across client navigation. Nothing is persisted: reloading a later stage redirects to the start.
- Introduce Zustand only when sharing state across specification input, operation selection, generation result, and guide becomes awkward locally (e.g. deep prop drilling across unrelated subtrees). Keep any store small and focused.
- Never use Zustand (or any shared module-level store) for server-side request state.

## Architecture principles

Keep these concerns in separate modules with explicit interfaces:

- **Presentation** – pages, components, guide UI, file viewer.
- **Application-input validation** – Zod schemas for request payloads and options.
- **OpenAPI processing** – parsing, version check, specification validation, internal reference checks.
- **Operation selection** – listing operations, grouping by tag, filtering a separate specification representation.
- **Generation orchestration** – temp directory lifecycle, generator invocation, limits, output collection.
- **Target adapters** – per-target generator configuration, file layout, destination mapping.
- **Archive handling** – building the ZIP from a generation result.
- **Integration-guide templates** – deterministic per-target templates rendered from a generation result.

Rules:

- Keep generation and filesystem work on the server. Generation runs in the **Node.js runtime**, never the Edge runtime.
- Use Server Components by default; use Client Components only where interactivity requires them.
- Keep I/O (filesystem, child processes) behind clear server-side boundaries. Mark server-only modules so they cannot be imported by client code.
- Write small, focused functions with explicit types. No mutable global request state.
- Validate all untrusted input at system boundaries. Client-side validation improves feedback; **server-side validation is authoritative**.
- Use Zod for application-owned input contracts and infer types from the schemas where appropriate. Use a suitable OpenAPI validator for the specification itself.
- Support OpenAPI **3.0.x and 3.1.x** and Swagger **2.0**, in JSON or YAML, and GraphQL schemas (SDL or introspection JSON). Reject other versions (OpenAPI 3.2 included: OpenAPI Generator 7.26.0 cannot read it) and malformed input with clear errors. Accept a new format or version only after verifying it end to end like 3.1.
- Identify operations by **HTTP method + path**, not by `operationId` (which may be missing or duplicated). `GET /users` and `POST /users` are separate operations.
- Group operations by tag with an "Other" group for untagged ones. An operation listed under several tags is still **one** selection; counts must not double-count it.
- Revalidate submitted operation selections against the specification on the server. Reject unknown operations and empty selections.
- Preserve the original specification unchanged. Filter a **separate** representation that keeps only selected operations plus everything they need: schemas referenced from parameters, request bodies, responses, headers, and composed schemas (`allOf`/`oneOf`/`anyOf`, `items`, `properties`, `additionalProperties`), transitively, together with required shared components (e.g. security schemes, shared parameters, responses, request bodies). Internal references must still resolve after filtering.
- Generate client methods only for selected operations; never drop dependencies those operations need.
- **URLs are loaded by the browser first** (`src/components/workflow/fetch-source.ts`: http/https only, no credentials in the URL, `credentials: "omit"`, a time limit, and the specification size limit). Only when the browser cannot read the URL (a network or CORS error) does it ask **`/api/fetch-source`**, which loads it on the server (`src/lib/source/fetch-url.ts`) under these SSRF rules. Keep them when changing that code:
  - Two fixed requests only: GET a document, or POST the standard introspection query built on the server. Never accept a method, body, or arbitrary forwarding from the request.
  - Public addresses only: every resolved address is checked at connect time (custom `lookup`, so DNS rebinding cannot swap it), IP literals and `localhost`/`.local`/`.internal` names before connecting, and again after every redirect (at most 5). `SCRAPI_ALLOW_PRIVATE_URLS=true` (documented in README) is the only way to allow private and local networks.
  - User headers are forwarded, but ScrAPI-controlled headers (`Host`, `Content-Type`, `Content-Length`, encoding, hop-by-hop) cannot be set, and header values cannot contain line breaks.
  - 20-second timeout, 5 MB body limit, `accept-encoding: identity`, at most 4 loads at once. Never log or store the URL, headers, or body.
- Do not resolve external references. Specifications must be self-contained; reject external `$ref` values with a clear error, also after a Swagger 2.0 conversion.
- Clear stale selections and generation results when the specification changes. Invalidate generation results when generation options (target, selection) change.
- Never expose secrets or server-only modules to client code.
- Use a **per-request temporary directory** for generator input/output and remove it after both success and failure. No persistent server-side storage of specifications or generated files.
- Enforce input-size, execution-time, and output-size limits. Kill the generator process on timeout.
- Never interpolate specification content into shell commands. Invoke approved generators with fixed arguments via safe process APIs (argument arrays, no shell). Pass the specification as a file in the temp directory.
- Keep every generated and archived file path inside the intended output directory. Reject absolute paths, `..` segments, and other unsafe archive entries.
- Keep target configuration centralized (one definition per target: generator, options, layout, destination mapping, guide template). Reuse the shared TypeScript generation path for Next.js/React and Nuxt/Vue.
- Build the ZIP and the visual guide from the **same generation results** so paths and file contents always match. Each combination's files go in a ZIP folder named by its combination key (`combinationKey` in `src/lib/targets/catalog.ts`), derived on the server, never taken from the request. Where an integration destination differs from the archive-relative path, show the mapping explicitly.
- Usage examples must be derived from a selected operation and the actual generated method signatures. Never invent endpoints, fields, or credentials; clearly mark values the user must supply.
- Guides document a supported project layout per target, distinguish adding new files from small edits to existing configuration, and never instruct users to replace existing application files wholesale. Group file-copying into logical steps rather than one step per file.
- Return actionable errors without stack traces or sensitive server details.
- Honor reduced-motion preferences and keep all interaction keyboard accessible.
- Verify generated output with representative specifications and appropriate compilation checks (e.g. `tsc` for TypeScript targets, a .NET build for C#) in sample projects.

Describe and respect these boundaries; do not pre-create folders or files that are not needed for the current task.

## Code standard and tests

The code standard is enforced by tooling. Run `npm run check` (lint, typecheck, tests) before committing; CI runs the same command.

| Script | What it does |
| --- | --- |
| `npm run lint` | ESLint with zero warnings allowed (`eslint.config.mjs`). |
| `npm run typecheck` | `next typegen` + `tsc --noEmit`. |
| `npm run test` / `npm run test:watch` | Vitest unit and component tests. |
| `npm run check` | All of the above, in order. |
| `npm run setup:generator` | Downloads the pinned OpenAPI Generator JAR (once per machine). |

- **ESLint:**
  - The Next.js `core-web-vitals` and `typescript` configs, plus `typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked`.
  - No `any`, no non-null assertions (`!`), and type-only imports via `import type`.
  - No floating or misused promises, and exhaustive `switch` statements.
  - `no-console` everywhere, except `console.warn` and `console.error` in `src/lib/**` and `src/app/api/**`. Never log content.
  - `src/components/**` and `src/app/**/page.tsx` must not import filesystem or child-process modules, `@/lib/generation`, or `@/lib/openapi/validate`.
- **TypeScript:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`.
- **Tests:**
  - Tests live next to the code they cover as `*.test.ts` or `*.test.tsx`.
  - Library code runs in the `node` environment. Component tests start with `// @vitest-environment jsdom` and use Testing Library with `user-event`, querying by role and accessible name.
  - Test fixtures come from `samples/specs/`.
  - Each phase adds tests for the code it introduces, and those tests must pass before the phase is complete.
- **Node.js:** use the version in `.nvmrc`. CI and the Docker image use the same version.
- **Lockfile:** `npm install <pkg>` with an existing lockfile has been seen to drop other platforms' optional binaries (npm/cli#4828), for example `@rolldown/binding-*` or `fsevents`. That breaks `npm ci` in CI. After adding a dependency, check that `grep -c '"node_modules/@rolldown/binding-' package-lock.json` is not 0. If it is, regenerate the lockfile: `rm -rf node_modules package-lock.json && npm install`, then `npm run setup:generator`.

## Runtime and deployment

- OpenAPI Generator is written in Java. ScrAPI uses it through the npm CLI `@openapitools/openapi-generator-cli`, which downloads the generator JAR and runs it with `java`. ScrAPI contains no Java code. Java is a runtime dependency of the single Next.js application, not a separate backend.
- **Outside development, ScrAPI runs only as a Docker container.** The image contains the Next.js server, a Java runtime, and the generator. Do not add other deployment paths (serverless, static export, GitHub Pages) without user approval. Static hosting cannot work because generation needs a server.
- **Development** uses the regular Next.js dev server on the host machine. Generating code locally needs a Java runtime and the generator there too. Docker is not required for day-to-day development, but verify changes in the container before release.
- Generator installation rules:
  - Install the CLI as a regular dependency, recorded in `package.json` and the lockfile. Never run it through `npx` or `npm exec`, which can download packages on demand.
  - Pin the OpenAPI Generator version in the CLI's committed `openapitools.json` configuration. Do not rely on the CLI's default "latest" behavior, and do not invent a version. Choose and verify one during the spike.
  - Download the pinned JAR at Docker build time (and once locally during development setup). Nothing may be downloaded at request time. Treat a missing JAR at runtime as a configuration error, not a reason to fetch it.
  - The npm CLI is a **build-time tool only**: it downloads the pinned JAR (`npm run setup:generator`, and in the Docker build stage). At request time, server code runs the JAR directly as `java -jar <pinned jar> generate …`. It runs as a child process with fixed arguments and no shell, as described under Architecture principles. This keeps the CLI's dependencies, which `npm audit` flags in its download code, out of the runtime image.
  - Next.js standalone output does not trace the JAR, so copy the pinned JAR into the runtime image explicitly. The CLI package is not needed at runtime.
- Generator runtime limits (timeout, concurrent JVMs, heap) default to values that fit a 512 MB container and can be changed with the environment variables documented in README.md (`src/lib/generation/runtime-config.ts`). Other limits are constants in `src/lib/validation/limits.ts`.
- The container host must provide enough memory for the JVM, writable temporary storage, and enough request time for generation. Verify this early.

## Docker rules

Follow Docker best practices, and keep the image and the pipeline as simple as possible.

Image:

- One `Dockerfile` at the repository root, building one image that runs one process (the Next.js server). No docker-compose, sidecars, or extra services unless the user approves them.
- Use a multi-stage build: install dependencies, build the app, then copy only what is needed into a small runtime stage. Prefer Next.js standalone output so the runtime stage does not need the full `node_modules`.
- Use official base images with explicit version tags, never `latest`. Do not invent versions; choose and verify them during implementation.
- The runtime stage contains only what runs: Node.js, a Java **runtime** (not a full JDK, unless the generator needs it), the generator, and the built app. No build tools, compilers, or package caches.
- Order layers for caching: copy the lockfile and install dependencies before copying source code. Use the lockfile for reproducible installs.
- Run as a non-root user. The app must work with a read-only root filesystem when a writable temp directory (e.g. a tmpfs on `/tmp`) is mounted. Generation temp directories go under the OS temp directory only.
- Never put secrets, `.env` files, or credentials in the image or in build arguments. Configuration comes from runtime environment variables. Document every variable in `README.md` when it is introduced, and do not invent any before then.
- Keep a `.dockerignore` (added with the `Dockerfile`) that excludes at least `.git`, `node_modules`, `.next`, local `.env*` files, coverage, logs, and generation artifacts.
- Expose a single HTTP port, log to stdout/stderr, and shut down cleanly on `SIGTERM`. Recommend `docker run --init` in docs rather than adding an init dependency to the image.
- Fetch the generator JAR only in a build stage, at the version pinned in `openapitools.json`. The runtime container must start without network access to the generator's download source.

Pipeline:

There are exactly two workflows. Do not add others without user approval.

- `.github/workflows/ci.yml` runs `npm run check` on pull requests and on pushes to `main`. It needs no Java, Docker, or secrets.
- `.github/workflows/release-image.yml` is the release pipeline. It builds and pushes the image to `ghcr.io/<owner>/<repo>` when a `vX.Y.Z` tag is pushed, tagging `X.Y.Z`, `X.Y`, and `latest`.

Rules for the release workflow:

- It authenticates with the built-in `GITHUB_TOKEN` and minimal permissions (`contents: read`, `packages: write`). Do not add personal access tokens or other secrets.
- Keep it to checkout, Buildx setup, registry login, metadata, and build-and-push. Do not add extra jobs, registries, platforms (it builds `linux/amd64` only), signing, scanning, or deployment steps without user approval. Propose them instead.
- Use official `actions/*` and `docker/*` actions only, on major-version tags. Pinning to commit SHAs is a recommended hardening step, but only with SHAs that have been verified, never guessed.
- Do not change the image name or tag scheme without updating `README.md` to match.

## Things you must not do

- Add AI features or AI/LLM API dependencies to the application or its generation workflow.
- Add a database, authentication, billing, or unrelated features.
- Replace the chosen stack or introduce a separate backend (Express, Python, .NET, etc.).
- Add external dependencies without first explaining the need and getting user approval. Already approved: the technologies named above (Next.js, TypeScript, Tailwind CSS, shadcn/ui, Motion for React, Zod, optional Zustand) and OpenAPI Generator through the npm CLI `@openapitools/openapi-generator-cli`, plus a Java runtime in the Docker image. Also approved:
  - The OpenAPI validator `@apidevtools/swagger-parser`.
  - `ajv` and `ajv-draft-04`, which run the official OpenAPI JSON Schemas (both were already installed through swagger-parser).
  - `yaml` (YAML input) and `@scalar/openapi-upgrader` (Swagger 2.0 → OpenAPI 3.0).
  - `graphql`, `@graphql-codegen/core`, `@graphql-codegen/typescript-operations`, and `@graphql-codegen/typescript-generic-sdk` (GraphQL schemas and TypeScript clients). StrawberryShake is not a dependency of ScrAPI: the generated C# project references it, and the user's build restores it.
  - `server-only`, which marks server modules.
  - A ZIP library (`jszip`, not yet installed).
  - The packages shadcn/ui installs for its components.
  - The dev tools Vitest, `@vitejs/plugin-react`, `jsdom`, Testing Library (`react`, `dom`, `user-event`, `jest-dom`), and `typescript-eslint`.

  Everything else (e.g. a syntax highlighter) requires approval.
- Build a custom code-generation engine when an existing generator can satisfy the requirement.
- Claim support for untested frameworks, versions, specification features, or deployment environments.
- Use `any` to bypass typing problems. Represent genuinely unconstrained data honestly (e.g. `unknown`) and narrow it.
- Treat TypeScript types as runtime validation.
- Use Zod as a substitute for full OpenAPI specification validation.
- Introduce Zustand unnecessarily or store server-side request state in a shared store.
- Generate methods for unselected operations or remove dependencies required by selected operations.
- Write guide instructions independently of the generated output.
- Add paid-only UI or animation features.
- Persist uploaded specifications or generated code on the server beyond the generation lifecycle.
- Log specification contents, generated code, or credentials.
- Expand the MVP or drop required features without user approval.
- Modify unrelated files.
- Invent package versions, scripts, environment variables, or setup commands, or claim that dependencies are installed.
- Run ScrAPI outside development in any way other than the Docker image, or complicate the Docker build or release pipeline beyond the rules above without approval.

## MVP scope reminders

In scope: one API description and one or more framework combinations per generation; paste, upload, or a URL loaded in the browser; OpenAPI 3.0.x and 3.1.x and Swagger 2.0 in JSON or YAML; GraphQL schemas (SDL, introspection JSON, or introspection of a URL) with Query and Mutation operations; internal references, endpoint selection, ZIP download, and template-based visual integration guides for all four targets.

Out of scope: accounts, database, billing, saved history, collaboration, VS Code extension, Git integration, direct project import, external references, server-side loading of private or local URLs on public deployments, GraphQL subscriptions and hand-written GraphQL documents, generated React hooks / Vue composables, framework-specific SSR integrations, app scaffolds generated by ScrAPI (the "new project" guide only shows official CLI commands), generated Zod schemas, automatic runtime response validation in generated clients, and an interactive tutorial engine.

The schedule (~20 hours over four weeks) is tight. If a required feature is at risk, raise it with the user instead of silently cutting it. See `README.md` for the roadmap, risks, and acceptance criteria.

## Language

All content is in English: documentation, UI text, code comments, and error messages.
