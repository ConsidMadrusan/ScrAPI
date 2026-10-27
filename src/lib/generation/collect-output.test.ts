import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveTarget } from "@/lib/targets/config";
import {
  collectOutput,
  exceedsGeneratorOutputLimits,
  MAX_GENERATOR_OUTPUT_BYTES,
  MAX_GENERATOR_OUTPUT_FILES,
  MAX_OUTPUT_BYTES,
  OutputLimitError,
} from "./collect-output";

let outputDir = "";

async function writeOutput(path: string, content = "x") {
  const absolute = join(outputDir, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "scrapi-test-"));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

describe("collectOutput", () => {
  const typescript = resolveTarget({ target: "typescript-next", httpClient: "fetch" });

  it("keeps only the target's files, sorted, with destinations and contents", async () => {
    await writeOutput("runtime.ts", "runtime");
    await writeOutput("apis/TodosApi.ts", "api");
    await writeOutput("README.md");
    await writeOutput(".openapi-generator/FILES");
    await writeOutput("git_push.sh");

    expect(await collectOutput(outputDir, typescript)).toEqual([
      {
        archivePath: "api-client/apis/TodosApi.ts",
        destinationPath: "src/lib/api-client/apis/TodosApi.ts",
        content: "api",
      },
      {
        archivePath: "api-client/runtime.ts",
        destinationPath: "src/lib/api-client/runtime.ts",
        content: "runtime",
      },
    ]);
  });

  it("takes C# files from the client project only", async () => {
    await writeOutput("src/ApiClient/Api/TodosApi.cs");
    await writeOutput("src/ApiClient/ApiClient.csproj");
    await writeOutput("src/ApiClient.Test/Api/TodosApiTests.cs");
    await writeOutput("ApiClient.sln");

    const files = await collectOutput(outputDir, resolveTarget({ target: "csharp" }));
    expect(files.map((file) => file.archivePath)).toEqual([
      "ApiClient/Api/TodosApi.cs",
      "ApiClient/ApiClient.csproj",
    ]);
  });

  it("ignores symbolic links", async () => {
    await writeOutput("index.ts");
    const outside = join(tmpdir(), "scrapi-outside-target.ts");
    await writeFile(outside, "secret");
    await symlink(outside, join(outputDir, "linked.ts"));

    try {
      const files = await collectOutput(outputDir, typescript);
      expect(files.map((file) => file.archivePath)).toEqual(["api-client/index.ts"]);
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("stops when the output is larger than the limit", async () => {
    await writeOutput("big.ts", "x".repeat(MAX_OUTPUT_BYTES + 1));
    await expect(collectOutput(outputDir, typescript)).rejects.toBeInstanceOf(OutputLimitError);
  });

  it("stops listing when the generator wrote more files than it may", async () => {
    await mkdir(join(outputDir, "many"));
    await Promise.all(
      Array.from({ length: MAX_GENERATOR_OUTPUT_FILES + 1 }, (_, index) =>
        writeFile(join(outputDir, "many", `${String(index)}.md`), ""),
      ),
    );
    await expect(collectOutput(outputDir, typescript)).rejects.toBeInstanceOf(OutputLimitError);
  });
});

describe("exceedsGeneratorOutputLimits", () => {
  it("is false for a folder the generator has not created yet", async () => {
    expect(await exceedsGeneratorOutputLimits(join(outputDir, "missing"))).toBe(false);
  });

  it("is false within the limits", async () => {
    await writeOutput("apis/TodosApi.ts", "api");
    expect(await exceedsGeneratorOutputLimits(outputDir)).toBe(false);
  });

  it("counts scaffolding too, and is true past the byte limit", async () => {
    await writeOutput("docs/README.md", "x".repeat(MAX_GENERATOR_OUTPUT_BYTES + 1));
    expect(await exceedsGeneratorOutputLimits(outputDir)).toBe(true);
  });

  it("is true past the file limit", async () => {
    await mkdir(join(outputDir, "many"));
    await Promise.all(
      Array.from({ length: MAX_GENERATOR_OUTPUT_FILES + 1 }, (_, index) =>
        writeFile(join(outputDir, "many", `${String(index)}.md`), ""),
      ),
    );
    expect(await exceedsGeneratorOutputLimits(outputDir)).toBe(true);
  });
});
