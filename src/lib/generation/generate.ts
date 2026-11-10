import "server-only";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTarget } from "@/lib/targets/config";
import type { Problem } from "@/lib/validation/problems";
import type { OpenApiGenerateSuccess } from "@/lib/validation/responses";
import { collectOutput, OutputLimitError } from "./collect-output";
import { prepareGeneratorInput } from "./generator-input";
import { runGenerator, type GeneratorOutcome } from "./java-generator";
import type { PreparedGeneration } from "./prepare";

export type GenerateResult =
  | { ok: true; value: OpenApiGenerateSuccess }
  | { ok: false; status: number; errors: Problem[] };

/**
 * Generates the client for a prepared request in a per-request temporary
 * folder, which is removed afterwards whether generation succeeds or fails.
 */
export async function generateClient(
  prepared: PreparedGeneration,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const target = resolveTarget(prepared.options);
  const startedAt = Date.now();
  let workDir: string;
  try {
    workDir = await mkdtemp(join(tmpdir(), "scrapi-"));
  } catch (error) {
    return tempStorageFailure(error);
  }

  try {
    const specPath = join(workDir, "spec.json");
    const outputDir = join(workDir, "output");
    try {
      await writeFile(specPath, JSON.stringify(prepareGeneratorInput(prepared.filteredSpec)), "utf8");
    } catch (error) {
      return tempStorageFailure(error);
    }

    const outcome = await runGenerator({ settings: target.generator, specPath, outputDir, signal });
    if (outcome.status !== "ok") {
      // Metadata only: never the specification or generated code.
      console.warn("Generation failed", {
        target: prepared.options.target,
        status: outcome.status,
        durationMs: Date.now() - startedAt,
      });
      return generatorFailure(outcome);
    }

    const files = await collectOutput(outputDir, target);
    if (files.length === 0) {
      console.error("Generation produced no files", { target: prepared.options.target });
      return failure(500, "generation-failed", "The generator produced no files for this selection.");
    }

    return {
      ok: true,
      value: {
        ok: true,
        kind: "openapi",
        options: prepared.options,
        archiveRoot: target.archiveRoot,
        destinationRoot: target.destinationRoot,
        operations: prepared.selected,
        files,
      },
    };
  } catch (error) {
    if (error instanceof OutputLimitError) return outputTooLarge();
    throw error;
  } finally {
    // A failed cleanup must not replace the result; the OS temp folder is cleared eventually.
    await rm(workDir, { recursive: true, force: true }).catch((error: unknown) => {
      console.warn("Temp folder cleanup failed", { code: errorCode(error) });
    });
  }
}

/** The OS temp folder is missing, read-only, or full: a server problem, not the user's. */
function tempStorageFailure(error: unknown): Extract<GenerateResult, { ok: false }> {
  // The error code only: messages contain temp paths.
  console.error("Temp storage unavailable", { code: errorCode(error) });
  return failure(
    503,
    "temp-storage-unavailable",
    "The server could not create temporary files for generation. Try again later.",
  );
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown";
}

function generatorFailure(
  outcome: Exclude<GeneratorOutcome, { status: "ok" }>,
): Extract<GenerateResult, { ok: false }> {
  switch (outcome.status) {
    case "timeout":
      return failure(
        422,
        "generation-timeout",
        "Generation took too long and was stopped. Select fewer operations and try again.",
      );
    case "output-too-large":
      return outputTooLarge();
    case "failed":
      return failure(
        422,
        "generation-failed",
        "The generator could not process this specification and selection.",
      );
    case "busy":
      return failure(503, "generator-busy", "The server is busy generating other clients. Try again in a moment.");
    case "aborted":
      // The client has disconnected, so nobody reads this response.
      return failure(503, "generation-aborted", "Generation was cancelled.");
    case "unavailable":
      console.error("Code generator is not available", { reason: outcome.reason, code: outcome.code });
      return failure(503, "generator-unavailable", "Code generation is not available on this server right now.");
  }
}

function outputTooLarge(): Extract<GenerateResult, { ok: false }> {
  return failure(422, "output-too-large", "The generated code is too large. Select fewer operations and try again.");
}

function failure(status: number, code: string, message: string): Extract<GenerateResult, { ok: false }> {
  return { ok: false, status, errors: [{ code, message }] };
}
