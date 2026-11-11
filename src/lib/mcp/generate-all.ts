import "server-only";

import { checkArchivableAll } from "@/lib/archive/result-zip";
import { generateClient } from "@/lib/generation/generate";
import { isGeneratorBusy } from "@/lib/generation/java-generator";
import { prepareGeneration } from "@/lib/generation/prepare";
import { generateGraphqlClient } from "@/lib/graphql/generate";
import { renderChainedGuide } from "@/lib/guides/chained";
import { renderGuideMarkdown } from "@/lib/guides/markdown";
import { describeGraphql, describeOpenApi } from "@/lib/source/describe";
import { detectSourceKind, type SourceKind } from "@/lib/source-kind";
import { combinationKey, combinationLabel, COMBINATIONS } from "@/lib/targets/catalog";
import { formatMegabytes, MAX_MCP_RESULT_BYTES, utf8ByteLength } from "@/lib/validation/limits";
import { listSome, type Problem } from "@/lib/validation/problems";
import type { GenerationOptions, ProjectMode } from "@/lib/validation/requests";
import type { GenerateSuccess, GraphqlOperation, OperationSummary } from "@/lib/validation/responses";
import type { GenerateToolInput } from "./schemas";

/** One generated combination, with each file at its path in the supported project layout. */
export interface McpCombinationResult {
  combination: string;
  label: string;
  destinationRoot: string;
  files: { destinationPath: string; content: string }[];
}

export interface McpCombinationFailure {
  combination: string;
  label: string;
  problems: Problem[];
}

export interface McpGenerateOutput {
  kind: SourceKind;
  project: ProjectMode;
  results: McpCombinationResult[];
  failures: McpCombinationFailure[];
  /** The integration guide (INTEGRATION.md) rendered from the same results. */
  guide: string;
}

export type McpGenerateResult = { ok: true; value: McpGenerateOutput } | { ok: false; problems: Problem[] };

/** A described source with its operation ids and the text generation reads. */
export type Described =
  | { kind: "openapi"; spec: string; operations: Pick<OperationSummary, "id" | "method" | "path">[] }
  | { kind: "graphql"; schema: string; operations: Pick<GraphqlOperation, "id" | "operationType" | "field">[] };

/**
 * Generates every requested combination one at a time, like the web workflow,
 * and renders one guide from the successful results. A failed combination is
 * reported next to the successful ones instead of failing the whole run.
 */
export async function generateForAgent(input: GenerateToolInput, signal?: AbortSignal): Promise<McpGenerateResult> {
  const described = await describe(input.source);
  if (!described.ok) return described;

  const selected = resolveIds(described.value, input);
  if (!selected.ok) return selected;

  const requested = new Set<string>(input.combinations);
  const combinations = COMBINATIONS.filter((options) => requested.has(combinationKey(options)));

  const successes: GenerateSuccess[] = [];
  const failures: McpCombinationFailure[] = [];
  for (const options of combinations) {
    if (signal?.aborted === true) break;
    const outcome = await generateOne(described.value, selected.ids, options, signal);
    if (outcome.ok) successes.push(outcome.value);
    else failures.push({ combination: combinationKey(options), label: combinationLabel(options), problems: outcome.problems });
  }

  if (successes.length === 0) {
    return { ok: false, problems: failures.flatMap((failure) => failure.problems.map((problem) => prefixed(failure.label, problem))) };
  }

  const rejection = checkArchivableAll(successes);
  if (rejection !== undefined) return { ok: false, problems: [rejection.problem] };

  const output: McpGenerateOutput = {
    kind: described.value.kind,
    project: input.project,
    results: successes.map((result) => ({
      combination: combinationKey(result.options),
      label: combinationLabel(result.options),
      destinationRoot: result.destinationRoot,
      files: result.files.map((file) => ({ destinationPath: file.destinationPath, content: file.content })),
    })),
    failures,
    guide: renderGuideMarkdown(renderChainedGuide(successes, input.project)),
  };

  if (utf8ByteLength(JSON.stringify(output)) > MAX_MCP_RESULT_BYTES) {
    return {
      ok: false,
      problems: [
        {
          code: "result-too-large",
          message: `The generated files are larger than ${formatMegabytes(MAX_MCP_RESULT_BYTES)}, too much to return to an agent at once. Select fewer operations or framework combinations, or download the ZIP from the ScrAPI web app.`,
        },
      ],
    };
  }
  return { ok: true, value: output };
}

async function describe(source: string): Promise<{ ok: true; value: Described } | { ok: false; problems: Problem[] }> {
  if (detectSourceKind(source) === "graphql") {
    const result = describeGraphql(source);
    if (!result.ok) return { ok: false, problems: result.errors };
    return { ok: true, value: { kind: "graphql", schema: result.schema, operations: result.operations } };
  }
  const result = await describeOpenApi(source);
  if (!result.ok) return { ok: false, problems: result.errors };
  return { ok: true, value: { kind: "openapi", spec: result.spec, operations: result.operations } };
}

/**
 * Matches the agent's operation ids against the validated operations. Ids
 * are compared after normalizing spacing and the case of the first word
 * (`get /users` → `GET /users`, `Query books` → `query books`).
 */
export function resolveIds(
  described: Described,
  input: Pick<GenerateToolInput, "operations" | "allOperations">,
): { ok: true; ids: Set<string> } | { ok: false; problems: Problem[] } {
  const known = new Set(described.operations.map((operation) => operation.id));
  if (input.allOperations === true) return { ok: true, ids: known };

  const requested = new Set((input.operations ?? []).map((id) => normalizeId(described.kind, id)));
  if (requested.size === 0) {
    return { ok: false, problems: [{ code: "empty-selection", message: "Select at least one operation." }] };
  }
  const unknown = [...requested].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      problems: [
        {
          code: "unknown-operations",
          message: `These operations are not in the API description: ${listSome(unknown)}. Use the ids that scrapi_validate lists.`,
        },
      ],
    };
  }
  return { ok: true, ids: requested };
}

function normalizeId(kind: SourceKind, id: string): string {
  const [first = "", ...rest] = id.trim().split(/\s+/);
  const head = kind === "openapi" ? first.toUpperCase() : first.toLowerCase();
  return [head, ...rest].join(" ");
}

async function generateOne(
  described: Described,
  ids: ReadonlySet<string>,
  options: GenerationOptions,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; value: GenerateSuccess } | { ok: false; problems: Problem[] }> {
  try {
    if (described.kind === "graphql") {
      const selection = described.operations
        .filter((operation) => ids.has(operation.id))
        .map(({ operationType, field }) => ({ operationType, field }));
      const result = await generateGraphqlClient({ schema: described.schema, options, selection });
      return result.ok ? result : { ok: false, problems: result.errors };
    }

    if (isGeneratorBusy()) {
      return {
        ok: false,
        problems: [{ code: "generator-busy", message: "The server is busy generating other clients. Try again in a moment." }],
      };
    }
    const selection = described.operations
      .filter((operation) => ids.has(operation.id))
      .map(({ method, path }) => ({ method, path }));
    const prepared = await prepareGeneration({ spec: described.spec, options, selection });
    if (!prepared.ok) return { ok: false, problems: prepared.errors };
    const result = await generateClient(prepared.value, signal);
    return result.ok ? result : { ok: false, problems: result.errors };
  } catch (error) {
    console.error("MCP generation crashed", { error: error instanceof Error ? error.name : typeof error });
    return { ok: false, problems: [{ code: "internal", message: "Something went wrong while generating. Try again." }] };
  }
}

function prefixed(label: string, problem: Problem): Problem {
  return { ...problem, message: `${label}: ${problem.message}` };
}
