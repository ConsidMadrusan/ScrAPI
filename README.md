# ScrAPI

[![CI](https://github.com/ConsidMadrusan/ScrAPI/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ConsidMadrusan/ScrAPI/actions/workflows/ci.yml?query=branch%3Amain)
[![Release image](https://github.com/ConsidMadrusan/ScrAPI/actions/workflows/release-image.yml/badge.svg)](https://github.com/ConsidMadrusan/ScrAPI/actions/workflows/release-image.yml)
[![Latest release](https://img.shields.io/github/v/tag/ConsidMadrusan/ScrAPI?sort=semver&label=release)](https://github.com/ConsidMadrusan/ScrAPI/tags)
[![Docker image](https://img.shields.io/badge/ghcr.io-considmadrusan%2Fscrapi-2496ED?logo=docker&logoColor=white)](https://github.com/ConsidMadrusan/ScrAPI/pkgs/container/scrapi)

Turn an OpenAPI, Swagger, or GraphQL description into typed API client code for your Next.js, Nuxt, Angular, or .NET project. Choose exactly the endpoints you need, and follow a step-by-step guide that shows where every file goes.

**[Try the demo →](https://scrapi-demo.madrusan.se)**

## What it does

Consuming an HTTP API usually means writing the same code by hand: DTOs, enums, request and response types, and one client method per endpoint, then keeping it all in sync with the API. Generators can automate that, but they usually produce code for the whole API with little help on where it belongs in a real project.

ScrAPI wraps existing, deterministic generators in a focused workflow:

- **Any common API description:** OpenAPI 3.0 and 3.1, Swagger 2.0, JSON or YAML, and GraphQL schemas (SDL or introspection). Paste it, upload a file, or load it from a URL.
- **Only the endpoints you need:** select operations individually or by tag. ScrAPI keeps every model and shared component they depend on, and nothing else.
- **Code for your framework:** Next.js/React, Nuxt/Vue (with `axios` or `fetch`), Angular, and C#/.NET, several at once if you like.
- **A guide, not just files:** download one ZIP, or follow a visual step-by-step guide with the exact destination paths, dependencies, configuration, and a usage example built from your own operations.
- **Predictable and private:** no AI involved, the same input always gives the same output. ScrAPI never writes into your project and keeps nothing after a request.

## How it works

1. **Provide** an API description. It is validated right away, with errors in plain language.
2. **Select** the operations to generate.
3. **Choose** your framework combinations, and whether the code goes into an existing or a new project.
4. **Generate.** ScrAPI runs the generators on its server, one combination at a time.
5. **Implement:** download the ZIP or follow the step-by-step guide.

Read more in [How ScrAPI works](docs/how-it-works.md).

## Supported targets

| Target | HTTP client | Files go to |
| --- | --- | --- |
| TypeScript for Next.js / React | `axios` or `fetch` | `src/lib/api-client/` |
| TypeScript for Nuxt / Vue | `axios` or `fetch` | `app/lib/api-client/` |
| TypeScript for Angular | Angular `HttpClient` | `src/app/api-client/` |
| C# / .NET | `HttpClient` (generic host) | `src/ApiClient/`, next to your solution |

Each guide is verified against a project created with the framework's official CLI. See [Targets and output](docs/how-it-works.md#targets-and-output) for versions and details.

## Run it on your machine

ScrAPI runs as one Docker container with everything it needs, including the Java runtime the generator uses. With [Docker](https://docs.docker.com/get-docker/) installed:

```sh
docker run --init --read-only --tmpfs /tmp --memory 512m -p 13000:13000 ghcr.io/considmadrusan/scrapi:latest
```

Then open http://localhost:13000.

Or with Docker Compose, save this as `compose.yaml`:

```yaml
services:
  scrapi:
    image: ghcr.io/considmadrusan/scrapi:latest
    init: true
    read_only: true
    tmpfs:
      - /tmp
    mem_limit: 512m
    ports:
      - "13000:13000"
    restart: unless-stopped
```

Start it with `docker compose up -d` and stop it with `docker compose down`.

- For anything that should last, pin a release instead of `latest`, for example `ghcr.io/considmadrusan/scrapi:1.0.1`.
- Read-only with a `/tmp` tmpfs keeps the container read-only except for the temporary files of each request, and 512 MB of memory is enough for the default settings.
- The container needs no outbound network access, no volumes, and no secrets.

To build the image from source instead:

```sh
git clone https://github.com/ConsidMadrusan/ScrAPI.git
cd ScrAPI
docker build -t scrapi .
docker run --init --read-only --tmpfs /tmp --memory 512m -p 13000:13000 scrapi
```

Configuration (timeouts, concurrency, memory) and production notes are in [Self-hosting with Docker](docs/self-hosting.md).

## Use it from AI agents

ScrAPI also has an MCP endpoint (`/api/mcp`), so coding agents can run the same workflow from your editor: validate the description, pick operations, generate, and write the files into your project. Plugins are included for Claude Code, Codex, and OpenCode, and VS Code Copilot can connect directly. With a ScrAPI server running, install the Claude Code plugin with:

```sh
/plugin install scrapi --marketplace ConsidMadrusan/ScrAPI
```

The plugins connect to `http://localhost:13000/api/mcp` by default. If your server uses another port or a domain, change the URL with one command, for example `/plugin configure scrapi@scrapi` in Claude Code or `codex mcp add scrapi --url https://scrapi.example.com/api/mcp` in Codex. See [Your server's URL](docs/ai-agents.md#your-servers-url).

The endpoint and port 13000 are available from release 1.0.1. Setup for every agent is in [Use ScrAPI from AI agents](docs/ai-agents.md).

## Releases

- Every push and pull request to `main` runs the [CI workflow](.github/workflows/ci.yml): lint, typecheck, and tests.
- Pushing a version tag `vX.Y.Z` runs the [release workflow](.github/workflows/release-image.yml), which publishes `ghcr.io/considmadrusan/scrapi` tagged `X.Y.Z`, `X.Y`, and `latest` (linux/amd64).
- All versions: [tags](https://github.com/ConsidMadrusan/ScrAPI/tags) and [container images](https://github.com/ConsidMadrusan/ScrAPI/pkgs/container/scrapi).

## Development

You need Node.js (version in `.nvmrc`) and a Java runtime (11 or newer) for the generator.

```sh
npm ci                    # install dependencies
npm run setup:generator   # download the pinned OpenAPI Generator JAR once
npm run dev               # start the dev server on http://localhost:13000
npm run check             # lint, typecheck, and tests (same as CI)
```

More in [Development](docs/development.md).

## Documentation

- [How ScrAPI works](docs/how-it-works.md): workflow, endpoint selection, targets, guides, GraphQL and OpenAPI 3.1 notes, scope, and input handling.
- [Self-hosting with Docker](docs/self-hosting.md): running the image, environment variables, building, and releasing.
- [Use ScrAPI from AI agents](docs/ai-agents.md): the MCP endpoint and plugins for Claude Code, Codex, OpenCode, and VS Code.
- [Architecture and technology](docs/architecture.md): the tech stack and module boundaries.
- [Development](docs/development.md): local setup and pull request checks.
- [MVP project plan](docs/project-plan.md): roadmap, risks, acceptance criteria, and deferred features.
