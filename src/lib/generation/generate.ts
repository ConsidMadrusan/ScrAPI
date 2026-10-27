import "server-only";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTarget } from "@/lib/targets/config";
import type { Problem } from "@/lib/validation/problems";
import type { GenerateSuccess } from "@/lib/validation/responses";
import { collectOutput, OutputLimitError } from "./collect-output";
import { keepFirstTagOnly } from "./generator-input";
import { runGenerator, type GeneratorOutcome } from "./java-generator";
import type { PreparedGeneration } from "./prepare";

export type GenerateResult =
  | { ok: true; value: GenerateSuccess }
  | { ok: false; status: number; errors: Problem[] };

/**
 * Generates the client for a prepared request in a per-request temporary
 * folder, which is removed afterwards whether generation succeeds or fails.
 */
export async function generateClient(prepared: PreparedGeneration): Promise<GenerateResult> {
  const target = resolveTarget(prepared.options);
  const startedAt = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), "scrapi-"));

  try {
    const specPath = join(workDir, "spec.json");
    const outputDir = join(workDir, "output");
    await writeFile(specPath, JSON.stringify(keepFirstTagOnly(prepared.filteredSpec)), "utf8");

    const outcome = await runGenerator({ settings: target.generator, specPath, outputDir });
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
        options: prepared.options,
        archiveRoot: target.archiveRoot,
        destinationRoot: target.destinationRoot,
        operations: prepared.selected,
        files,
      },
    };
  } catch (error) {
    if (error instanceof OutputLimitError) {
      return failure(
        422,
        "output-too-large",
        "The generated code is too large. Select fewer operations and try again.",
      );
    }
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
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
    case "failed":
      return failure(
        422,
        "generation-failed",
        "The generator could not process this specification and selection.",
      );
    case "unavailable":
      console.error("Code generator is not available", { reason: outcome.reason });
      return failure(503, "generator-unavailable", "Code generation is not available on this server right now.");
  }
}

function failure(status: number, code: string, message: string): Extract<GenerateResult, { ok: false }> {
  return { ok: false, status, errors: [{ code, message }] };
}
