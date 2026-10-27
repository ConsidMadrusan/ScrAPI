import { describe, expect, it } from "vitest";
import { MAX_SPEC_BYTES } from "./limits";
import { generateRequestSchema, generationOptionsSchema, validateRequestSchema } from "./requests";

describe("validateRequestSchema", () => {
  it("accepts a specification string", () => {
    expect(validateRequestSchema.safeParse({ spec: "{}" }).success).toBe(true);
  });

  it.each([{}, { spec: 1 }, { spec: "  " }, null])("rejects %j", (value) => {
    expect(validateRequestSchema.safeParse(value).success).toBe(false);
  });

  it("measures the size limit in UTF-8 bytes", () => {
    // "é" is 2 bytes in UTF-8 but 1 UTF-16 code unit.
    const text = "é".repeat(MAX_SPEC_BYTES / 2 + 1);
    const result = validateRequestSchema.safeParse({ spec: text });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/larger than 5 MB/);
  });
});

describe("generationOptionsSchema", () => {
  it.each([
    { target: "csharp" },
    { target: "typescript-angular" },
    { target: "typescript-next", httpClient: "axios" },
    { target: "typescript-nuxt", httpClient: "fetch" },
  ])("accepts %j", (options) => {
    expect(generationOptionsSchema.safeParse(options).success).toBe(true);
  });

  it.each([
    { target: "java" },
    { target: "typescript-next" },
    { target: "typescript-nuxt", httpClient: "xhr" },
    {},
  ])("rejects %j", (options) => {
    expect(generationOptionsSchema.safeParse(options).success).toBe(false);
  });

  it("drops an HTTP client option for targets that do not use one", () => {
    const result = generationOptionsSchema.parse({ target: "csharp", httpClient: "axios" });
    expect(result).toEqual({ target: "csharp" });
  });
});

describe("generateRequestSchema", () => {
  const valid = {
    spec: "{}",
    options: { target: "csharp" },
    selection: [{ method: "get", path: "/users" }],
  };

  it("accepts a well-formed request", () => {
    expect(generateRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("requires at least one operation", () => {
    const result = generateRequestSchema.safeParse({ ...valid, selection: [] });
    expect(result.error?.issues[0]?.message).toBe("Select at least one operation.");
  });

  it.each([
    [{ method: "GET", path: "/users" }],
    [{ method: "get", path: "users" }],
    [{ method: "fetch", path: "/users" }],
    ["GET /users"],
  ])("rejects malformed selection entries %j", (entry) => {
    expect(generateRequestSchema.safeParse({ ...valid, selection: [entry] }).success).toBe(false);
  });
});
