import "server-only";

import { join } from "node:path";
import { z } from "zod";
import {
  DEFAULT_GENERATION_TIMEOUT_SECONDS,
  DEFAULT_GENERATOR_MAX_HEAP_MB,
  DEFAULT_MAX_CONCURRENT_GENERATIONS,
} from "@/lib/validation/limits";

/**
 * How the OpenAPI Generator JVM runs on this deployment. The defaults keep a
 * 512 MB container safe (README.md, "Self-hosting with Docker"); larger hosts
 * can raise them. Every variable is documented in README.md.
 */
export interface GeneratorRuntimeConfig {
  timeoutMs: number;
  maxConcurrent: number;
  maxHeapMb: number;
  /** `$JAVA_HOME/bin/java` when JAVA_HOME is set, otherwise `java` from the PATH. */
  javaCommand: string;
}

interface Setting {
  name: string;
  fallback: number;
  min: number;
  max: number;
}

const TIMEOUT: Setting = { name: "SCRAPI_GENERATION_TIMEOUT_SECONDS", fallback: DEFAULT_GENERATION_TIMEOUT_SECONDS, min: 5, max: 600 };
const CONCURRENCY: Setting = { name: "SCRAPI_MAX_CONCURRENT_GENERATIONS", fallback: DEFAULT_MAX_CONCURRENT_GENERATIONS, min: 1, max: 16 };
const HEAP: Setting = { name: "SCRAPI_GENERATOR_MAX_HEAP_MB", fallback: DEFAULT_GENERATOR_MAX_HEAP_MB, min: 128, max: 16_384 };

/** Variables already reported as invalid, so the log gets one warning each, not one per request. */
const warned = new Set<string>();

export function generatorRuntimeConfig(env: Readonly<Record<string, string | undefined>> = process.env): GeneratorRuntimeConfig {
  const javaHome = env.JAVA_HOME?.trim();
  return {
    timeoutMs: readInteger(env, TIMEOUT) * 1000,
    maxConcurrent: readInteger(env, CONCURRENCY),
    maxHeapMb: readInteger(env, HEAP),
    javaCommand: javaHome ? join(javaHome, "bin", "java") : "java",
  };
}

/** An unset variable uses the default; an invalid one also does, with a warning (a configuration error). */
function readInteger(env: Readonly<Record<string, string | undefined>>, setting: Setting): number {
  const raw = env[setting.name]?.trim();
  if (raw === undefined || raw === "") return setting.fallback;
  const parsed = z.coerce.number().int().min(setting.min).max(setting.max).safeParse(raw);
  if (parsed.success) return parsed.data;
  if (!warned.has(setting.name)) {
    warned.add(setting.name);
    console.warn(
      `${setting.name} must be a whole number from ${String(setting.min)} to ${String(setting.max)}; using the default ${String(setting.fallback)}.`,
    );
  }
  return setting.fallback;
}
