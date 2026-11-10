import { MAX_REPORTED_PROBLEMS } from "@/lib/validation/limits";

export type SpecErrorCode =
  | "empty"
  | "too-large"
  | "too-deep"
  | "not-json"
  | "yaml"
  | "invalid-yaml"
  | "swagger-conversion-failed"
  | "not-object"
  | "swagger-2"
  | "json-schema"
  | "missing-version"
  | "invalid-version"
  | "unsupported-version"
  | "external-ref"
  | "unsupported-ref"
  | "unresolved-ref"
  | "unsupported-keyword"
  | "invalid-spec"
  | "duplicate-operation-id"
  | "unknown-security-scheme"
  | "no-operations"
  | "not-introspection"
  | "invalid-schema"
  | "validator-busy"
  | "more-problems";

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

/**
 * At most MAX_REPORTED_PROBLEMS problems, plus one line that says how many
 * more there are. `total` is the full count when the caller stopped
 * collecting early; it defaults to the number of problems given.
 */
export function capProblems(problems: readonly SpecError[], total: number = problems.length): SpecError[] {
  if (total <= MAX_REPORTED_PROBLEMS) return [...problems];
  const shown = problems.slice(0, MAX_REPORTED_PROBLEMS);
  const more = total - shown.length;
  return [
    ...shown,
    {
      code: "more-problems",
      message: `…and ${String(more)} more ${more === 1 ? "problem" : "problems"}. Fix the ones above and check again.`,
    },
  ];
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
