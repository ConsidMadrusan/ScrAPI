import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const accessMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs/promises", () => ({ access: accessMock }));

const { generatorArguments, generatorJarPath, MAX_CONCURRENT_GENERATIONS, runGenerator } = await import("./java-generator");

class FakeChild extends EventEmitter {
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
    expect(generatorArguments(run, "/app/gen.jar")).toEqual([
      "-Xmx1g",
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
      "java",
      generatorArguments(run, generatorJarPath()),
      expect.objectContaining({ shell: false, stdio: "ignore" }),
    );
  });

  it("reports a non-zero exit as a failure", async () => {
    const child = fakeProcess();
    const outcome = runGenerator(run);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalled();
    });
    child.emit("close", 1);

    expect(await outcome).toEqual({ status: "failed", exitCode: 1 });
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
    const children = Array.from({ length: MAX_CONCURRENT_GENERATIONS }, () => new FakeChild());
    for (const child of children) spawnMock.mockReturnValueOnce(child);
    const running = children.map(() => runGenerator(run));
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(MAX_CONCURRENT_GENERATIONS);
    });

    expect(await runGenerator(run)).toEqual({ status: "busy" });

    for (const child of children) child.emit("close", 0);
    await Promise.all(running);
    const next = fakeProcess();
    const outcome = runGenerator(run);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(MAX_CONCURRENT_GENERATIONS + 1);
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

  it("does not start anything when the JAR is missing", async () => {
    accessMock.mockRejectedValue(new Error("ENOENT"));

    expect(await runGenerator(run)).toEqual({ status: "unavailable", reason: "missing-jar" });
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
