import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { renderGuideMarkdown } from "@/lib/guides/markdown";
import { renderGuide } from "@/lib/guides/render";
import { generationResult } from "@/test/generation-fixtures";
import { buildResultZip, GUIDE_FILE_NAME } from "./result-zip";

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
