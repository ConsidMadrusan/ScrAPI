import { existsSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratorOutcome, GeneratorRun } from "./java-generator";
import type { PreparedGeneration } from "./prepare";

const runGeneratorMock = vi.hoisted(() => vi.fn<(run: GeneratorRun) => Promise<GeneratorOutcome>>());
vi.mock("./java-generator", () => ({ runGenerator: runGeneratorMock }));

/** Fails the next `rm` call when set, to test cleanup failures. */
const rmFailure = vi.hoisted(() => ({ next: undefined as Error | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rm: (...args: Parameters<typeof actual.rm>) => {
      const error = rmFailure.next;
      rmFailure.next = undefined;
      return error ? Promise.reject(error) : actual.rm(...args);
    },
  };
});

const { generateClient, MAX_CONCURRENT_GENERATIONS, withTempDir } = await import("./generate");

const prepared: PreparedGeneration = {
  options: { target: "typescript-next", httpClient: "fetch" },
  selected: [{ id: "GET /todos", method: "get", path: "/todos", tags: ["todos", "admin"], requiresInput: false }],
  filteredSpec: {
    openapi: "3.0.3",
    paths: { "/todos": { get: { tags: ["todos", "admin"], responses: {} } } },
  },
};

/** Directories used by the last generator run, recorded for cleanup checks. */
let lastRun: GeneratorRun | undefined;

beforeEach(() => {
  lastRun = undefined;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

function generatorThat(behaviour: (run: GeneratorRun) => Promise<GeneratorOutcome>) {
  runGeneratorMock.mockImplementation(async (run) => {
    lastRun = run;
    return behaviour(run);
  });
}

function workDir(): string {
  if (!lastRun) throw new Error("generator did not run");
  return join(lastRun.specPath, "..");
}

describe("generateClient", () => {
  it("writes the generator input, collects output, and removes the temp folder", async () => {
    let specSeenByGenerator = "";
    generatorThat(async (run) => {
      specSeenByGenerator = await readFile(run.specPath, "utf8");
      await mkdir(join(run.outputDir, "apis"), { recursive: true });
      await writeFile(join(run.outputDir, "apis/TodosApi.ts"), "export class TodosApi {}");
      await writeFile(join(run.outputDir, "README.md"), "docs");
      return { status: "ok" };
    });

    const result = await generateClient(prepared);

    expect(result).toEqual({
      ok: true,
      value: {
        ok: true,
        options: prepared.options,
        archiveRoot: "api-client",
        destinationRoot: "src/lib/api-client",
        operations: prepared.selected,
        files: [
          {
            archivePath: "api-client/apis/TodosApi.ts",
            destinationPath: "src/lib/api-client/apis/TodosApi.ts",
            content: "export class TodosApi {}",
          },
        ],
      },
    });
    expect(lastRun?.settings.generatorName).toBe("typescript-fetch");
    // The generator sees one tag per operation; the prepared spec is unchanged.
    expect(JSON.parse(specSeenByGenerator)).toMatchObject({
      paths: { "/todos": { get: { tags: ["todos"] } } },
    });
    expect(prepared.filteredSpec).toMatchObject({
      paths: { "/todos": { get: { tags: ["todos", "admin"] } } },
    });
    expect(existsSync(workDir())).toBe(false);
  });

  it.each([
    [{ status: "failed", exitCode: 1 }, 422, "generation-failed"],
    [{ status: "timeout" }, 422, "generation-timeout"],
    [{ status: "unavailable", reason: "missing-jar" }, 503, "generator-unavailable"],
  ] as const)("maps %j to a user-facing error and cleans up", async (outcome, status, code) => {
    generatorThat(async (run) => {
      await mkdir(run.outputDir, { recursive: true });
      await writeFile(join(run.outputDir, "partial.ts"), "partial");
      return outcome;
    });

    const result = await generateClient(prepared);

    expect(result).toEqual({ ok: false, status, errors: [expect.objectContaining({ code })] });
    expect(existsSync(workDir())).toBe(false);
  });

  it("rejects requests over the concurrency limit without starting the generator", async () => {
    runGeneratorMock.mockClear();
    const release: (() => void)[] = [];
    generatorThat(
      () =>
        new Promise((resolve) => {
          release.push(() => {
            resolve({ status: "failed", exitCode: 1 });
          });
        }),
    );

    const running = Array.from({ length: MAX_CONCURRENT_GENERATIONS }, () =>
      generateClient(prepared),
    );
    await vi.waitFor(() => {
      expect(release).toHaveLength(MAX_CONCURRENT_GENERATIONS);
    });

    const rejected = await generateClient(prepared);
    expect(rejected).toEqual({
      ok: false,
      status: 503,
      errors: [expect.objectContaining({ code: "generator-busy" })],
    });
    expect(runGeneratorMock).toHaveBeenCalledTimes(MAX_CONCURRENT_GENERATIONS);

    release.forEach((done) => {
      done();
    });
    await Promise.all(running);

    // Slots are released afterwards.
    generatorThat(() => Promise.resolve({ status: "timeout" }));
    expect(await generateClient(prepared)).toMatchObject({ ok: false, status: 422 });
  });

  it("passes the abort signal to the generator and reports cancellation", async () => {
    const controller = new AbortController();
    generatorThat((run) => {
      expect(run.signal).toBe(controller.signal);
      return Promise.resolve({ status: "aborted" });
    });

    const result = await generateClient(prepared, controller.signal);
    expect(result).toMatchObject({ ok: false, status: 499 });
    expect(existsSync(workDir())).toBe(false);
  });

  it("cleans up when collecting the output throws", async () => {
    generatorThat(() => Promise.resolve({ status: "ok" })); // no output folder at all

    await expect(generateClient(prepared)).rejects.toThrow();
    expect(existsSync(workDir())).toBe(false);
  });

  it("reports an empty result as a failure", async () => {
    generatorThat(async (run) => {
      await mkdir(run.outputDir, { recursive: true });
      await writeFile(join(run.outputDir, "README.md"), "only docs");
      return { status: "ok" };
    });

    const result = await generateClient(prepared);
    expect(result).toEqual({
      ok: false,
      status: 500,
      errors: [expect.objectContaining({ code: "generation-failed" })],
    });
  });

  it("logs metadata only, never specification content", async () => {
    generatorThat(() => Promise.resolve({ status: "failed", exitCode: 2 }));

    await generateClient(prepared);

    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain("typescript-next");
    expect(logged).not.toContain("/todos");
    expect(logged).not.toContain("openapi");
  });
});

describe("withTempDir", () => {
  it("keeps the result when removing the folder fails, and logs only the error type", async () => {
    rmFailure.next = Object.assign(new Error("EBUSY: /tmp/scrapi-abc"), { name: "SystemError" });
    let used = "";

    const result = await withTempDir((dir) => {
      used = dir;
      return Promise.resolve("done");
    });

    expect(result).toBe("done");
    expect(console.error).toHaveBeenCalledWith("Could not remove the generation folder", {
      error: "SystemError",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("/tmp");
    await rm(used, { recursive: true, force: true });
  });

  it("removes the folder after the callback throws", async () => {
    let used = "";
    await expect(
      withTempDir((dir) => {
        used = dir;
        return Promise.reject(new Error("boom"));
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(used)).toBe(false);
  });
});
