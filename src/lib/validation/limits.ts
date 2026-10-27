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
 * Largest accepted ZIP request: a generation result sent back for archiving.
 * Generated output is capped at 20 MB; this leaves room for JSON escaping.
 */
export const MAX_ARCHIVE_REQUEST_BYTES = 48 * 1024 * 1024;

/** Most ZIP requests the server handles at once; further requests are rejected as busy. */
export const MAX_CONCURRENT_ARCHIVES = 2;

/** Most operations a single generation request may select. */
export const MAX_SELECTED_OPERATIONS = 5000;

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function formatMegabytes(bytes: number): string {
  return `${String(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
}
