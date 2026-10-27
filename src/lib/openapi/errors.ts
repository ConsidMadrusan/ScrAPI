export type SpecErrorCode =
  | "empty"
  | "too-large"
  | "too-deep"
  | "not-json"
  | "yaml"
  | "not-object"
  | "swagger-2"
  | "missing-version"
  | "unsupported-version"
  | "external-ref"
  | "unsupported-ref"
  | "unresolved-ref"
  | "invalid-spec"
  | "duplicate-operation-id"
  | "no-operations"
  | "validator-busy";

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

/**
 * HTTP status for a failed validation: 503 when the server was too busy to
 * validate (the specification itself may be fine), otherwise 422.
 */
export function specFailureStatus(errors: readonly { code: string }[]): 422 | 503 {
  return errors.some((error) => error.code === "validator-busy") ? 503 : 422;
}

/** Formats JSON pointer segments for display, e.g. `paths › /users › get`. */
export function formatLocation(segments: readonly string[]): string {
  return segments.join(" › ");
}

/** Splits a JSON pointer such as `/paths/~1users/get` into segments. */
export function pointerSegments(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}
