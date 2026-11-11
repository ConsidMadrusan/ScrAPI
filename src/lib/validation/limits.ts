/** Largest accepted specification, in UTF-8 bytes. */
export const MAX_SPEC_BYTES = 5 * 1024 * 1024;

/**
 * Deepest accepted nesting of objects and arrays in a specification. Keeps the
 * recursive walks (reference checks, validator, filtering) far from the stack limit.
 */
export const MAX_SPEC_DEPTH = 128;

/** Largest accepted request body: the specification plus options and selection. */
export const MAX_REQUEST_BYTES = MAX_SPEC_BYTES + 512 * 1024;

/** Most files one generation result may contain. */
export const MAX_OUTPUT_FILES = 2_000;

/** Largest total size of a generation result's file contents, in UTF-8 bytes. */
export const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

/**
 * Largest total size of all results combined into one ZIP, in UTF-8 bytes.
 * Kept at the single-result limit so a ZIP request needs no more memory than before.
 */
export const MAX_COMBINED_OUTPUT_BYTES = MAX_OUTPUT_BYTES;

/** Most framework combinations generated and archived together (every supported one). */
export const MAX_COMBINATIONS = 6;

/**
 * Largest accepted ZIP request: the generation results sent back for archiving.
 * Their combined output is capped at 20 MB; this leaves room for JSON escaping.
 */
export const MAX_ARCHIVE_REQUEST_BYTES = 48 * 1024 * 1024;

/** Most ZIP requests the server handles at once; further requests are rejected as busy. */
export const MAX_CONCURRENT_ARCHIVES = 2;

/**
 * Largest MCP tool result with inline file contents, in UTF-8 bytes. Kept far
 * below the ZIP limits because the whole result enters the agent's context.
 */
export const MAX_MCP_RESULT_BYTES = 2 * 1024 * 1024;

/** Most operations a single generation request may select. */
export const MAX_SELECTED_OPERATIONS = 5000;

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function formatMegabytes(bytes: number): string {
  return `${String(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
}

/**
 * Most GraphQL generations that may run at once. They run in this process
 * (GraphQL Code Generator) rather than in a JVM, so they are cheaper than
 * OpenAPI generations; further requests are rejected as busy.
 */
export const MAX_CONCURRENT_GRAPHQL_GENERATIONS = 2;

/** Most server-side URL loads (the CORS fallback) running at once; further requests are rejected as busy. */
export const MAX_CONCURRENT_URL_FETCHES = 4;

/** Most OpenAPI specifications validated at once; further requests are rejected as busy. */
export const MAX_CONCURRENT_VALIDATIONS = 4;

/** Largest accepted /api/fetch-source request: a URL and a few headers. */
export const MAX_FETCH_REQUEST_BYTES = 64 * 1024;

/** How long loading a URL may take, in the browser and in the server-side fallback alike. */
export const URL_LOAD_TIMEOUT_MS = 20_000;

/** Most redirects the server-side URL fallback follows. */
export const MAX_URL_REDIRECTS = 5;

/** How long the browser waits for the server to build and send the ZIP. */
export const ARCHIVE_REQUEST_TIMEOUT_MS = 120_000;

/** Most problems reported at once; the rest are summarized in one extra line. */
export const MAX_REPORTED_PROBLEMS = 20;

/**
 * Defaults for the OpenAPI Generator process. Each can be changed per
 * deployment with an environment variable (see `src/lib/generation/runtime-config.ts`
 * and README.md, "Self-hosting with Docker").
 */
export const DEFAULT_GENERATION_TIMEOUT_SECONDS = 60;
export const DEFAULT_MAX_CONCURRENT_GENERATIONS = 1;
export const DEFAULT_GENERATOR_MAX_HEAP_MB = 256;
