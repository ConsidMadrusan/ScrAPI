import "server-only";

import type { JsonObject } from "@/lib/openapi/json";
import { validateSpecification } from "@/lib/openapi/validate";
import { filterSpec, SpecFilterError } from "@/lib/selection/filter-spec";
import { resolveSelection, type OperationSummary } from "@/lib/selection/operations";
import type { Problem } from "@/lib/validation/problems";
import type { GenerateRequest, GenerationOptions } from "@/lib/validation/requests";

export interface PreparedGeneration {
  options: GenerationOptions;
  /** Selected operations, once each, in document order. */
  selected: OperationSummary[];
  /** Separate copy with only the selected operations and their dependencies. */
  filteredSpec: JsonObject;
}

export type PrepareResult =
  | { ok: true; value: PreparedGeneration }
  | { ok: false; errors: Problem[] };

/**
 * Server-side revalidation of a generation request: the specification is
 * validated again and the selection is checked against it. Client-side
 * checks are never trusted.
 */
export async function prepareGeneration(request: GenerateRequest): Promise<PrepareResult> {
  const validated = await validateSpecification(request.spec);
  if (!validated.ok) return validated;
  const { document, operations } = validated.value;

  const selection = resolveSelection(operations, request.selection);
  if (!selection.ok) {
    return {
      ok: false,
      errors: [
        selection.reason === "empty"
          ? { code: "empty-selection", message: "Select at least one operation." }
          : {
              code: "unknown-operations",
              message: `These operations are not in the specification: ${selection.unknownIds.join(", ")}.`,
            },
      ],
    };
  }

  try {
    const filteredSpec = filterSpec(document, selection.selected);
    return {
      ok: true,
      value: { options: request.options, selected: selection.selected, filteredSpec },
    };
  } catch (error) {
    if (error instanceof SpecFilterError) {
      return { ok: false, errors: [{ code: "invalid-spec", message: error.message }] };
    }
    throw error;
  }
}
