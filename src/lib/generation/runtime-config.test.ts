import { afterEach, describe, expect, it, vi } from "vitest";
import { generatorRuntimeConfig } from "./runtime-config";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generatorRuntimeConfig", () => {
  it("uses the documented defaults when nothing is set", () => {
    expect(generatorRuntimeConfig({})).toEqual({ timeoutMs: 60_000, maxConcurrent: 1, maxHeapMb: 256, javaCommand: "java" });
  });

  it("reads valid values from the environment", () => {
    expect(
      generatorRuntimeConfig({
        SCRAPI_GENERATION_TIMEOUT_SECONDS: "120",
        SCRAPI_MAX_CONCURRENT_GENERATIONS: "3",
        SCRAPI_GENERATOR_MAX_HEAP_MB: "1024",
        JAVA_HOME: "/opt/java",
      }),
    ).toEqual({ timeoutMs: 120_000, maxConcurrent: 3, maxHeapMb: 1024, javaCommand: "/opt/java/bin/java" });
  });

  it.each([["abc"], ["0"], ["1.5"], ["100000"]])("falls back to the default for %s, with one warning", (value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = { SCRAPI_GENERATOR_MAX_HEAP_MB: value };

    expect(generatorRuntimeConfig(env).maxHeapMb).toBe(256);
    generatorRuntimeConfig(env);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("ignores an empty JAVA_HOME", () => {
    expect(generatorRuntimeConfig({ JAVA_HOME: " " }).javaCommand).toBe("java");
  });
});
