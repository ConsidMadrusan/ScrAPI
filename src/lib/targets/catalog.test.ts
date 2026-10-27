import { describe, expect, it } from "vitest";
import { generationOptionsSchema, TARGET_IDS } from "@/lib/validation/requests";
import { optionsFor, TARGETS } from "./catalog";

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
