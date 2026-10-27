import "server-only";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTarget, type TargetConfig } from "@/lib/targets/config";
import type { Problem } from "@/lib/validation/problems";
import type { GeneratedFile, GenerateSuccess } from "@/lib/validation/responses";
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
 * Stops the generator when `signal` aborts. The `/api/generate` route limits
 * how many requests reach this at once (MAX_CONCURRENT_GENERATIONS).
 */
export async function generateClient(
  prepared: PreparedGeneration,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const target = resolveTarget(prepared.options);
  return withTempDir((workDir) => runAndCollect(prepared, target, workDir, signal));
}

/**
 * Runs `fn` in a new per-request temporary folder and removes the folder
 * afterwards. A failed removal is logged but does not replace `fn`'s result.
 */
export async function withTempDir<T>(fn: (workDir: string) => Promise<T>): Promise<T> {
  const workDir = await mkdtemp(join(tmpdir(), "scrapi-"));
  try {
    return await fn(workDir);
  } finally {
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch (error) {
      // Error type only: the path and message are server details.
      console.error("Could not remove the generation folder", {
        error: error instanceof Error ? error.name : typeof error,
      });
    }
  }
}

/** Writes the generator input, runs the generator, and collects its output. */
async function runAndCollect(
  prepared: PreparedGeneration,
  target: TargetConfig,
  workDir: string,
  signal: AbortSignal | undefined,
): Promise<GenerateResult> {
  const startedAt = Date.now();
  const specPath = join(workDir, "spec.json");
  const outputDir = join(workDir, "output");
  await writeFile(specPath, JSON.stringify(keepFirstTagOnly(prepared.filteredSpec)), "utf8");

  const outcome = await runGenerator({
    settings: target.generator,
    specPath,
    outputDir,
    ...(signal === undefined ? {} : { signal }),
  });
  if (outcome.status !== "ok") {
    // Metadata only: never the specification or generated code.
    console.warn("Generation failed", {
      target: prepared.options.target,
      status: outcome.status,
      durationMs: Date.now() - startedAt,
    });
    return generatorFailure(outcome);
  }

  let files: GeneratedFile[];
  try {
    files = await collectOutput(outputDir, target);
  } catch (error) {
    if (error instanceof OutputLimitError) {
      return failure(
        422,
        "output-too-large",
        "The generated code is too large. Select fewer operations and try again.",
      );
    }
    throw error;
  }
  if (files.length === 0) {
    console.error("Generation produced no files", { target: prepared.options.target });
    return failure(500, "generation-failed", "The generator produced no files for this selection.");
  }
  return toSuccess(prepared, target, files);
}

function toSuccess(
  prepared: PreparedGeneration,
  target: TargetConfig,
  files: GeneratedFile[],
): GenerateResult {
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
    case "aborted":
      return failure(499, "generation-cancelled", "Generation was cancelled.");
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
