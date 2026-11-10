import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FsPromises from "node:fs/promises";
import type { GeneratorOutcome, GeneratorRun } from "./java-generator";
import type { PreparedGeneration } from "./prepare";

const runGeneratorMock = vi.hoisted(() => vi.fn<(run: GeneratorRun) => Promise<GeneratorOutcome>>());
vi.mock("./java-generator", () => ({ runGenerator: runGeneratorMock }));

/** Error codes that make the next temp-folder calls fail; unset means the real call runs. */
const fsFailures = vi.hoisted(() => ({ mkdtemp: undefined as string | undefined, rm: undefined as string | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const fail = (code: string) => Promise.reject(Object.assign(new Error(`${code}: /tmp/scrapi-x`), { code }));
  return {
    ...actual,
    mkdtemp: (prefix: string) => (fsFailures.mkdtemp ? fail(fsFailures.mkdtemp) : actual.mkdtemp(prefix)),
    rm: (path: string, options?: Parameters<typeof actual.rm>[1]) =>
      fsFailures.rm ? fail(fsFailures.rm) : actual.rm(path, options),
  };
});

const { generateClient } = await import("./generate");

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
  fsFailures.mkdtemp = undefined;
  fsFailures.rm = undefined;
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
        kind: "openapi",
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
    [{ status: "failed", exitCode: 1, details: [] }, 422, "generation-failed"],
    [{ status: "timeout" }, 422, "generation-timeout"],
    [{ status: "output-too-large" }, 422, "output-too-large"],
    [{ status: "busy" }, 503, "generator-busy"],
    [{ status: "aborted" }, 503, "generation-aborted"],
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

  it("reports a run without an output folder as an empty result and cleans up", async () => {
    generatorThat(() => Promise.resolve({ status: "ok" })); // no output folder at all

    expect(await generateClient(prepared)).toEqual({
      ok: false,
      status: 500,
      errors: [expect.objectContaining({ code: "generation-failed" })],
    });
    expect(existsSync(workDir())).toBe(false);
  });

  it("shows the generator's own validation errors, one problem each", async () => {
    generatorThat(() =>
      Promise.resolve({
        status: "failed",
        exitCode: 1,
        details: ["attribute paths.'/x'(get).responses is missing", "attribute info.title is missing"],
      }),
    );

    expect(await generateClient(prepared)).toEqual({
      ok: false,
      status: 422,
      errors: [
        {
          code: "generation-failed",
          message: "The generator rejected the specification: attribute paths.'/x'(get).responses is missing.",
        },
        { code: "generation-failed", message: "The generator rejected the specification: attribute info.title is missing." },
      ],
    });
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
    generatorThat(() => Promise.resolve({ status: "failed", exitCode: 2, details: ["attribute x is missing"] }));

    await generateClient(prepared);

    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain("typescript-next");
    expect(logged).not.toContain("/todos");
    expect(logged).not.toContain("openapi");
  });

  it("reports unusable temp storage as a server problem without logging paths", async () => {
    fsFailures.mkdtemp = "EROFS";
    generatorThat(() => Promise.resolve({ status: "ok" }));

    const result = await generateClient(prepared);

    expect(result).toEqual({
      ok: false,
      status: 503,
      errors: [expect.objectContaining({ code: "temp-storage-unavailable" })],
    });
    expect(lastRun).toBeUndefined();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("EROFS");
    expect(logged).not.toContain("/tmp");
  });

  it("keeps a successful result when removing the temp folder fails", async () => {
    generatorThat(async (run) => {
      await mkdir(run.outputDir, { recursive: true });
      await writeFile(join(run.outputDir, "index.ts"), "export {};");
      fsFailures.rm = "EBUSY";
      return { status: "ok" };
    });

    const result = await generateClient(prepared);

    expect(result.ok).toBe(true);
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith("Temp folder cleanup failed", { code: "EBUSY" });
    fsFailures.rm = undefined;
    await rm(workDir(), { recursive: true, force: true });
  });
});
