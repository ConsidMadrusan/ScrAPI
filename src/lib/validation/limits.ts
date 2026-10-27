/** Largest accepted specification, in UTF-8 bytes. */
export const MAX_SPEC_BYTES = 5 * 1024 * 1024;

/** Largest accepted request body: the specification plus options and selection. */
export const MAX_REQUEST_BYTES = MAX_SPEC_BYTES + 512 * 1024;

/**
 * Longest time a request body may take to arrive, in milliseconds. Routes
 * read the body while holding a concurrency slot, so this bounds how long a
 * slowly sending client can keep a slot. It allows a body of
 * MAX_REQUEST_BYTES at roughly 200 KB/s.
 */
export const MAX_BODY_READ_MS = 30_000;

/** Most operations a single generation request may select. */
export const MAX_SELECTED_OPERATIONS = 5000;

/**
 * Most generation requests handled at once in this server process, from
 * reading the body to the end of generation. Each generator JVM defaults to a
 * maximum heap of a quarter of the container memory, so two runs plus the
 * Node.js server fit the documented memory limit.
 */
export const MAX_CONCURRENT_GENERATIONS = 2;

/**
 * Most validation requests handled at once in this server process. Each one
 * holds a specification of up to MAX_SPEC_BYTES, its parsed form, and the
 * validator's dereferenced copy in memory.
 */
export const MAX_CONCURRENT_VALIDATIONS = 4;

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function formatMegabytes(bytes: number): string {
  return `${String(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
}
