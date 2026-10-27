/** Largest accepted specification, in UTF-8 bytes. */
export const MAX_SPEC_BYTES = 5 * 1024 * 1024;

/** Largest accepted request body: the specification plus options and selection. */
export const MAX_REQUEST_BYTES = MAX_SPEC_BYTES + 512 * 1024;

/** Most operations a single generation request may select. */
export const MAX_SELECTED_OPERATIONS = 5000;

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function formatMegabytes(bytes: number): string {
  return `${String(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
}
