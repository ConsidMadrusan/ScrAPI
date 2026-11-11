import "server-only";

import { looksLikeOpenApiDocument, type SourceKind } from "@/lib/source-kind";
import type { Problem } from "@/lib/validation/problems";
import { withFetchSlot } from "./fetch-slots";
import { fetchUrl, type FetchedResponse } from "./fetch-url";

/** Which kind of API a URL is loaded as: detected, or chosen by the caller. */
export type UrlSourceKind = "auto" | SourceKind;

export type UrlSourceResult = { ok: true; text: string; kind: SourceKind } | { ok: false; errors: Problem[] };

/**
 * Loads an API description from a URL on ScrAPI's server, for callers that
 * cannot load it themselves (the MCP tools). The same rules as
 * `/api/fetch-source` apply, because both use `fetchUrl` and share its slots:
 * the two fixed requests, public addresses only unless
 * SCRAPI_ALLOW_PRIVATE_URLS=true, time and size limits, and no logging.
 *
 * - `openapi`: GET the document (JSON or YAML, OpenAPI or Swagger).
 * - `graphql`: POST the introspection query; the result is introspection JSON.
 * - `auto`: GET first; if that is not an OpenAPI or Swagger document, try
 *   introspection. This matches loading a URL in the browser.
 */
export async function loadUrlSource(
  url: string,
  headers: Record<string, string>,
  kind: UrlSourceKind,
  signal?: AbortSignal,
): Promise<UrlSourceResult> {
  const result = await withFetchSlot(() => load(url, headers, kind, signal));
  if (result === "busy") {
    return failure("fetch-busy", "The server is busy loading other URLs. Try again in a moment.");
  }
  return result;
}

async function load(
  url: string,
  headers: Record<string, string>,
  kind: UrlSourceKind,
  signal: AbortSignal | undefined,
): Promise<UrlSourceResult> {
  if (kind === "graphql") return introspect(url, headers, signal);

  const document = await fetchUrl(url, "document", headers, signal);
  const read = document.ok ? readDocument(document.value) : document;
  if (kind === "openapi") return read.ok ? { ...read, kind: "openapi" } : read;
  if (read.ok && looksLikeOpenApiDocument(read.text)) return { ...read, kind: "openapi" };
  // The URL could not be reached at all: introspection would fail the same way.
  if (!document.ok) return document;

  const introspection = await introspect(url, headers, signal);
  if (introspection.ok || introspection.graphqlAnswered) return introspection;
  if (!read.ok) return read;
  return failure(
    "unknown-source",
    'This URL returned neither an OpenAPI or Swagger document nor a GraphQL introspection result. Check the address, or set kind to "openapi" or "graphql".',
  );
}

function readDocument(response: FetchedResponse): { ok: true; text: string } | { ok: false; errors: Problem[] } {
  if (response.status < 200 || response.status >= 300) return httpFailure(response.status);
  if (response.body.trim() === "") return failure("empty-response", "The URL returned an empty response.");
  if (response.contentType.toLowerCase().includes("text/html") || /^\s*</.test(response.body)) {
    return failure(
      "html-response",
      "This URL returned a web page, not a specification. Use the address of its JSON or YAML document (often /swagger/v1/swagger.json, /openapi.json, or /v3/api-docs).",
    );
  }
  return { ok: true, text: response.body };
}

type IntrospectionResult =
  | { ok: true; text: string; kind: "graphql" }
  | { ok: false; errors: Problem[]; graphqlAnswered: boolean };

/** Sends the standard introspection query; returns the schema as introspection JSON (`{ "__schema": ... }`). */
async function introspect(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<IntrospectionResult> {
  const response = await fetchUrl(url, "introspection", headers, signal);
  if (!response.ok) return { ...response, graphqlAnswered: false };
  const { status, body: text } = response.value;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ...httpFailure(status), graphqlAnswered: false };
  }
  const schema = isRecord(body) && isRecord(body.data) ? body.data.__schema : undefined;
  if (isRecord(schema)) return { ok: true, text: JSON.stringify({ __schema: schema }), kind: "graphql" };

  if (isRecord(body) && (Array.isArray(body.errors) || "data" in body)) {
    return {
      ok: false,
      graphqlAnswered: true,
      errors: [
        {
          code: "introspection-disabled",
          message:
            status === 401 || status === 403
              ? "This GraphQL endpoint needs authentication for introspection. Pass an Authorization header in headers, or pass the schema (SDL or introspection JSON) as source."
              : "This GraphQL endpoint does not allow introspection. Pass its schema (SDL or introspection JSON) as source instead.",
        },
      ],
    };
  }
  return { ...httpFailure(status), graphqlAnswered: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpFailure(status: number): { ok: false; errors: Problem[] } {
  const hint =
    status === 401 || status === 403
      ? " The API may require authentication: pass an Authorization header in headers."
      : status === 404
        ? " Check the address."
        : "";
  return failure("http-error", `The URL answered with HTTP status ${String(status)}.${hint}`);
}

function failure(code: string, message: string): { ok: false; errors: Problem[] } {
  return { ok: false, errors: [{ code, message }] };
}
