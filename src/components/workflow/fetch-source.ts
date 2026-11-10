import { getIntrospectionQuery } from "graphql";
import { looksLikeOpenApiDocument, type SourceKind } from "@/lib/source-kind";
import { formatMegabytes, MAX_SPEC_BYTES, URL_LOAD_TIMEOUT_MS } from "@/lib/validation/limits";
import { readTextUpTo } from "@/lib/validation/read-request";
import { fetchSourceResponseSchema, type FetchSourceResponse, type Problem } from "@/lib/validation/responses";

/**
 * Loading an API description from a URL happens in the browser first. When
 * the browser cannot read the URL (usually CORS), ScrAPI's server loads it
 * instead through /api/fetch-source: public addresses only, unless the
 * deployment sets SCRAPI_ALLOW_PRIVATE_URLS=true. Request headers the user
 * adds (for example Authorization) then pass through ScrAPI's server to that
 * URL; they are never stored or logged.
 */

/** How long the browser waits for a URL before giving up (the same limit as the server fallback). */
export { URL_LOAD_TIMEOUT_MS };

/** Most request headers a user may add for loading a URL. */
const MAX_HEADERS = 20;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

interface Failure {
  ok: false;
  errors: Problem[];
}

export type LoadResult = { ok: true; text: string } | Failure;

/** Which kind of API a URL is loaded as: detected, or chosen by the user. */
export type SourceMode = "auto" | SourceKind;

export type SourceResult = { ok: true; text: string; kind: SourceKind } | { ok: false; errors: Problem[] };

/**
 * Loads an API description from a URL in the browser.
 *
 * - `openapi`: GET the document (JSON or YAML, OpenAPI or Swagger).
 * - `graphql`: POST an introspection query to the endpoint.
 * - `auto`: GET first; if that is not an OpenAPI or Swagger document, try
 *   introspection. If neither works, the more telling problem is reported.
 */
export async function loadSource(
  urlText: string,
  headers: Record<string, string>,
  mode: SourceMode,
  signal?: AbortSignal,
): Promise<SourceResult> {
  if (mode === "graphql") return introspect(urlText, headers, signal);
  const document = await loadDocument(urlText, headers, signal);
  if (mode === "openapi") return document.ok ? { ...document, kind: "openapi" } : document;
  if (document.ok && looksLikeOpenApiDocument(document.text)) return { ...document, kind: "openapi" };

  const checked = checkUrl(urlText);
  if (!checked.ok) return checked;
  const introspection = await introspect(urlText, headers, signal);
  if (introspection.ok || introspection.graphqlAnswered) return introspection;
  // Neither a specification nor a GraphQL endpoint: explain what the GET returned.
  if (!document.ok) return document;
  return failure(
    "unknown-source",
    "This URL returned neither an OpenAPI or Swagger document nor a GraphQL introspection result. Check the address, or choose the API type explicitly.",
  );
}

export type HeaderResult = { ok: true; headers: Record<string, string> } | { ok: false; errors: Problem[] };

/** Parses "Name: value" lines; blank lines are ignored. */
export function parseHeaderLines(text: string): HeaderResult {
  const headers: Record<string, string> = {};
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length > MAX_HEADERS) {
    return failure("invalid-headers", `Add at most ${String(MAX_HEADERS)} request headers.`);
  }
  for (const [index, line] of lines.entries()) {
    const colon = line.indexOf(":");
    const name = colon > 0 ? line.slice(0, colon).trim() : "";
    if (!HEADER_NAME.test(name)) {
      return failure(
        "invalid-headers",
        `Request header line ${String(index + 1)} must look like "Name: value", for example "Authorization: Bearer <token>".`,
      );
    }
    headers[name] = line.slice(colon + 1).trim();
  }
  return { ok: true, headers };
}

/** Checks a URL typed by the user: absolute http(s), no credentials in it. */
export function checkUrl(text: string): { ok: true; url: URL } | { ok: false; errors: Problem[] } {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return failure("invalid-url", "Enter a complete URL, for example https://api.example.com/openapi.json.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return failure("invalid-url", "Only http:// and https:// URLs can be loaded.");
  }
  if (url.username !== "" || url.password !== "") {
    return failure(
      "invalid-url",
      "Do not put a user name or password in the URL. Add an Authorization request header instead.",
    );
  }
  return { ok: true, url };
}

/**
 * Loads a document (OpenAPI or Swagger, JSON or YAML) from a URL in the
 * browser, within the specification size limit and a time limit. The text is
 * returned unchanged; validation decides whether it can be used.
 */
export async function loadDocument(
  urlText: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<LoadResult> {
  const checked = checkUrl(urlText);
  if (!checked.ok) return checked;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, URL_LOAD_TIMEOUT_MS);
  const onAbort = () => {
    controller.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await fetch(checked.url, {
        method: "GET",
        headers: { accept: "application/json, application/yaml, text/yaml, */*;q=0.5", ...headers },
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) return signal?.aborted === true ? unreachable() : timedOut();
      // Usually CORS: ScrAPI's server loads it instead (public addresses only, by default).
      const proxied = await loadViaServer(checked.url, "document", headers, controller.signal);
      if (!(proxied instanceof Response)) return proxied;
      response = proxied;
    }
    if (!response.ok) return httpFailure(response.status);

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SPEC_BYTES) return tooLarge();

    let text: string | undefined;
    try {
      text = await readTextUpTo(response.body, MAX_SPEC_BYTES);
    } catch {
      return controller.signal.aborted ? timedOut() : unreachable();
    }
    if (text === undefined) return tooLarge();
    if (text.trim() === "") return failure("empty-response", "The URL returned an empty response.");
    if (isHtml(response.headers.get("content-type"), text)) {
      return failure(
        "html-response",
        "This URL returned a web page, not a specification. Open the page and use the link to its JSON or YAML document (often /swagger/v1/swagger.json, /openapi.json, or /v3/api-docs).",
      );
    }
    return { ok: true, text };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Problems from introspection, and whether the URL answered like a GraphQL endpoint at all. */
type IntrospectionResult =
  | { ok: true; text: string; kind: "graphql" }
  | { ok: false; errors: Problem[]; graphqlAnswered: boolean };

/**
 * Sends the standard introspection query and returns the schema as
 * introspection JSON (`{ "__schema": ... }`), within the size limit.
 */
async function introspect(
  urlText: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<IntrospectionResult> {
  const checked = checkUrl(urlText);
  if (!checked.ok) return { ...checked, graphqlAnswered: false };

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, URL_LOAD_TIMEOUT_MS);
  const onAbort = () => {
    controller.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await fetch(checked.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...headers },
        body: JSON.stringify({ query: getIntrospectionQuery({ descriptions: true }) }),
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        return { ...(signal?.aborted === true ? unreachable() : timedOut()), graphqlAnswered: false };
      }
      const proxied = await loadViaServer(checked.url, "introspection", headers, controller.signal);
      if (!(proxied instanceof Response)) return { ...proxied, graphqlAnswered: false };
      response = proxied;
    }

    let text: string | undefined;
    try {
      text = await readTextUpTo(response.body, MAX_SPEC_BYTES);
    } catch {
      return { ...unreachable(), graphqlAnswered: false };
    }
    if (text === undefined) return { ...tooLarge(), graphqlAnswered: true };

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { ...httpFailure(response.status), graphqlAnswered: false };
    }
    const schema = isRecord(body) && isRecord(body.data) ? body.data.__schema : undefined;
    if (isRecord(schema)) return { ok: true, text: JSON.stringify({ __schema: schema }), kind: "graphql" };

    const answered = isRecord(body) && (Array.isArray(body.errors) || "data" in body);
    if (answered) {
      return {
        ok: false,
        graphqlAnswered: true,
        errors: [
          {
            code: "introspection-disabled",
            message:
              response.status === 401 || response.status === 403
                ? "This GraphQL endpoint needs authentication for introspection. Add an Authorization request header, or paste or upload its schema (SDL or introspection JSON)."
                : "This GraphQL endpoint does not allow introspection. Paste or upload its schema (SDL or introspection JSON) instead.",
          },
        ],
      };
    }
    return { ...httpFailure(response.status), graphqlAnswered: false };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * The CORS fallback: asks ScrAPI's server to make the same fixed request
 * (GET the document, or POST the introspection query) and returns its answer
 * as a Response, so the rest of the loading works the same way.
 */
async function loadViaServer(
  url: URL,
  kind: "document" | "introspection",
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Response | Failure> {
  let parsed: FetchSourceResponse;
  try {
    const response = await fetch("/api/fetch-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url.toString(), kind, headers }),
      signal,
    });
    const checked = fetchSourceResponseSchema.safeParse(await response.json());
    if (!checked.success) return unreachable();
    parsed = checked.data;
  } catch {
    return signal.aborted ? timedOut() : unreachable();
  }
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  try {
    // Statuses such as 204 and 304 cannot carry a body.
    const body = [101, 103, 204, 205, 304].includes(parsed.status) ? null : parsed.body;
    return new Response(body, { status: parsed.status, headers: { "content-type": parsed.contentType } });
  } catch {
    return httpFailure(parsed.status);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHtml(contentType: string | null, text: string): boolean {
  return (contentType ?? "").toLowerCase().includes("text/html") || /^\s*</.test(text);
}

function httpFailure(status: number): Failure {
  const hint =
    status === 401 || status === 403
      ? " The API may require authentication: add an Authorization request header."
      : status === 404
        ? " Check the address of the specification."
        : "";
  return failure("http-error", `The URL answered with HTTP status ${String(status)}.${hint}`);
}

function unreachable(): Failure {
  return failure(
    "url-unreachable",
    "This URL could not be loaded: neither your browser nor ScrAPI's server could reach it. Check the address, or download the file and upload it, or paste its contents.",
  );
}

function timedOut(): Failure {
  return failure(
    "url-timeout",
    `The URL did not answer within ${String(URL_LOAD_TIMEOUT_MS / 1000)} seconds. Try again, or download the file and upload it.`,
  );
}

function tooLarge(): Failure {
  return failure("too-large", `The document at this URL is larger than ${formatMegabytes(MAX_SPEC_BYTES)}.`);
}

function failure(code: string, message: string): Failure {
  return { ok: false, errors: [{ code, message }] };
}
