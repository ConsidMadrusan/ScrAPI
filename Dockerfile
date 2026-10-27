# ScrAPI: one image with the Next.js server, a Java runtime, and the pinned
# OpenAPI Generator JAR. See README.md ("Self-hosting with Docker").

# Node.js (same major version as .nvmrc) plus the Java runtime the generator needs.
FROM node:22.23.4-trixie-slim AS node-java
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-21-jre-headless \
 && rm -rf /var/lib/apt/lists/*

# Dependencies from the lockfile only, so this layer is cached until they change.
FROM node:22.23.4-trixie-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Download the generator JAR at the version pinned in openapitools.json.
# The CLI runs the JAR once to check it, so this stage needs Java.
FROM node-java AS generator
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json openapitools.json ./
RUN npm run setup:generator

# Build the standalone Next.js server.
FROM deps AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# Runtime: only what runs. No build tools, sources, or package caches.
FROM node-java AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY generator-templates ./generator-templates
# Same relative path as in development; the server resolves it from its working directory.
COPY --from=generator /app/node_modules/@openapitools/openapi-generator-cli/versions/ ./node_modules/@openapitools/openapi-generator-cli/versions/

USER node
EXPOSE 3000
CMD ["node", "server.js"]
