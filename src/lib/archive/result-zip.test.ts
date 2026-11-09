import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { renderChainedGuide } from "@/lib/guides/chained";
import { GUIDE_FILE_NAME, renderGuideMarkdown } from "@/lib/guides/markdown";
import { combinationKey } from "@/lib/targets/catalog";
import { MAX_COMBINED_OUTPUT_BYTES } from "@/lib/validation/limits";
import { ALL_OPTIONS, generationResult } from "@/test/generation-fixtures";
import { buildResultZip, checkArchivable, checkArchivableAll } from "./result-zip";

describe("buildResultZip", () => {
  it("puts each result's files in its combination folder, with one guide built from the same results", async () => {
    const results = [
      generationResult({ target: "typescript-nuxt", httpClient: "axios" }),
      generationResult({ target: "typescript-nuxt", httpClient: "fetch" }),
      generationResult({ target: "csharp" }),
    ];
    const guide = renderChainedGuide(results);

    const zip = await JSZip.loadAsync(await buildResultZip(guide));

    const expected = results.flatMap((result) =>
      result.files.map((file) => ({
        path: `${combinationKey(result.options)}/${file.archivePath}`,
        content: file.content,
      })),
    );
    const names = Object.values(zip.files)
      .filter((file) => !file.dir)
      .map((file) => file.name)
      .sort();
    expect(names).toEqual([...expected.map((file) => file.path), GUIDE_FILE_NAME].sort());
    for (const file of expected) {
      expect(await zip.file(file.path)?.async("string")).toBe(file.content);
    }
    expect(await zip.file(GUIDE_FILE_NAME)?.async("string")).toBe(renderGuideMarkdown(guide));
  });
});

describe("checkArchivable", () => {
  it.each(ALL_OPTIONS)("accepts a result laid out by the target configuration (%o)", (options) => {
    expect(checkArchivable(generationResult(options))).toBeUndefined();
  });

  it("rejects a result whose roots belong to another target", () => {
    const result = { ...generationResult({ target: "csharp" }), options: { target: "typescript-angular" as const } };

    expect(checkArchivable(result)?.problem.code).toBe("result-mismatch");
  });
});

describe("checkArchivableAll", () => {
  it("accepts one result for every combination", () => {
    expect(checkArchivableAll(ALL_OPTIONS.map((options) => generationResult(options)))).toBeUndefined();
  });

  it("rejects the same combination twice", () => {
    const result = generationResult({ target: "csharp" });

    expect(checkArchivableAll([result, result])?.problem.code).toBe("duplicate-combination");
  });

  it("rejects a set containing a mismatched result", () => {
    const mismatched = { ...generationResult({ target: "csharp" }), destinationRoot: "elsewhere" };

    expect(checkArchivableAll([generationResult({ target: "typescript-angular" }), mismatched])?.problem.code).toBe(
      "result-mismatch",
    );
  });

  it("rejects results that are too large together", () => {
    const withContent = (options: (typeof ALL_OPTIONS)[number]) => {
      const result = generationResult(options);
      const [first, ...rest] = result.files;
      if (!first) throw new Error("fixture has no files");
      return { ...result, files: [{ ...first, content: "x".repeat(MAX_COMBINED_OUTPUT_BYTES / 2) }, ...rest] };
    };

    const rejection = checkArchivableAll([
      withContent({ target: "typescript-angular" }),
      withContent({ target: "csharp" }),
    ]);

    expect(rejection?.status).toBe(413);
    expect(rejection?.problem.code).toBe("too-large");
  });
});
