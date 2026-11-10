import { afterEach, describe, expect, it, vi } from "vitest";
import { generationResult } from "@/test/generation-fixtures";
import { requestArchive, requestValidation, unexpectedResponse } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("unexpectedResponse", () => {
  it.each([
    [413, "too large for the server"],
    [502, "not available right now"],
    [503, "not available right now"],
    [504, "took too long"],
    [500, "had a problem (HTTP 500)"],
    [404, "unexpected response (HTTP 404)"],
  ])("explains HTTP %i", (status, expected) => {
    expect(unexpectedResponse(status).errors[0]?.message).toContain(expected);
  });
});

describe("requestValidation", () => {
  it("keeps the HTTP status when a proxy answers with an HTML page", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("<html>Too large</html>", { status: 413 }))));

    const response = await requestValidation("{}", new AbortController().signal);

    expect(response).toEqual(unexpectedResponse(413));
  });
});

describe("requestArchive", () => {
  const results = [generationResult({ target: "csharp" })];

  it("accepts a ZIP whose content type has parameters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(new Uint8Array([0x50, 0x4b]), { headers: { "content-type": "application/zip; charset=binary" } })),
      ),
    );

    const response = await requestArchive(results, "existing");

    expect(response.ok).toBe(true);
  });

  it("gives up with a clear problem when the server takes too long", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        init?.signal?.aborted === true ? Promise.reject(new DOMException("aborted", "AbortError")) : Promise.resolve(new Response()),
      ),
    );

    const response = await requestArchive(results, "existing");

    expect(response).toEqual({ ok: false, errors: [expect.objectContaining({ code: "archive-timeout" })] });
  });

  it("passes other network errors on to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));

    await expect(requestArchive(results, "existing")).rejects.toThrow("Failed to fetch");
  });
});
