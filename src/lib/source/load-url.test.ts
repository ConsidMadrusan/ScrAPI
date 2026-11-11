import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchKind, FetchUrlResult } from "./fetch-url";

const fetchUrlMock = vi.hoisted(() =>
  vi.fn<(url: string, kind: FetchKind, headers: Record<string, string>, signal?: AbortSignal) => Promise<FetchUrlResult>>(),
);
vi.mock("./fetch-url", () => ({ fetchUrl: fetchUrlMock }));

const { loadUrlSource } = await import("./load-url");

const spec = (name: string) => readFileSync(join(process.cwd(), "samples/specs", name), "utf8");
const URL_TEXT = "https://api.example.com/graphql";

function answers(responses: Partial<Record<FetchKind, FetchUrlResult>>) {
  fetchUrlMock.mockImplementation((_url, kind) =>
    Promise.resolve(responses[kind] ?? { ok: false, errors: [{ code: "url-unreachable", message: "Unreachable." }] }),
  );
}

function ok(body: string, status = 200, contentType = "application/json"): FetchUrlResult {
  return { ok: true, value: { status, contentType, body } };
}

beforeEach(() => {
  fetchUrlMock.mockReset();
});

describe("loadUrlSource", () => {
  it("returns an OpenAPI document found with a GET", async () => {
    answers({ document: ok(spec("todo.json")) });

    const result = await loadUrlSource(URL_TEXT, {}, "auto");

    expect(result).toEqual({ ok: true, text: spec("todo.json"), kind: "openapi" });
    expect(fetchUrlMock).toHaveBeenCalledTimes(1);
  });

  it("introspects a GraphQL endpoint when the GET is not a specification", async () => {
    answers({
      document: ok("<html>GraphQL playground</html>", 200, "text/html"),
      introspection: ok(spec("books-introspection.json")),
    });

    const result = await loadUrlSource(URL_TEXT, { Authorization: "Bearer t" }, "auto");

    expect(result.ok && result.kind).toBe("graphql");
    expect(result.ok && JSON.parse(result.text)).toHaveProperty("__schema.queryType.name", "Query");
    expect(fetchUrlMock).toHaveBeenLastCalledWith(URL_TEXT, "introspection", { Authorization: "Bearer t" }, undefined);
  });

  it("only introspects when the kind is graphql", async () => {
    answers({ introspection: ok(spec("books-introspection.json")) });

    const result = await loadUrlSource(URL_TEXT, {}, "graphql");

    expect(result.ok && result.kind).toBe("graphql");
    expect(fetchUrlMock).toHaveBeenCalledTimes(1);
  });

  it("explains an endpoint that refuses introspection", async () => {
    answers({
      document: ok("Not found", 404, "text/plain"),
      introspection: ok(JSON.stringify({ errors: [{ message: "Introspection is disabled" }] })),
    });

    const result = await loadUrlSource(URL_TEXT, {}, "auto");

    expect(!result.ok && result.errors[0]?.code).toBe("introspection-disabled");
  });

  it("reports the HTTP status of a document that cannot be read", async () => {
    answers({ document: ok("", 404, "text/plain") });

    const result = await loadUrlSource(URL_TEXT, {}, "openapi");

    expect(!result.ok && result.errors[0]?.message).toContain("HTTP status 404");
  });

  it("does not try introspection when the URL cannot be reached", async () => {
    answers({});

    const result = await loadUrlSource(URL_TEXT, {}, "auto");

    expect(!result.ok && result.errors[0]?.code).toBe("url-unreachable");
    expect(fetchUrlMock).toHaveBeenCalledTimes(1);
  });

  it("reports a URL that is neither a specification nor a GraphQL endpoint", async () => {
    answers({ document: ok('{"hello": "world"}'), introspection: ok("Method not allowed", 405, "text/plain") });

    const result = await loadUrlSource(URL_TEXT, {}, "auto");

    expect(!result.ok && result.errors[0]?.code).toBe("unknown-source");
  });
});
