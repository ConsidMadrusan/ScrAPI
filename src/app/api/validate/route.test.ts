import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type * as ValidateModule from "@/lib/openapi/validate";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { validateResponseSchema } from "@/lib/validation/responses";
import { POST } from "./route";

/** When set, the validator throws this error instead of running. */
const validatorCrash = vi.hoisted(() => ({ error: undefined as Error | undefined }));
vi.mock("@/lib/openapi/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof ValidateModule>();
  return {
    ...actual,
    validateSpecification: (text: string) =>
      validatorCrash.error ? Promise.reject(validatorCrash.error) : actual.validateSpecification(text),
  };
});

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/validate", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );
}

async function readBody(response: Response) {
  return validateResponseSchema.parse(await response.json());
}

const todo = readFileSync(join(process.cwd(), "samples/specs/todo.json"), "utf8");

describe("POST /api/validate", () => {
  it("returns API info, operations, and tag groups for a valid specification", async () => {
    const response = await post(JSON.stringify({ spec: todo }));

    expect(response.status).toBe(200);
    const body = await readBody(response);
    if (!body.ok) throw new Error("expected success");
    expect(body.info).toEqual({ title: "Todo API", version: "1.0.0", openapi: "3.0.3" });
    expect(body.operations).toHaveLength(5);
    expect(body.groups.map((group) => group.name)).toEqual(["todos"]);
  });

  it("accepts YAML and reports the conversion", async () => {
    const yaml = readFileSync(join(process.cwd(), "samples/specs/todo.yaml"), "utf8");
    const response = await post(JSON.stringify({ spec: yaml }));

    expect(response.status).toBe(200);
    const body = await readBody(response);
    if (!body.ok) throw new Error("expected success");
    expect(body.conversions).toEqual(["yaml"]);
    expect(JSON.parse(body.spec)).toMatchObject({ openapi: "3.0.3" });
  });

  it("accepts an OpenAPI 3.1 specification", async () => {
    const todo31 = readFileSync(join(process.cwd(), "samples/specs/todo-3.1.json"), "utf8");
    const response = await post(JSON.stringify({ spec: todo31 }));

    expect(response.status).toBe(200);
    const body = await readBody(response);
    if (!body.ok) throw new Error("expected success");
    expect(body.info.openapi).toBe("3.1.0");
    expect(body.operations).toHaveLength(5);
  });

  it("returns 422 with problems for an invalid specification", async () => {
    const response = await post(JSON.stringify({ spec: '{"openapi": "3.2.0"}' }));

    expect(response.status).toBe(422);
    const body = await readBody(response);
    expect(body).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: "unsupported-version" })],
    });
  });

  it("returns 400 for a malformed request", async () => {
    const response = await post(JSON.stringify({ specification: todo }));
    expect(response.status).toBe(400);
    expect(await readBody(response)).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: "invalid-request", location: "spec" })],
    });
  });

  it("returns 400 when the body is not JSON", async () => {
    const response = await post("spec=1");
    expect(response.status).toBe(400);
  });

  it("returns 413 for an oversized body without reading it as JSON", async () => {
    const response = await post("{}", { "content-length": String(MAX_REQUEST_BYTES + 1) });
    expect(response.status).toBe(413);
    expect(await readBody(response)).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: "too-large" })],
    });
  });

  it("answers unexpected errors with a JSON problem and no details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    validatorCrash.error = new Error("/tmp/secret details");
    try {
      const response = await post(JSON.stringify({ spec: todo }));

      expect(response.status).toBe(500);
      const body = await readBody(response);
      expect(body).toEqual({ ok: false, errors: [expect.objectContaining({ code: "internal" })] });
      expect(JSON.stringify(body)).not.toContain("secret");
    } finally {
      validatorCrash.error = undefined;
    }
  });
});
