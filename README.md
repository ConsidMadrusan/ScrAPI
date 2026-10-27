# ScrAPI

Generate typed API clients from OpenAPI specifications, choose exactly which endpoints you need, and get a step-by-step guide for adding the code to your existing project.

> **Status: early implementation (Phase 1).** The application is **not usable yet**. The project scaffold, code standard, tests, and CI exist; the generation workflow does not. This README describes the planned product, scope, and architecture. See [Development](#development) for what can be run today.

## The problem

Consuming an HTTP API usually means writing the same code by hand: DTOs, enums, request and response types, and one client method per endpoint, then keeping them in sync with the API. It is repetitive and error-prone, and generator tools that automate it often produce output for the whole API with little guidance on where the files belong in a real project.

ScrAPI wraps existing deterministic generators in a focused workflow: pick the endpoints you need, generate typed integration code for your target, and add it to your project with clear, accurate instructions.

## Planned user workflow

1. **Provide a specification**: paste OpenAPI JSON or upload a `.json` file.
2. **Validate**: ScrAPI checks that the input is well-formed JSON, a supported OpenAPI version (3.0.x), valid according to the OpenAPI standard, and self-contained. Errors are reported in plain language.
3. **Choose a target**: C#/.NET, TypeScript for Next.js/React, TypeScript for Nuxt/Vue, or TypeScript for Angular.
4. **Select operations**: choose which endpoints to generate.
5. **Generate**: ScrAPI runs an existing generator on the server and produces typed integration files.
6. **Integrate**: download a ZIP, or follow the visual step-by-step guide to copy the files into your project manually.

ScrAPI never writes into your project. You copy the files or extract the ZIP yourself.

## Endpoint selection

After validation, ScrAPI lists every API operation:

- Operations are grouped by tag. Untagged operations appear in an **Other** group.
- Each operation shows its HTTP method, path, and summary.
- You can select operations individually, by group, or select/clear all.
- Search filters by path, summary, or operation ID.
- Each method + path combination is a separate operation. `GET /users` and `POST /users` can be selected independently.
- An operation that belongs to several tags is one operation: selecting it in one group selects it everywhere, and the count is not inflated.
- The number of selected operations is always visible.
- At least one operation must be selected before generating.

Only selected operations get client methods. ScrAPI automatically includes the models, enums, shared configuration, and supporting dependencies those operations need, including transitively referenced schemas.

The original specification is preserved. ScrAPI filters a separate copy and keeps the references and shared components needed for valid generation. That includes references from parameters, request bodies, responses, and composed schemas (`allOf`, `oneOf`, `anyOf`), not only schemas an operation references directly.

## Targets and output

| Target | Generated client | Typical contents | Integration guide covers |
| --- | --- | --- | --- |
| C#/.NET | C# client library | Models/DTOs, enums, typed API methods, client configuration, project/dependency metadata | Adding the code to a supported .NET project layout, required package references, configuring the base URL, calling a selected method |
| TypeScript for Next.js/React | Framework-independent TypeScript client (shared with Nuxt/Vue) | Model interfaces/types, enums, typed API methods, client configuration | Placement in a supported Next.js App Router layout, configuration, calling a selected method from server or client code |
| TypeScript for Nuxt/Vue | Same framework-independent TypeScript client | Same as above | Placement in a supported Nuxt layout, configuration, calling a selected method |
| TypeScript for Angular | Angular client/service structure | Models, enums, injectable API services, configuration | Placement in a supported Angular layout, registering HTTP/client providers, injecting and calling a service |

Exact generators, options, supported framework versions, and folder layouts are decided and verified during implementation. ScrAPI will only advertise what has been tested.

ScrAPI does **not** generate UI, React hooks, Vue composables, framework-specific SSR integrations, complete app scaffolds, databases, or business logic.

## ZIP download and visual integration guide

Both delivery options are built from the **same generation result**, so file paths and contents always match.

**Download ZIP** contains the generated folder structure and integration instructions.

**Step-by-step guide** walks you through adding the generated code manually:

- The supported project setup, versions, and assumptions for the target.
- A visual folder tree showing where generated files belong.
- Numbered steps for which folders and files to create or copy. Larger outputs are grouped into logical steps, not one step per file.
- The exact destination path for each generated file, with an explicit mapping where it differs from the path in the ZIP.
- A file viewer with syntax highlighting and a copy button for each file's full contents.
- Required dependencies and configuration changes, consistent with the generated output.
- A minimal example that imports and calls one of your selected operations. Values you must supply (base URL, tokens, IDs) are clearly marked. Nothing is invented.
- Basic verification steps and common integration errors.
- Previous/next navigation and a visible step indicator.

Guides are deterministic templates per target, not AI-generated. They document one supported project layout per target and do not claim to fit every project. They separate *adding new files* from *small changes to existing configuration*, and never ask you to replace existing application files wholesale.

## What "typed generation" means

Guaranteed:

- Types are derived from the input specification, deterministically.
- The TypeScript output gives compile-time type checking for the selected operations' parameters, request bodies, and responses, as described by the specification.

Not guaranteed:

- **Precision beyond the specification.** Incomplete or unrestricted schemas (missing `type`, free-form objects, `additionalProperties: true`) cannot produce precise types. Loose input produces loose output.
- **Runtime validation.** TypeScript types are erased at runtime and do not check that a server's response matches the specification. The generated clients do not include Zod schemas or automatic runtime response validation.
- **API correctness.** If the specification does not match the real API, the generated code will not either.

## MVP scope

Included:

- One specification and one output target per generation.
- JSON input only (paste or `.json` upload).
- OpenAPI 3.0.x, explicitly documented. Other versions are rejected with a clear error until support is verified.
- Self-contained specifications with internal references (`#/components/...`).
- Endpoint selection with dependency-aware filtering.
- All four output targets.
- ZIP download and visual step-by-step integration guide.

Explicitly excluded:

- Accounts, database, billing, saved history, collaboration.
- VS Code extension, Git integration, direct project import or writing into projects.
- External file or URL references.
- YAML input, Swagger 2.0, OpenAPI 3.1 (until verified).
- Generated React hooks, Vue composables, framework-specific SSR integrations, complete app scaffolds.
- Generated Zod schemas or runtime response validation in downloaded clients.
- An interactive tutorial engine (guides are templates).
- Persistent server-side storage of uploaded specifications or generated files.
- Any AI, LLM API, or paid generation service.

## Technology stack

ScrAPI's own implementation stack, separate from the targets it generates:

| Technology | Why |
| --- | --- |
| **Next.js App Router** + **TypeScript (strict mode)** | One codebase for UI and server logic. Server Components by default, server code for validation, generation orchestration, and ZIP responses. Strict typing catches mistakes early. |
| **Tailwind CSS** | Fast, consistent styling without a custom CSS framework. |
| **shadcn/ui** | Accessible components that live in the repository and can be adapted. |
| **Motion for React** (formerly Framer Motion) | Guide step transitions and small feedback animations, free features only, respecting reduced-motion preferences. |
| **Zod** | Runtime validation of application-owned data: request payloads, generation options, operation selections. TypeScript types are inferred from the schemas. |
| **Zustand** (optional) | Used only if shared client state across specification, selection, results, and guide becomes awkward with local React state. Not used for server request state. |
| **OpenAPI Generator**, via the npm CLI `@openapitools/openapi-generator-cli` | Existing, deterministic, widely used generator covering the needed targets. Avoids building a custom generation engine. Installed as a normal npm dependency, with the generator version pinned in `openapitools.json`. |
| **Docker** | The only supported way to run ScrAPI outside development. One image contains the Next.js server, the Java runtime, and the generator. |
| **GitHub Actions + GitHub Container Registry** | Publishes the Docker image to `ghcr.io` when a version tag is pushed. |

Zod and Zustand are approved dependencies. Zustand is installed only if implementation shows it is needed. Any other dependency (for example an OpenAPI validator package, a ZIP library, or a syntax highlighter) needs explicit approval first.

### Validation responsibilities

There are two different kinds of validation:

- **Application-input validation (Zod)**: is the request well-formed? Is the target one ScrAPI supports? Is the selection a list of method + path pairs? Is the input within size limits? This protects ScrAPI's own boundaries.
- **OpenAPI specification validation (dedicated validator)**: is the document a valid OpenAPI 3.0.x specification? This uses a purpose-built OpenAPI validator. Zod is not used to reimplement the OpenAPI standard.

Client-side checks give fast feedback. Server-side validation is authoritative, and submitted operation selections are always revalidated against the specification on the server.

## Proposed architecture

A single Next.js application with clearly separated responsibilities:

- **Presentation**: workflow pages, operation selector, guide, and file viewer. Client Components only where interactivity requires them.
- **Application-input validation**: Zod schemas at every server entry point.
- **OpenAPI processing**: JSON parsing, version check, specification validation, rejection of external references.
- **Operation selection**: lists operations keyed by method + path, groups them by tag, and produces a filtered copy of the specification containing selected operations plus all transitively required components.
- **Generation orchestration**: creates a per-request temp directory, runs the generator with fixed arguments and limits, collects output, and always cleans up.
- **Target adapters**: one centralized configuration per target (generator and options, output layout, destination mapping, guide template). Next.js/React and Nuxt/Vue share the TypeScript generation path.
- **Archive handling**: builds the ZIP from the generation result, rejecting unsafe paths.
- **Integration-guide templates**: deterministic per-target templates rendered from the same generation result as the ZIP.

Operations are identified by HTTP method and path, never only by `operationId`, which may be missing or duplicated.

## Generator runtime and deployment

ScrAPI is one Next.js codebase with no Java code of its own. OpenAPI Generator, however, is written in Java. ScrAPI uses the npm CLI `@openapitools/openapi-generator-cli` at build time to download the pinned generator JAR. At request time the server runs that JAR directly with `java`. Installing through npm does **not** remove the need for Java: **a Java runtime must be present wherever generation runs.** That affects deployment:

- Generation must run in the Node.js server runtime, **not** an Edge runtime.
- ScrAPI is therefore shipped as a **Docker image** that bundles Node.js, a Java runtime, the generator, and the built app. Running that container is the only supported deployment.
- The container host must provide enough memory for the JVM, writable temporary storage, and enough request time for generation (JVM startup adds latency).
- **Static hosting such as GitHub Pages is not supported**, because generation and validation need a server. ScrAPI does not promise compatibility with serverless platforms either.
- The generator version is pinned in the committed `openapitools.json`. The JAR is downloaded when the Docker image is built, never at request time, so the running container needs no access to the generator's download source.
- Local development needs Node.js and a Java runtime on the developer's machine for the same reason.

## Self-hosting with Docker

> **Planned.** No `Dockerfile` exists and no image has been published yet. The steps below describe how self-hosting is intended to work. The exact port, environment variables, and resource recommendations will be documented here once the implementation defines them. None exist yet.

### Use a published image

Release images will be published to GitHub Container Registry as:

```
ghcr.io/considmadrusan/scrapi
```

Each release `vX.Y.Z` is tagged `X.Y.Z`, `X.Y`, and `latest`. Pin a specific version in production rather than using `latest`.

Running it will follow the usual Docker pattern: pull the image, then run one container that publishes the app's HTTP port. Recommended options:

- `--init`, so the server receives shutdown signals cleanly.
- `--read-only` with a tmpfs mounted on `/tmp`. ScrAPI writes nothing permanent, and generation only needs temporary space.
- A memory limit that leaves room for the JVM used by the generator.

The image runs as a non-root user and stores no specifications or generated files after a request completes, so it needs no volumes.

New GHCR packages are private by default. To allow anonymous `docker pull`, the repository owner must make the package public in its GitHub package settings.

### Build the image yourself

Once a `Dockerfile` exists, the image can be built from the repository root with a standard `docker build`. No build arguments or secrets are planned.

### Release process

Images are published by `.github/workflows/release-image.yml`. Pushing a tag like `v1.2.3` builds the image from the root `Dockerfile` and pushes it to `ghcr.io` using the repository's built-in `GITHUB_TOKEN`. There is one workflow with no extra secrets, and only `linux/amd64` images are built. Until a `Dockerfile` exists, the workflow will fail if a tag is pushed.

## Input handling and temporary files

- Specifications are accepted as pasted JSON or an uploaded `.json` file, within a documented size limit.
- Only internal references are allowed. ScrAPI never resolves external references or fetches user-supplied URLs.
- Specification content is never interpolated into shell commands. The generator is invoked with fixed arguments through safe process APIs, and the specification is passed as a file.
- Each generation uses its own temporary directory, which is deleted after success **and** after failure.
- Execution time and output size are limited. A generator that exceeds the limit is stopped.
- Generated file paths must stay inside the output directory. Unsafe archive paths are rejected.
- Nothing is stored after the request completes: no saved specifications, no saved output.
- Specification contents, generated code, and credentials are never logged.
- Errors are actionable and do not expose stack traces or server details.

## Proposed roadmap (four weeks, ~20 hours)

This is a **tight MVP schedule, not a guaranteed delivery estimate**. Endpoint selection and the visual integration guide are required, and supporting both across four targets leaves little slack. The plan front-loads the riskiest work: generator output, operation filtering, and real integration examples.

| Week | Focus | Est. hours |
| --- | --- | --- |
| 1 | **Verification spike.** Run OpenAPI Generator through its npm CLI from a Node.js server context, and choose the generator version to pin. Pick generators and options for each target. Generate from representative specs and compile the output in minimal sample projects (.NET, Next.js, Nuxt, Angular). Prototype reference-preserving operation filtering and confirm filtered specs still generate. Confirm the generator runs inside a container with Node.js and a Java runtime. Scaffold the Next.js app. | ~6 |
| 2 | **Input and selection.** Paste/upload, JSON parsing, Zod input schemas, OpenAPI validation, version and external-reference checks, clear errors. Operation list grouped by tag, search, individual/group/all selection, counts, server-side revalidation, finished filtering. | ~5 |
| 3 | **Generation and ZIP.** Centralized target configuration, generation orchestration with temp-dir lifecycle and limits, path safety, ZIP response, invalidation of stale results. | ~4 |
| 4 | **Guides and acceptance.** Per-target guide templates, folder tree, file viewer with copy, path mapping, usage examples from selected operations, verification and common errors, navigation. Finish the `Dockerfile` and `.dockerignore`, and publish a first tagged image. Run the acceptance criteria against sample projects. Update this README with real setup instructions. | ~5 |
| | **Total** | **~20** |

Optional polish that can be deferred if time runs short (without dropping required features): animations beyond basic step transitions, drag-and-drop upload (a file input is enough), visual refinements to the folder tree, search-match highlighting, dark mode, and extra sample specifications beyond the representative set.

## Delivery risks

- **Reference filtering.** Keeping exactly the components selected operations need, across parameters, request bodies, responses, headers, composed schemas, and nested references, is easy to get subtly wrong. Missing a component breaks generation; over-including is safer but noisier.
- **Generator compatibility.** Generator output quality, naming (especially for missing or duplicate `operationId`s, or operations with several tags), dependencies, and compile success vary by target and option. A target might need configuration changes or post-processing that takes longer than planned.
- **Accurate integration guides.** Guides must match the actual generated files, dependencies, and method signatures for four targets. Usage examples depend on generated naming, which must be derived from the output rather than guessed.
- **Runtime and hosting.** The Java dependency, JVM startup time, memory, and temporary storage limit where ScrAPI can run. Packaging the generator and a Java runtime into a small, non-root Docker image adds work to an already tight budget.
- **Time budget.** ~20 hours for four targets plus selection and guides leaves very little buffer. Scope changes need explicit agreement.

## Acceptance criteria (completed MVP)

- [ ] Each advertised target generates successfully and produces usable typed output.
- [ ] Generated output compiles in representative sample projects for each target.
- [ ] Clear errors for malformed JSON, invalid specifications, unsupported versions, unsupported external references, and invalid generation options.
- [ ] Individual, group, and select-all/clear-all operation selection work with consistent counts, including operations with several tags.
- [ ] Methods sharing a path (e.g. `GET /users` and `POST /users`) can be selected independently.
- [ ] Methods for unselected operations are absent from generated clients.
- [ ] Required transitive schemas and shared dependencies are included.
- [ ] Internal references still resolve after filtering.
- [ ] The ZIP has the correct folder structure.
- [ ] File contents in the ZIP and the guide match.
- [ ] Guide paths, dependency instructions, and usage examples are accurate.
- [ ] A developer can integrate the output by following the guide in each supported sample project.
- [ ] Temporary files are cleaned up after both successful and failed generation.
- [ ] The application's generation workflow has no AI dependency.
- [ ] The Docker image builds from the repository root, runs as a non-root user, and generates output for every target inside the container.
- [ ] Pushing a version tag publishes the image to `ghcr.io` through the release workflow.

## Deferred features

- OpenAPI 3.1 and Swagger 2.0 support (after verification).
- YAML input.
- External file and URL references.
- Generating several targets or specifications at once.
- Generated React hooks, Vue composables, and framework-specific SSR integrations.
- Generated Zod schemas or runtime response validation.
- Accounts, saved history, collaboration, and sharing.
- VS Code extension, Git integration, and direct project import.
- An interactive tutorial engine.

## Development

Requirements: Node.js (version in `.nvmrc`) and, for running the generator, a Java runtime (Java 11 or newer; verified with 17 and 21).

```sh
npm ci                    # install dependencies from the lockfile
npm run setup:generator   # download the pinned OpenAPI Generator JAR once
npm run dev               # start the Next.js dev server
npm run check             # lint, typecheck, and tests (same as CI)
```

The generation workflow is not implemented yet, so `npm run dev` only shows a placeholder page. Docker run commands will be added with the `Dockerfile`. Running ScrAPI outside development uses the Docker image (see [Self-hosting with Docker](#self-hosting-with-docker)).

### Pull request checks

- **CI** (`.github/workflows/ci.yml`) runs `npm run check` on every pull request and on pushes to `main`.
- **AI code review** (`.github/workflows/ai-review.yml`) posts three advisory review comments (architecture, security, code quality) on pull requests and updates them on each push. It uses Claude through `anthropics/claude-code-action` and is development tooling only; the application itself uses no AI. Setup: add the repository secret `ANTHROPIC_API_KEY`. Drafts and pull requests from forks are skipped. The review prompts live in `.github/ai-review/` and are read from the base branch, so changes to them take effect after they are merged.
