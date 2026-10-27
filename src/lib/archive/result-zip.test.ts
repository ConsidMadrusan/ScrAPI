import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { GUIDE_FILE_NAME, renderGuideMarkdown } from "@/lib/guides/markdown";
import { renderGuide } from "@/lib/guides/render";
import { ALL_OPTIONS, generationResult } from "@/test/generation-fixtures";
import { buildResultZip, checkArchivable } from "./result-zip";

describe("buildResultZip", () => {
  it("contains the generated files and the guide built from the same result", async () => {
    const result = generationResult({ target: "typescript-nuxt", httpClient: "axios" });
    const guide = renderGuide(result);

    const zip = await JSZip.loadAsync(await buildResultZip(result, guide));

    const names = Object.values(zip.files)
      .filter((file) => !file.dir)
      .map((file) => file.name)
      .sort();
    expect(names).toEqual([...result.files.map((file) => file.archivePath), GUIDE_FILE_NAME].sort());
    for (const file of result.files) {
      expect(await zip.file(file.archivePath)?.async("string")).toBe(file.content);
    }
    expect(await zip.file(GUIDE_FILE_NAME)?.async("string")).toBe(renderGuideMarkdown(guide, result));
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
