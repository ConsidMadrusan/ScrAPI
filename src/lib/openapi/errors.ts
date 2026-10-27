export type SpecErrorCode =
  | "empty"
  | "too-large"
  | "not-json"
  | "yaml"
  | "not-object"
  | "too-deep"
  | "swagger-2"
  | "missing-version"
  | "unsupported-version"
  | "external-ref"
  | "unsupported-ref"
  | "unresolved-ref"
  | "too-many-references"
  | "invalid-spec"
  | "duplicate-operation-id"
  | "no-operations";

/** A problem with the submitted specification, safe to show to the user. */
export interface SpecError {
  code: SpecErrorCode;
  message: string;
  /** Where in the document, e.g. `paths › /users › get`. */
  location?: string;
}

export type SpecResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: SpecError[] };

/** Formats JSON pointer segments for display, e.g. `paths › /users › get`. */
export function formatLocation(segments: readonly string[]): string {
  return segments.join(" › ");
}
