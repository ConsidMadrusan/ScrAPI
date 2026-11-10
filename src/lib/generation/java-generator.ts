import "server-only";

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { GLOBAL_PROPERTIES, type GeneratorSettings } from "@/lib/targets/config";
import generatorConfig from "../../../openapitools.json";
import { exceedsRawOutputLimits } from "./collect-output";

/** Generation normally takes about a second; this allows for large specifications. */
export const GENERATION_TIMEOUT_MS = 60_000;

/** How often the output folder is measured while the generator runs. */
export const OUTPUT_CHECK_INTERVAL_MS = 250;

/**
 * Most generator JVMs that may run at once; further requests are rejected as busy.
 * Together with JVM_MAX_HEAP this keeps the server within the 512 MB container
 * memory documented in README.md.
 */
export const MAX_CONCURRENT_GENERATIONS = 1;

/** Fixed heap cap per generator JVM, so a large run fails cleanly instead of exhausting container memory. */
export const JVM_MAX_HEAP = "-Xmx256m";

/** Process-wide resource counter (not request state): JVMs currently running. */
let runningGenerators = 0;

/**
 * The generator version pinned in openapitools.json, or undefined when that
 * file is malformed. Parsed safely so a bad configuration is reported as
 * "generator unavailable" instead of breaking the import of this module.
 */
const pinnedVersion = z
  .object({ "generator-cli": z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) }) })
  .safeParse(generatorConfig).data?.["generator-cli"].version;

/**
 * The JAR downloaded by `npm run setup:generator` (and copied to the same
 * relative path in the Docker image), or undefined when openapitools.json has
 * no valid pinned version. Nothing is downloaded at request time.
 */
export function generatorJarPath(): string | undefined {
  if (pinnedVersion === undefined) return undefined;
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
  /** Aborts (and kills) the generator, e.g. when the client disconnects. */
  signal?: AbortSignal | undefined;
}

export type GeneratorOutcome =
  | { status: "ok" }
  | { status: "failed"; exitCode: number | null }
  | { status: "timeout" }
  | { status: "output-too-large" }
  | { status: "aborted" }
  | { status: "busy" }
  | { status: "unavailable"; reason: "invalid-config" | "missing-jar" | "missing-java" | "spawn-failed"; code?: string };

/** Fixed argument list: settings come from target configuration, never from user input. */
export function generatorArguments(run: GeneratorRun, jarPath: string): string[] {
  const properties = Object.entries(run.settings.additionalProperties)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  const args = [
    JVM_MAX_HEAP,
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
 * At most MAX_CONCURRENT_GENERATIONS run at once; the child is killed on
 * timeout, when its output folder passes the raw output limits, or when
 * `run.signal` aborts.
 */
export async function runGenerator(run: GeneratorRun): Promise<GeneratorOutcome> {
  if (runningGenerators >= MAX_CONCURRENT_GENERATIONS) return { status: "busy" };
  runningGenerators += 1;
  try {
    return await startGenerator(run);
  } finally {
    runningGenerators -= 1;
  }
}

async function startGenerator(run: GeneratorRun): Promise<GeneratorOutcome> {
  const jarPath = generatorJarPath();
  if (jarPath === undefined) return { status: "unavailable", reason: "invalid-config" };
  try {
    await access(jarPath);
  } catch {
    return { status: "unavailable", reason: "missing-jar" };
  }
  if (run.signal?.aborted === true) return { status: "aborted" };

  const timeoutMs = run.timeoutMs ?? GENERATION_TIMEOUT_MS;
  const signal = run.signal;
  return new Promise<GeneratorOutcome>((resolve) => {
    const child = spawn("java", generatorArguments(run, jarPath), {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });

    type StopReason = "timeout" | "output-too-large" | "aborted";
    let stopReason: StopReason | undefined;
    let finished = false;
    const stop = (reason: StopReason): void => {
      stopReason ??= reason;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      stop("timeout");
    }, timeoutMs);
    const onAbort = (): void => {
      stop("aborted");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    // Measures the output folder while the generator runs, so a hostile
    // specification cannot fill the temp disk before the timeout.
    let outputCheck: NodeJS.Timeout | undefined;
    const scheduleOutputCheck = (): void => {
      outputCheck = setTimeout(() => {
        void exceedsRawOutputLimits(run.outputDir).then(
          (exceeded) => {
            if (finished) return;
            if (exceeded) stop("output-too-large");
            else scheduleOutputCheck();
          },
          () => {
            if (!finished) scheduleOutputCheck();
          },
        );
      }, OUTPUT_CHECK_INTERVAL_MS);
    };
    scheduleOutputCheck();

    const cleanUp = (): void => {
      finished = true;
      clearTimeout(timer);
      clearTimeout(outputCheck);
      signal?.removeEventListener("abort", onAbort);
    };

    child.once("error", (error: NodeJS.ErrnoException) => {
      cleanUp();
      // Java could not be started at all (missing, not executable, out of
      // processes or memory): a server problem, not a problem with the specification.
      resolve(
        error.code === "ENOENT"
          ? { status: "unavailable", reason: "missing-java" }
          : { status: "unavailable", reason: "spawn-failed", code: error.code ?? "unknown" },
      );
    });
    child.once("close", (exitCode) => {
      cleanUp();
      if (stopReason !== undefined) resolve({ status: stopReason });
      else if (exitCode === 0) resolve({ status: "ok" });
      else resolve({ status: "failed", exitCode });
    });
  });
}
