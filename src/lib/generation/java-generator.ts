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
}

export type GeneratorOutcome =
  | { status: "ok" }
  | { status: "failed"; exitCode: number | null }
  | { status: "timeout" }
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

  const timeoutMs = run.timeoutMs ?? GENERATION_TIMEOUT_MS;
  return new Promise<GeneratorOutcome>((resolve) => {
    const child = spawn("java", generatorArguments(run, jarPath), {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(
        error.code === "ENOENT"
          ? { status: "unavailable", reason: "missing-java" }
          : { status: "failed", exitCode: null },
      );
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      if (timedOut) resolve({ status: "timeout" });
      else if (exitCode === 0) resolve({ status: "ok" });
      else resolve({ status: "failed", exitCode });
    });
  });
}
