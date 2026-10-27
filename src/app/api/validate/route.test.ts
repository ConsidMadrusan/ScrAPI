import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { validateResponseSchema } from "@/lib/validation/responses";
import { POST } from "./route";

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

  it("returns 422 with problems for an invalid specification", async () => {
    const response = await post(JSON.stringify({ spec: '{"openapi": "3.1.0"}' }));

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

  it("returns a 500 failure response when reading the body fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("client disconnected"));
      },
    });
    const response = await POST(
      new Request("http://localhost/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit),
    );

    expect(response.status).toBe(500);
    expect(await readBody(response)).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: "internal" })],
    });
  });

  it("returns 413 for an oversized body without reading it as JSON", async () => {
    const response = await post("{}", { "content-length": String(MAX_REQUEST_BYTES + 1) });
    expect(response.status).toBe(413);
    expect(await readBody(response)).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: "too-large" })],
    });
  });
});
