import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SPEC_BYTES } from "@/lib/validation/limits";
import { checkUrl, loadDocument, loadSource, parseHeaderLines } from "./fetch-source";

const spec = '{"openapi":"3.0.3","info":{"title":"T","version":"1"},"paths":{}}';

function stubFetch(implementation: (url: URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("checkUrl", () => {
  it("accepts absolute http and https URLs", () => {
    expect(checkUrl(" https://api.example.com/openapi.json ").ok).toBe(true);
    expect(checkUrl("http://localhost:5000/swagger/v1/swagger.json").ok).toBe(true);
  });

  it.each([
    ["relative paths", "/openapi.json"],
    ["other schemes", "file:///etc/passwd"],
    ["credentials in the URL", "https://user:secret@api.example.com/openapi.json"],
  ])("rejects %s", (_reason, url) => {
    expect(checkUrl(url)).toMatchObject({ ok: false, errors: [{ code: "invalid-url" }] });
  });
});

describe("parseHeaderLines", () => {
  it("parses Name: value lines and ignores blank lines", () => {
    expect(parseHeaderLines("Authorization: Bearer abc\n\nX-Api-Key:  k1 \n")).toEqual({
      ok: true,
      headers: { Authorization: "Bearer abc", "X-Api-Key": "k1" },
    });
  });

  it("rejects lines that are not headers", () => {
    expect(parseHeaderLines("just a token")).toMatchObject({ ok: false, errors: [{ code: "invalid-headers" }] });
  });
});

describe("loadDocument", () => {
  it("loads the document in the browser with the given headers and without cookies", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(spec, { headers: { "content-type": "application/json" } })));

    const result = await loadDocument("https://api.example.com/openapi.json", { Authorization: "Bearer abc" });

    expect(result).toEqual({ ok: true, text: spec });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.example.com/openapi.json");
    expect(init).toMatchObject({ method: "GET", credentials: "omit", headers: { Authorization: "Bearer abc" } });
  });

  it("asks ScrAPI's server to load the URL when the browser cannot (CORS), with the same headers", async () => {
    const fetchMock = stubFetch((url) =>
      String(url) === "/api/fetch-source"
        ? Promise.resolve(Response.json({ ok: true, status: 200, contentType: "application/json", body: spec }))
        : Promise.reject(new TypeError("Failed to fetch")),
    );

    const result = await loadDocument("https://api.example.com/openapi.json", { Authorization: "Bearer abc" });

    expect(result).toEqual({ ok: true, text: spec });
    const proxied = fetchMock.mock.calls.find(([url]) => String(url) === "/api/fetch-source");
    const body = proxied?.[1]?.body;
    expect(typeof body === "string" ? JSON.parse(body) : body).toEqual({
      url: "https://api.example.com/openapi.json",
      kind: "document",
      headers: { Authorization: "Bearer abc" },
    });
  });

  it("reports why the server could not load it either, for example a private address", async () => {
    stubFetch((url) =>
      String(url) === "/api/fetch-source"
        ? Promise.resolve(
            Response.json({ ok: false, errors: [{ code: "private-url", message: "public internet addresses only" }] }, { status: 422 }),
          )
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    expect(await loadDocument("http://10.0.0.5/openapi.json", {})).toMatchObject({
      ok: false,
      errors: [{ code: "private-url" }],
    });
  });

  it("explains that the URL could not be reached when the server cannot be asked either", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await loadDocument("https://api.example.com/openapi.json", {})).toMatchObject({
      ok: false,
      errors: [{ code: "url-unreachable" }],
    });
  });

  it("uses the server for GraphQL introspection too, with the fixed introspection request", async () => {
    const schema = { queryType: { name: "Query" }, types: [] };
    const fetchMock = stubFetch((url) =>
      String(url) === "/api/fetch-source"
        ? Promise.resolve(
            Response.json({ ok: true, status: 200, contentType: "application/json", body: JSON.stringify({ data: { __schema: schema } }) }),
          )
        : Promise.reject(new TypeError("Failed to fetch")),
    );

    const result = await loadSource("https://api.example.com/graphql", {}, "graphql");

    expect(result).toEqual({ ok: true, text: JSON.stringify({ __schema: schema }), kind: "graphql" });
    const proxied = fetchMock.mock.calls.find(([url]) => String(url) === "/api/fetch-source");
    const body = proxied?.[1]?.body;
    expect(typeof body === "string" ? body : "").toContain('"kind":"introspection"');
  });

  it("reports HTTP errors with a hint about authentication", async () => {
    stubFetch(() => Promise.resolve(new Response("no", { status: 401 })));
    expect(await loadDocument("https://api.example.com/openapi.json", {})).toMatchObject({
      ok: false,
      errors: [{ code: "http-error", message: expect.stringContaining("Authorization") as string }],
    });
  });

  it("recognizes a web page such as Swagger UI", async () => {
    stubFetch(() =>
      Promise.resolve(new Response("<!DOCTYPE html><html></html>", { headers: { "content-type": "text/html" } })),
    );
    expect(await loadDocument("https://api.example.com/swagger", {})).toMatchObject({
      ok: false,
      errors: [{ code: "html-response" }],
    });
  });

  it("stops reading documents over the size limit", async () => {
    stubFetch(() => Promise.resolve(new Response("x".repeat(MAX_SPEC_BYTES + 1))));
    expect(await loadDocument("https://api.example.com/openapi.json", {})).toMatchObject({
      ok: false,
      errors: [{ code: "too-large" }],
    });
  });

  it("gives up after the time limit", async () => {
    vi.useFakeTimers();
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    const result = loadDocument("https://api.example.com/openapi.json", {});
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await result).toMatchObject({ ok: false, errors: [{ code: "url-timeout" }] });
  });

  it("does not fetch invalid URLs", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(spec)));
    expect((await loadDocument("ftp://example.com/spec.json", {})).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("loadSource", () => {
  const schema = { queryType: { name: "Query" }, types: [] };

  it("uses the document when the URL serves an OpenAPI or Swagger document", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(spec)));
    expect(await loadSource("https://api.example.com/openapi.json", {}, "auto")).toEqual({
      ok: true,
      text: spec,
      kind: "openapi",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to GraphQL introspection when the URL is not a document", async () => {
    const fetchMock = stubFetch((_url, init) =>
      Promise.resolve(
        init?.method === "POST"
          ? Response.json({ data: { __schema: schema } })
          : new Response("Method not allowed", { status: 405 }),
      ),
    );

    const result = await loadSource("https://api.example.com/graphql", { Authorization: "Bearer abc" }, "auto");

    expect(result).toEqual({ ok: true, text: JSON.stringify({ __schema: schema }), kind: "graphql" });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    const body = post?.[1]?.body;
    expect(typeof body === "string" ? JSON.parse(body) : body).toMatchObject({
      query: expect.stringContaining("__schema") as string,
    });
    expect(post?.[1]).toMatchObject({ credentials: "omit", headers: { Authorization: "Bearer abc" } });
  });

  it("explains that introspection is disabled", async () => {
    stubFetch(() =>
      Promise.resolve(Response.json({ errors: [{ message: "GraphQL introspection is not allowed" }] }, { status: 400 })),
    );
    expect(await loadSource("https://api.example.com/graphql", {}, "graphql")).toMatchObject({
      ok: false,
      errors: [{ code: "introspection-disabled", message: expect.stringContaining("Paste or upload its schema") as string }],
    });
  });

  it("reports the document problem when the URL is neither a document nor a GraphQL endpoint", async () => {
    stubFetch(() => Promise.resolve(new Response("not found", { status: 404 })));
    expect(await loadSource("https://api.example.com/missing.json", {}, "auto")).toMatchObject({
      ok: false,
      errors: [{ code: "http-error" }],
    });
  });

  it("only sends a GET when the type is OpenAPI", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response("not found", { status: 404 })));
    await loadSource("https://api.example.com/openapi.json", {}, "openapi");
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["GET"]);
  });
});
