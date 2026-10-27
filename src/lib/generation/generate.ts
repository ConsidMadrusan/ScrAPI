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

/**
 * Most generator processes (JVMs) running at once in this server process.
 * Each JVM defaults to a maximum heap of a quarter of the container memory,
 * so two runs plus the Node.js server fit the documented memory limit.
 */
export const MAX_CONCURRENT_GENERATIONS = 2;

/** Process-wide resource counter, not request state: it holds no request data. */
let activeGenerations = 0;

export type GenerateResult =
  | { ok: true; value: GenerateSuccess }
  | { ok: false; status: number; errors: Problem[] };

/**
 * Generates the client for a prepared request in a per-request temporary
 * folder, which is removed afterwards whether generation succeeds or fails.
 * Rejects the request with 503 when the concurrency limit is reached, and
 * stops the generator when `signal` aborts.
 */
export async function generateClient(
  prepared: PreparedGeneration,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
    return failure(
      503,
      "generator-busy",
      "The server is busy generating other clients. Try again in a moment.",
    );
  }
  activeGenerations += 1;
  try {
    return await generateInTempDir(prepared, signal);
  } finally {
    activeGenerations -= 1;
  }
}

async function generateInTempDir(
  prepared: PreparedGeneration,
  signal: AbortSignal | undefined,
): Promise<GenerateResult> {
  const target = resolveTarget(prepared.options);
  const startedAt = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), "scrapi-"));

  try {
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
