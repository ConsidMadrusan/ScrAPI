import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const accessMock = vi.hoisted(() => vi.fn());

const exceedsMock = vi.hoisted(() => vi.fn<(root: string) => Promise<boolean>>());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs/promises", () => ({ access: accessMock }));
vi.mock("./collect-output", () => ({ exceedsRawOutputLimits: exceedsMock }));

const { generatorArguments, generatorErrorDetails, generatorJarPath, isGeneratorBusy, runGenerator } = await import(
  "./java-generator"
);
const { generatorRuntimeConfig } = await import("./runtime-config");
const config = generatorRuntimeConfig();

class FakeChild extends EventEmitter {
  stderr = new EventEmitter();
  kill = vi.fn((signal: string) => {
    queueMicrotask(() => this.emit("close", null, signal));
    return true;
  });
}

function fakeProcess(): FakeChild {
  const child = new FakeChild();
  spawnMock.mockReturnValue(child);
  return child;
}

const run = {
  settings: {
    generatorName: "typescript-fetch",
    additionalProperties: { supportsES6: "true" },
    templateDir: "generator-templates/typescript-fetch",
  },
  specPath: "/tmp/scrapi-x/spec.json",
  outputDir: "/tmp/scrapi-x/output",
};

describe("generatorArguments", () => {
  it("builds a fixed argument list from target settings", () => {
    expect(generatorArguments(run, "/app/gen.jar", 256)).toEqual([
      "-Xmx256m",
      "-XX:-UsePerfData",
      "-jar",
      "/app/gen.jar",
      "generate",
      "--generator-name",
      "typescript-fetch",
      "--input-spec",
      "/tmp/scrapi-x/spec.json",
      "--output",
      "/tmp/scrapi-x/output",
      "--global-property=apiTests=false,modelTests=false,apiDocs=false,modelDocs=false",
      "--additional-properties=supportsES6=true",
      "--template-dir",
      "generator-templates/typescript-fetch",
    ]);
  });

  it("uses the configured heap size", () => {
    expect(generatorArguments(run, "/app/gen.jar", 1024)[0]).toBe("-Xmx1024m");
  });
});

describe("generatorErrorDetails", () => {
  // As printed by OpenAPI Generator 7.26.0 for a 3.0 operation without responses.
  const output = [
    'Exception in thread "main" org.openapitools.codegen.SpecValidationException: There were issues with the specification. The option can be disabled via validateSpec (Maven/Gradle) or --skip-validate-spec (CLI).',
    " | Error count: 2, Warning count: 0",
    "Errors: ",
    "\t-attribute paths.'/x'(get).responses is missing",
    "\t-attribute /tmp/scrapi-abc123/spec.json is broken",
    "",
    "\tat org.openapitools.codegen.config.CodegenConfigurator.toContext(CodegenConfigurator.java:741)",
  ].join("\n");

  it("returns the error lines without the stack trace or temp paths", () => {
    expect(generatorErrorDetails(output)).toEqual([
      "attribute paths.'/x'(get).responses is missing",
      "attribute <temp> is broken",
    ]);
  });

  it("returns nothing for output without an Errors block", () => {
    expect(generatorErrorDetails("java.lang.OutOfMemoryError: Java heap space\n\tat x.y(Z.java:1)")).toEqual([]);
  });

  it("keeps at most ten lines", () => {
    const many = ["Errors:", ...Array.from({ length: 15 }, (_, index) => `\t-attribute a${String(index)} is missing`)].join("\n");
    expect(generatorErrorDetails(many)).toHaveLength(10);
  });
});
describe("generatorJarPath", () => {
  it("points at the version pinned in openapitools.json", () => {
    expect(generatorJarPath()).toBe(
      `${process.cwd()}/node_modules/@openapitools/openapi-generator-cli/versions/7.26.0.jar`,
    );
  });
});

describe("runGenerator", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    accessMock.mockResolvedValue(undefined);
    exceedsMock.mockReset();
    exceedsMock.mockResolvedValue(false);
  });

  it("kills the process when its output folder grows past the limits", async () => {
    const child = fakeProcess();
    exceedsMock.mockResolvedValueOnce(false).mockResolvedValue(true);

    const outcome = await runGenerator(run);

    expect(exceedsMock).toHaveBeenCalledWith(run.outputDir);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(outcome).toEqual({ status: "output-too-large" });
  });

  it("stops measuring the output once the process has exited", async () => {
    const child = fakeProcess();
    const outcome = runGenerator(run);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalled();
    });
    child.emit("close", 0);
    await outcome;
    const checks = exceedsMock.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(exceedsMock.mock.calls.length).toBe(checks);
  });

  it("runs java without a shell and reports success", async () => {
    const child = fakeProcess();
    const outcome = runGenerator(run);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalled();
    });
    child.emit("close", 0);

    expect(await outcome).toEqual({ status: "ok" });
    expect(spawnMock).toHaveBeenCalledWith(
      config.javaCommand,
      generatorArguments(run, generatorJarPath() ?? ""),
      expect.objectContaining({ shell: false, stdio: ["ignore", "ignore", "pipe"] }),
    );
  });

  it("reports a non-zero exit as a failure", async () => {
    const child = fakeProcess();
    const outcome = runGenerator(run);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalled();
    });
    child.emit("close", 1);

    expect(await outcome).toEqual({ status: "failed", exitCode: 1, details: [] });
  });

  it("reports the generator's validation errors from its error output", async () => {
    const child = fakeProcess();
    const outcome = runGenerator(run);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalled();
    });
    child.stderr.emit("data", Buffer.from("Exception in thread \"main\" SpecValidationException\nErrors: \n"));
    child.stderr.emit("data", "\t-attribute paths.'/x'(get).responses is missing\n\n\tat org.example(X.java:1)\n");
    child.emit("close", 1);

    expect(await outcome).toEqual({
      status: "failed",
      exitCode: 1,
      details: ["attribute paths.'/x'(get).responses is missing"],
    });
  });

  it("kills the process with SIGKILL when it runs too long", async () => {
    const child = fakeProcess();

    const outcome = await runGenerator({ ...run, timeoutMs: 10 });

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(outcome).toEqual({ status: "timeout" });
  });

  it("kills the process when the request is aborted", async () => {
    const child = fakeProcess();
    const controller = new AbortController();
    const outcome = runGenerator({ ...run, signal: controller.signal });
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalled();
    });
    controller.abort();

    expect(await outcome).toEqual({ status: "aborted" });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does not start anything when the request is already aborted", async () => {
    expect(await runGenerator({ ...run, signal: AbortSignal.abort() })).toEqual({ status: "aborted" });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects runs beyond the concurrency limit and frees slots afterwards", async () => {
    const children = Array.from({ length: config.maxConcurrent }, () => new FakeChild());
    for (const child of children) spawnMock.mockReturnValueOnce(child);
    const running = children.map(() => runGenerator(run));
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(config.maxConcurrent);
    });

    expect(isGeneratorBusy()).toBe(true);
    expect(await runGenerator(run)).toEqual({ status: "busy" });

    for (const child of children) child.emit("close", 0);
    await Promise.all(running);
    const next = fakeProcess();
    const outcome = runGenerator(run);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(config.maxConcurrent + 1);
    });
    next.emit("close", 0);
    expect(await outcome).toEqual({ status: "ok" });
  });

  it("reports a missing Java runtime as unavailable", async () => {
    const child = fakeProcess();
    const outcome = runGenerator(run);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalled();
    });
    child.emit("error", Object.assign(new Error("spawn java ENOENT"), { code: "ENOENT" }));

    expect(await outcome).toEqual({ status: "unavailable", reason: "missing-java" });
  });

  it("reports other start failures as unavailable, not as a specification problem", async () => {
    const child = fakeProcess();
    const outcome = runGenerator(run);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalled();
    });
    child.emit("error", Object.assign(new Error("spawn java EACCES"), { code: "EACCES" }));

    expect(await outcome).toEqual({ status: "unavailable", reason: "spawn-failed", code: "EACCES" });
  });

  it("does not start anything when the JAR is missing", async () => {
    accessMock.mockRejectedValue(new Error("ENOENT"));

    expect(await runGenerator(run)).toEqual({ status: "unavailable", reason: "missing-jar" });
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
