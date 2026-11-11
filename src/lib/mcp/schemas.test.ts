import { describe, expect, it } from "vitest";
import { combinationKey, COMBINATIONS } from "@/lib/targets/catalog";
import { COMBINATION_KEYS, generateToolInputSchema } from "./schemas";

describe("MCP tool schemas", () => {
  it("offers exactly the catalog's combinations, in order", () => {
    expect([...COMBINATION_KEYS]).toEqual(COMBINATIONS.map(combinationKey));
  });

  it("defaults the project to an existing one", () => {
    const input = generateToolInputSchema.parse({ source: "type Query { a: Int }", combinations: ["csharp"], allOperations: true });

    expect(input.project).toBe("existing");
  });

  it("needs operations or allOperations", () => {
    const result = generateToolInputSchema.safeParse({ source: "type Query { a: Int }", combinations: ["csharp"] });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown combination", () => {
    const result = generateToolInputSchema.safeParse({
      source: "type Query { a: Int }",
      combinations: ["react-native"],
      allOperations: true,
    });

    expect(result.success).toBe(false);
  });
});
