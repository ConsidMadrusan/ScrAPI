import { describe, expect, it, vi } from "vitest";
import { readJsonBody } from "./read-request";

function chunkedRequest(chunks: Uint8Array[]): { request: Request; pulled: () => number } {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
  });
  const request = new Request("http://localhost/api", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  return { request, pulled: () => index };
}

describe("readJsonBody", () => {
  it("parses a JSON body within the limit", async () => {
    const request = new Request("http://localhost/api", { method: "POST", body: '{"a":"é"}' });
    expect(await readJsonBody(request, 100)).toEqual({ ok: true, value: { a: "é" } });
  });

  it("rejects a declared Content-Length over the limit without reading", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "1000" },
    });
    const text = vi.spyOn(request, "text");
    const result = await readJsonBody(request, 10);
    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(text).not.toHaveBeenCalled();
  });

  it("stops reading a body without Content-Length once it exceeds the limit", async () => {
    const chunk = new Uint8Array(8).fill(0x20);
    const { request, pulled } = chunkedRequest(Array.from({ length: 100 }, () => chunk));
    const result = await readJsonBody(request, 20);
    expect(result).toMatchObject({ ok: false, status: 413, problem: { code: "too-large" } });
    expect(pulled()).toBeLessThan(10);
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode('"é"');
    const { request } = chunkedRequest([bytes.slice(0, 2), bytes.slice(2)]);
    expect(await readJsonBody(request, 100)).toEqual({ ok: true, value: "é" });
  });

  it("rejects a body that is not JSON", async () => {
    const request = new Request("http://localhost/api", { method: "POST", body: "nope" });
    expect(await readJsonBody(request, 100)).toMatchObject({ ok: false, status: 400 });
  });
});
