import { describe, expect, it } from "vitest";
import { readJsonBody } from "./read-request";

const encoder = new TextEncoder();

/** A streamed body with no Content-Length, like chunked transfer encoding. */
function chunkedRequest(chunks: string[], onPull?: () => void): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      onPull?.();
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(encoder.encode(chunk));
    },
  });
  return new Request("http://localhost/api/validate", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
}

describe("readJsonBody", () => {
  it("parses a JSON body within the limit", async () => {
    const request = new Request("http://localhost/api/validate", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });
    await expect(readJsonBody(request, 100)).resolves.toEqual({ ok: true, value: { a: 1 } });
  });

  it("parses a chunked body without Content-Length", async () => {
    const request = chunkedRequest(['{"a":', '"é"}']);
    expect(request.headers.get("content-length")).toBeNull();
    await expect(readJsonBody(request, 100)).resolves.toEqual({ ok: true, value: { a: "é" } });
  });

  it("rejects a declared Content-Length over the limit without reading", async () => {
    const request = new Request("http://localhost/api/validate", {
      method: "POST",
      headers: { "content-length": "1000" },
      body: "{}",
    });
    const result = await readJsonBody(request, 10);
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("stops reading a chunked body as soon as it passes the limit", async () => {
    let pulls = 0;
    const chunks = Array.from({ length: 100 }, () => "x".repeat(10));
    const request = chunkedRequest(chunks, () => {
      pulls += 1;
    });

    const result = await readJsonBody(request, 25);

    expect(result).toMatchObject({ ok: false, status: 413, problem: { code: "too-large" } });
    expect(pulls).toBeLessThan(10);
  });

  it("rejects a body that is not JSON", async () => {
    const request = chunkedRequest(["not json"]);
    await expect(readJsonBody(request, 100)).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
  });
});
