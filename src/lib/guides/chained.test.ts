import { describe, expect, it } from "vitest";
import { combinationKey } from "@/lib/targets/catalog";
import { ALL_OPTIONS, generationResult } from "@/test/generation-fixtures";
import { renderChainedGuide } from "./chained";
import { renderGuideMarkdown } from "./markdown";
import { renderGuide } from "./render";

describe("renderChainedGuide", () => {
  it("orders sections by combination, whatever the order of the results", () => {
    const results = [
      generationResult({ target: "csharp" }),
      generationResult({ target: "typescript-nuxt", httpClient: "fetch" }),
      generationResult({ target: "typescript-next", httpClient: "axios" }),
    ];

    const guide = renderChainedGuide(results);

    expect(guide.sections.map((section) => section.key)).toEqual(["nextjs-axios", "nuxt-fetch", "csharp"]);
    expect(guide.sections.map((section) => section.label)).toEqual([
      "TypeScript for Next.js / React (axios)",
      "TypeScript for Nuxt / Vue (fetch)",
      "C# / .NET",
    ]);
  });

  it("renders each section from its own result, with its ZIP folder", () => {
    const result = generationResult({ target: "typescript-angular" });
    const [section] = renderChainedGuide([result]).sections;

    expect(section?.result).toBe(result);
    expect(section?.guide).toEqual(renderGuide(result, { zipFolder: "angular" }));
  });

  it("uses the section's title for a single combination and a general title otherwise", () => {
    const next = generationResult({ target: "typescript-next", httpClient: "fetch" });

    expect(renderChainedGuide([next]).title).toBe(renderGuide(next).title);
    expect(renderChainedGuide([next, generationResult({ target: "csharp" })]).title).toBe(
      "Add the generated clients to your projects",
    );
  });

  it("lists each placeholder once", () => {
    const guide = renderChainedGuide(ALL_OPTIONS.map((options) => generationResult(options)));
    const tokens = guide.placeholders.map((placeholder) => placeholder.token);

    expect(tokens).toEqual([...new Set(tokens)]);
    const used = new Set(
      guide.sections.flatMap((section) => section.guide.placeholders.map((placeholder) => placeholder.token)),
    );
    expect(new Set(tokens)).toEqual(used);
  });
});

describe("renderGuideMarkdown", () => {
  it("numbers steps across sections, in the order the page shows them", () => {
    const guide = renderChainedGuide(ALL_OPTIONS.map((options) => generationResult(options)));
    const markdown = renderGuideMarkdown(guide);

    const stepTitles = guide.sections.flatMap((section) => section.guide.steps.map((step) => step.title));
    const headings = markdown.split("\n").filter((line) => line.startsWith("### Step "));
    expect(headings).toEqual(stepTitles.map((title, index) => `### Step ${String(index + 1)}: ${title}`));

    const sectionHeadings = markdown.split("\n").filter((line) => line.startsWith("## "));
    expect(sectionHeadings).toEqual(guide.sections.map((section) => `## ${section.label}`));
    for (const options of ALL_OPTIONS) expect(markdown).toContain(`- \`${combinationKey(options)}/\``);
  });
});
