import { describe, expect, it } from "vitest";
import { generationOptionsSchema, TARGET_IDS } from "@/lib/validation/requests";
import { ALL_OPTIONS } from "@/test/generation-fixtures";
import { combinationKey, combinationLabel, COMBINATIONS, optionsFor, sortCombinations, TARGETS } from "./catalog";

describe("target catalog", () => {
  it("describes every target exactly once", () => {
    expect(TARGETS.map((target) => target.id).sort()).toEqual([...TARGET_IDS].sort());
  });

  it.each(TARGETS)("builds valid options for $id", (target) => {
    const options = optionsFor(target.id, "fetch");
    expect(generationOptionsSchema.parse(options)).toEqual(options);
    expect("httpClient" in options).toBe(target.hasHttpClient);
  });
});

describe("framework combinations", () => {
  it("lists every valid combination exactly once", () => {
    expect(COMBINATIONS.map((options) => generationOptionsSchema.parse(options))).toEqual(ALL_OPTIONS);
  });

  it("gives each combination a unique, folder-safe key", () => {
    const keys = COMBINATIONS.map(combinationKey);
    expect(keys).toEqual(["nextjs-axios", "nextjs-fetch", "nuxt-axios", "nuxt-fetch", "angular", "csharp"]);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9-]+$/);
  });

  it("labels combinations with the target and HTTP client", () => {
    expect(combinationLabel({ target: "typescript-nuxt", httpClient: "axios" })).toBe(
      "TypeScript for Nuxt / Vue (axios)",
    );
    expect(combinationLabel({ target: "csharp" })).toBe("C# / .NET");
  });

  it("sorts combinations into catalog order and drops duplicates", () => {
    expect(
      sortCombinations([
        { target: "csharp" },
        { target: "typescript-next", httpClient: "fetch" },
        { target: "csharp" },
      ]),
    ).toEqual([{ target: "typescript-next", httpClient: "fetch" }, { target: "csharp" }]);
  });
});
