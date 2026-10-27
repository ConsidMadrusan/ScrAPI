import { describe, expect, it } from "vitest";
import type { JsonObject } from "@/lib/openapi/json";
import { keepFirstTagOnly } from "./generator-input";

describe("keepFirstTagOnly", () => {
  const spec: JsonObject = {
    openapi: "3.0.3",
    paths: {
      "/books": {
        parameters: [],
        get: { tags: ["books"], responses: {} },
        post: { tags: ["books", "admin"], responses: {} },
      },
      "/health": { get: { responses: {} } },
    },
  };

  it("keeps only the first tag of each operation", () => {
    const result = keepFirstTagOnly(spec);
    expect(result.paths).toEqual({
      "/books": {
        parameters: [],
        get: { tags: ["books"], responses: {} },
        post: { tags: ["books"], responses: {} },
      },
      "/health": { get: { responses: {} } },
    });
  });

  it("does not modify its input", () => {
    const before = structuredClone(spec);
    keepFirstTagOnly(spec);
    expect(spec).toEqual(before);
  });
});
