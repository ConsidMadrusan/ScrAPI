# CLAUDE.md

Guidance for coding agents working in this repository. Read this file and `README.md` before making changes.

## Current status

Implementation has **started (Phase 1: scaffold and verification spike)**. The repository contains:

- A Next.js 16 scaffold with the code standard, tests, and npm scripts described under "Code standard and tests".
- The operation-filtering module (`src/lib/selection/filter-spec.ts`) and its tests.
- Representative sample specifications in `samples/specs/`.
- The pinned generator version in `openapitools.json`.
- The CI, AI review, and release workflows in `.github/workflows/`.

There is no `Dockerfile` yet, so the release workflow still fails if a tag is pushed. Do not assume any other script, command, folder, or package is present until you have verified it.

This project uses **Next.js 16**, which differs from older versions. Read `AGENTS.md` and the bundled docs in `node_modules/next/dist/docs/` before writing Next.js code. For example, with `cacheComponents` enabled, route files must not export `runtime` (Node.js is the default and only supported runtime).

## Project purpose

ScrAPI is a web application that turns an OpenAPI JSON specification into typed API integration code for an existing project.

It helps developers who consume HTTP APIs from .NET or TypeScript front-end projects. It removes the repetitive, error-prone work of hand-writing DTOs, enums, request/response types, and HTTP client methods, and of figuring out where those files belong in a project.

Workflow:

1. Paste an OpenAPI JSON specification or upload a `.json` file.
2. Validate it and show understandable errors.
3. Select one output target: C#/.NET, TypeScript for Next.js/React, TypeScript for Nuxt/Vue, or TypeScript for Angular.
4. Select which API operations to generate (endpoint selection).
5. Generate typed integration files with an existing deterministic generator.
6. Download a ZIP, or follow a visual step-by-step guide to add the files to an existing project manually.

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

These are **outputs**, not parts of ScrAPI's own stack: C#/.NET, framework-independent TypeScript (shared by Next.js/React and Nuxt/Vue, with different usage instructions), and an Angular client/service structure. Specific OpenAPI Generator generators and options for each target must be chosen and verified during the first implementation spike; do not assume them.

### Zod vs. OpenAPI validation

- Zod validates **ScrAPI's own** inputs (e.g. "is this a supported target?", "is this selection a list of method+path pairs?", "is the payload within size limits?").
- Zod does **not** validate the OpenAPI document against the OpenAPI standard. Use a dedicated OpenAPI validator/parser for that. Never try to recreate the OpenAPI schema in Zod.
- A Zod schema may describe the minimal envelope ScrAPI reads (e.g. presence of `openapi`, `paths`), but the dedicated validator decides whether the specification is valid.

### State management

- Prefer local React state (and lifting state up) for the linear workflow.
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
- Support OpenAPI **3.0.x** JSON only for the MVP. Reject other versions, YAML, and malformed JSON with clear errors.
- Identify operations by **HTTP method + path**, not by `operationId` (which may be missing or duplicated). `GET /users` and `POST /users` are separate operations.
- Group operations by tag with an "Other" group for untagged ones. An operation listed under several tags is still **one** selection; counts must not double-count it.
- Revalidate submitted operation selections against the specification on the server. Reject unknown operations and empty selections.
- Preserve the original specification unchanged. Filter a **separate** representation that keeps only selected operations plus everything they need: schemas referenced from parameters, request bodies, responses, headers, and composed schemas (`allOf`/`oneOf`/`anyOf`, `items`, `properties`, `additionalProperties`), transitively, together with required shared components (e.g. security schemes, shared parameters, responses, request bodies). Internal references must still resolve after filtering.
- Generate client methods only for selected operations; never drop dependencies those operations need.
- Do not resolve external references or fetch user-supplied URLs. Specifications must be self-contained; reject external `$ref` values with a clear error.
- Clear stale selections and generation results when the specification changes. Invalidate generation results when generation options (target, selection) change.
- Never expose secrets or server-only modules to client code.
- Use a **per-request temporary directory** for generator input/output and remove it after both success and failure. No persistent server-side storage of specifications or generated files.
- Enforce input-size, execution-time, and output-size limits. Kill the generator process on timeout.
- Never interpolate specification content into shell commands. Invoke approved generators with fixed arguments via safe process APIs (argument arrays, no shell). Pass the specification as a file in the temp directory.
- Keep every generated and archived file path inside the intended output directory. Reject absolute paths, `..` segments, and other unsafe archive entries.
- Keep target configuration centralized (one definition per target: generator, options, layout, destination mapping, guide template). Reuse the shared TypeScript generation path for Next.js/React and Nuxt/Vue.
- Build the ZIP and the visual guide from the **same generation result** so paths and file contents always match. Where an integration destination differs from the archive-relative path, show the mapping explicitly.
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

## Runtime and deployment

- OpenAPI Generator is written in Java. ScrAPI uses it through the npm CLI `@openapitools/openapi-generator-cli`, which downloads the generator JAR and runs it with `java`. ScrAPI contains no Java code. Java is a runtime dependency of the single Next.js application, not a separate backend.
- **Outside development, ScrAPI runs only as a Docker container.** The image contains the Next.js server, a Java runtime, and the generator. Do not add other deployment paths (serverless, static export, GitHub Pages) without user approval. Static hosting cannot work because generation needs a server.
- **Development** uses the regular Next.js dev server on the host machine. Generating code locally needs a Java runtime and the generator there too. Docker is not required for day-to-day development, but verify changes in the container before release.
- Generator installation rules:
  - Install the CLI as a regular dependency, recorded in `package.json` and the lockfile. Never run it through `npx` or `npm exec`, which can download packages on demand.
  - Pin the OpenAPI Generator version in the CLI's committed `openapitools.json` configuration. Do not rely on the CLI's default "latest" behavior, and do not invent a version. Choose and verify one during the spike.
  - Download the pinned JAR at Docker build time (and once locally during development setup). Nothing may be downloaded at request time. Treat a missing JAR at runtime as a configuration error, not a reason to fetch it.
  - Invoke the CLI from server code as a child process with fixed arguments and no shell, as described under Architecture principles.
  - Next.js standalone output does not trace a CLI that is only started as a child process, so copy the CLI package and the downloaded JAR into the runtime image explicitly.
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

There are exactly three workflows. Do not add others without user approval.

- `.github/workflows/ci.yml` runs `npm run check` on pull requests and on pushes to `main`. It needs no Java, Docker, or secrets.
- `.github/workflows/ai-review.yml` runs an advisory Claude code review on pull requests. It runs three parallel reviews (architecture, security, code quality), using prompts in `.github/ai-review/` that are read from the base branch. Each review keeps one PR comment up to date. It is development tooling, not part of the application. It is the only workflow allowed to use a secret beyond `GITHUB_TOKEN`: the repository secret `ANTHROPIC_API_KEY`. Claude gets read-only tools, and a plain shell step posts the comment.
- `.github/workflows/release-image.yml` is the release pipeline. It builds and pushes the image to `ghcr.io/<owner>/<repo>` when a `vX.Y.Z` tag is pushed, tagging `X.Y.Z`, `X.Y`, and `latest`.

Rules for the release workflow:

- It authenticates with the built-in `GITHUB_TOKEN` and minimal permissions (`contents: read`, `packages: write`). Do not add personal access tokens or other secrets.
- Keep it to checkout, Buildx setup, registry login, metadata, and build-and-push. Do not add extra jobs, registries, platforms (it builds `linux/amd64` only), signing, scanning, or deployment steps without user approval. Propose them instead.
- Use official `actions/*` and `docker/*` actions only, on major-version tags. Pinning to commit SHAs is a recommended hardening step, but only with SHAs that have been verified, never guessed.
- Do not change the image name or tag scheme without updating `README.md` to match.

## Things you must not do

- Add AI features or AI/LLM API dependencies to the application or its generation workflow. (The PR review workflow is development tooling and is allowed.)
- Add a database, authentication, billing, or unrelated features.
- Replace the chosen stack or introduce a separate backend (Express, Python, .NET, etc.).
- Add external dependencies without first explaining the need and getting user approval. Already approved: the technologies named above (Next.js, TypeScript, Tailwind CSS, shadcn/ui, Motion for React, Zod, optional Zustand) and OpenAPI Generator through the npm CLI `@openapitools/openapi-generator-cli`, plus a Java runtime in the Docker image. Also approved:
  - The OpenAPI validator `@apidevtools/swagger-parser`.
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

In scope: one specification and one target per generation, JSON input, OpenAPI 3.0.x, internal references, endpoint selection, ZIP download, and template-based visual integration guides for all four targets.

Out of scope: accounts, database, billing, saved history, collaboration, VS Code extension, Git integration, direct project import, external references, generated React hooks / Vue composables, framework-specific SSR integrations, app scaffolds, generated Zod schemas, automatic runtime response validation in generated clients, and an interactive tutorial engine.

The schedule (~20 hours over four weeks) is tight. If a required feature is at risk, raise it with the user instead of silently cutting it. See `README.md` for the roadmap, risks, and acceptance criteria.

## Language

All content is in English: documentation, UI text, code comments, and error messages.
