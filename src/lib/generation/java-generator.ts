import "server-only";

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { GLOBAL_PROPERTIES, type GeneratorSettings } from "@/lib/targets/config";
import generatorConfig from "../../../openapitools.json";

/** Generation normally takes about a second; this allows for large specifications. */
export const GENERATION_TIMEOUT_MS = 60_000;

const pinnedVersion = z
  .object({ "generator-cli": z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) }) })
  .parse(generatorConfig)["generator-cli"].version;

/**
 * The JAR downloaded by `npm run setup:generator` (and copied to the same
 * relative path in the Docker image). Nothing is downloaded at request time.
 */
export function generatorJarPath(): string {
  return join(
    process.cwd(),
    "node_modules/@openapitools/openapi-generator-cli/versions",
    `${pinnedVersion}.jar`,
  );
}

export interface GeneratorRun {
  settings: GeneratorSettings;
  specPath: string;
  outputDir: string;
  timeoutMs?: number;
  /** Aborts the run, e.g. when the client disconnects. The process is killed. */
  signal?: AbortSignal;
  /**
   * Polled while the generator runs. When it resolves to true, the process is
   * killed, so oversized output stops growing before the run would end.
   */
  exceedsOutputLimit?: () => Promise<boolean>;
  outputCheckIntervalMs?: number;
}

/** How often `exceedsOutputLimit` is polled by default. */
export const OUTPUT_CHECK_INTERVAL_MS = 250;

export type GeneratorOutcome =
  | { status: "ok" }
  | { status: "failed"; exitCode: number | null }
  | { status: "timeout" }
  | { status: "output-too-large" }
  | { status: "aborted" }
  | { status: "unavailable"; reason: "missing-jar" | "missing-java" };

/** Fixed argument list: settings come from target configuration, never from user input. */
export function generatorArguments(run: GeneratorRun, jarPath: string): string[] {
  const properties = Object.entries(run.settings.additionalProperties)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  const args = [
    "-XX:-UsePerfData",
    "-jar",
    jarPath,
    "generate",
    "--generator-name",
    run.settings.generatorName,
    "--input-spec",
    run.specPath,
    "--output",
    run.outputDir,
    `--global-property=${GLOBAL_PROPERTIES}`,
  ];
  if (properties.length > 0) args.push(`--additional-properties=${properties}`);
  if (run.settings.templateDir !== undefined) {
    // Relative to the working directory java inherits (the application root).
    // An absolute path built from process.cwd() would make Next.js trace the
    // whole project into the standalone build.
    args.push("--template-dir", run.settings.templateDir);
  }
  return args;
}

/**
 * Runs OpenAPI Generator as a child process without a shell. Its output is
 * discarded rather than logged, because it can echo specification content.
 */
export async function runGenerator(run: GeneratorRun): Promise<GeneratorOutcome> {
  const jarPath = generatorJarPath();
  try {
    await access(jarPath);
  } catch {
    return { status: "unavailable", reason: "missing-jar" };
  }

  if (run.signal?.aborted === true) return { status: "aborted" };

  const timeoutMs = run.timeoutMs ?? GENERATION_TIMEOUT_MS;
  return new Promise<GeneratorOutcome>((resolve) => {
    const child = spawn("java", generatorArguments(run, jarPath), {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });

    let timedOut = false;
    let aborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      child.kill("SIGKILL");
    };
    run.signal?.addEventListener("abort", onAbort, { once: true });

    let finished = false;
    let outputTooLarge = false;
    let checking = false;
    const { exceedsOutputLimit } = run;
    const outputCheck =
      exceedsOutputLimit === undefined
        ? undefined
        : setInterval(() => {
            if (checking) return;
            checking = true;
            exceedsOutputLimit().then(
              (exceeded) => {
                checking = false;
                if (exceeded && !finished) {
                  outputTooLarge = true;
                  child.kill("SIGKILL");
                }
              },
              () => {
                // A failed check is retried on the next tick; the final
                // output is checked again when it is collected.
                checking = false;
              },
            );
          }, run.outputCheckIntervalMs ?? OUTPUT_CHECK_INTERVAL_MS);

    const cleanUp = () => {
      finished = true;
      clearTimeout(timer);
      clearInterval(outputCheck);
      run.signal?.removeEventListener("abort", onAbort);
    };

    child.once("error", (error: NodeJS.ErrnoException) => {
      cleanUp();
      resolve(
        error.code === "ENOENT"
          ? { status: "unavailable", reason: "missing-java" }
          : { status: "failed", exitCode: null },
      );
    });
    child.once("close", (exitCode) => {
      cleanUp();
      if (aborted) resolve({ status: "aborted" });
      else if (timedOut) resolve({ status: "timeout" });
      else if (outputTooLarge) resolve({ status: "output-too-large" });
      else if (exitCode === 0) resolve({ status: "ok" });
      else resolve({ status: "failed", exitCode });
    });
  });
}
