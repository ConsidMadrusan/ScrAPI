import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { getIntrospectionQuery } from "graphql";
import { formatMegabytes, MAX_SPEC_BYTES, MAX_URL_REDIRECTS, URL_LOAD_TIMEOUT_MS } from "@/lib/validation/limits";
import type { Problem } from "@/lib/validation/responses";

/**
 * Server-side loading of a user-supplied URL, used only when the browser
 * cannot read it (CORS). It is not a general proxy:
 *
 * - only two fixed requests exist: GET a document, or POST the standard
 *   introspection query built here; callers choose neither method nor body;
 * - only http(s), no credentials in the URL, at most MAX_REDIRECTS redirects;
 * - every address the host resolves to (also after redirects, and checked at
 *   connect time, so DNS rebinding cannot swap it) must be public, unless
 *   SCRAPI_ALLOW_PRIVATE_URLS=true allows private and local networks;
 * - time and size limits, and no logging of URLs, headers, or content.
 */

export type FetchKind = "document" | "introspection";

export interface FetchedResponse {
  status: number;
  contentType: string;
  body: string;
}

export type FetchUrlResult = { ok: true; value: FetchedResponse } | { ok: false; errors: Problem[] };

/** Same limit as in the browser, so both ways of loading behave alike. */
export const SERVER_FETCH_TIMEOUT_MS = URL_LOAD_TIMEOUT_MS;
const MAX_REDIRECTS = MAX_URL_REDIRECTS;

/** Request headers ScrAPI sets itself or that would change the connection; users cannot set them. */
const RESERVED_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
  "content-type",
  "keep-alive",
  "proxy-authorization",
  "te",
  "upgrade",
  "expect",
]);

/** Address ranges that are not on the public internet (RFC 6890 and related). */
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, including cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv6");
}

/** Whether private and local addresses may be loaded: for local or internal deployments only. */
export function allowsPrivateUrls(): boolean {
  return process.env.SCRAPI_ALLOW_PRIVATE_URLS === "true";
}

/** True for addresses on the public internet. IPv4-mapped IPv6 addresses are checked as IPv4. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped !== undefined) return isPublicAddress(mapped);
  const family = isIP(address);
  if (family === 0) return false;
  return !NON_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}

class FetchProblem extends Error {
  constructor(readonly problem: Problem) {
    super(problem.message);
  }
}

/** Loads the URL with one of the two fixed requests, following redirects within the limits. */
export async function fetchUrl(
  urlText: string,
  kind: FetchKind,
  userHeaders: Record<string, string>,
  signal?: AbortSignal,
): Promise<FetchUrlResult> {
  const deadline = AbortSignal.timeout(SERVER_FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const headers = checkHeaders(userHeaders);
    let url = checkUrl(urlText);
    for (let redirects = 0; ; redirects += 1) {
      const response = await send(url, kind, headers, combined);
      const location = response.headers.location;
      // Redirects keep the request as it is: an introspection POST is sent again
      // as a POST, even after 301/302 (where browsers switch to GET). That is
      // intended: endpoints that redirect, e.g. from http:// to https://, still
      // answer the introspection query instead of failing with a GET.
      if (response.statusCode !== undefined && response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) {
          throw new FetchProblem({ code: "too-many-redirects", message: "The URL redirects too many times." });
        }
        url = checkUrl(new URL(location, url).toString());
        continue;
      }
      const body = await readBody(response, combined);
      return {
        ok: true,
        value: { status: response.statusCode ?? 0, contentType: response.headers["content-type"] ?? "", body },
      };
    }
  } catch (error) {
    if (error instanceof FetchProblem) return { ok: false, errors: [error.problem] };
    if (deadline.aborted) {
      return failure(
        "url-timeout",
        `The URL did not answer within ${String(SERVER_FETCH_TIMEOUT_MS / 1000)} seconds. Try again, or download the file and upload it.`,
      );
    }
    return failure("url-unreachable", unreachableMessage(error));
  }
}

/**
 * Why the server could not reach the URL, from the network error's code only
 * (never its message, which contains the address). Unknown codes get the
 * general message.
 */
export function unreachableMessage(error: unknown): string {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
  const advice = "Check the address, or download the file and upload it.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `ScrAPI's server could not find this host name. ${advice}`;
  }
  if (code === "ECONNREFUSED") {
    return `The host refused the connection: nothing answers on that port. ${advice}`;
  }
  if (code === "ECONNRESET" || code === "EPIPE") {
    return `The host closed the connection before answering. Try again, or download the file and upload it.`;
  }
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return `ScrAPI's server has no network route to this host. ${advice}`;
  }
  if (code.startsWith("CERT_") || code.startsWith("ERR_TLS_") || code.includes("SELF_SIGNED") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return "The host's HTTPS certificate is not trusted (for example self-signed or expired). Download the file and upload it instead.";
  }
  return `ScrAPI's server could not reach this URL. ${advice}`;
}

function checkUrl(text: string): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new FetchProblem({ code: "invalid-url", message: "Enter a complete http:// or https:// URL." });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchProblem({ code: "invalid-url", message: "Only http:// and https:// URLs can be loaded." });
  }
  if (url.username !== "" || url.password !== "") {
    throw new FetchProblem({
      code: "invalid-url",
      message: "Do not put a user name or password in the URL. Add an Authorization request header instead.",
    });
  }
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) !== 0) checkAddress(literal);
  else if (!allowsPrivateUrls() && /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(literal)) {
    throw privateAddress();
  }
  return url;
}

function checkAddress(address: string): void {
  if (!allowsPrivateUrls() && !isPublicAddress(address)) throw privateAddress();
}

function privateAddress(): FetchProblem {
  return new FetchProblem({
    code: "private-url",
    message:
      "ScrAPI's server only loads public internet addresses, and your browser could not load this one (CORS). Download the file and upload it, or paste its contents. For APIs on your machine or company network, run ScrAPI there with SCRAPI_ALLOW_PRIVATE_URLS=true.",
  });
}

function checkHeaders(headers: Record<string, string>): Record<string, string> {
  const checked: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n\0]/.test(value)) {
      throw new FetchProblem({ code: "invalid-headers", message: `The request header "${name}" is not valid.` });
    }
    if (RESERVED_HEADERS.has(name.toLowerCase())) {
      throw new FetchProblem({
        code: "invalid-headers",
        message: `The request header "${name}" is set by ScrAPI and cannot be added.`,
      });
    }
    checked[name] = value;
  }
  return checked;
}

/** Resolves the host and refuses non-public addresses at connect time (no DNS rebinding window). */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const allowed = allowsPrivateUrls() ? addresses : addresses.filter((entry) => isPublicAddress(entry.address));
    if (allowed.length === 0 || allowed.length !== addresses.length) {
      callback(privateAddress(), "", 0);
      return;
    }
    if (options.all === true) callback(null, allowed);
    else {
      const [first] = allowed;
      callback(null, first?.address ?? "", first?.family ?? 4);
    }
  });
};

function send(url: URL, kind: FetchKind, headers: Record<string, string>, signal: AbortSignal): Promise<IncomingMessage> {
  const body = kind === "introspection" ? JSON.stringify({ query: getIntrospectionQuery({ descriptions: true }) }) : undefined;
  const options: RequestOptions = {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...headers,
      accept: body === undefined ? "application/json, application/yaml, text/yaml, */*;q=0.5" : "application/json",
      "accept-encoding": "identity",
      ...(body === undefined ? {} : { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }),
    },
    lookup: safeLookup,
    signal,
  };
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, options, resolve);
    request.on("error", (error) => {
      reject(error instanceof FetchProblem ? error : (error.cause instanceof FetchProblem ? error.cause : error));
    });
    request.end(body);
  });
}

function readBody(response: IncomingMessage, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // An abort before this point fires no event, so it is checked here.
    if (signal.aborted) {
      response.destroy();
      reject(new Error("aborted"));
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    const onAbort = () => {
      response.destroy();
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    response.on("data", (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > MAX_SPEC_BYTES) {
        signal.removeEventListener("abort", onAbort);
        response.destroy();
        reject(
          new FetchProblem({
            code: "too-large",
            message: `The document at this URL is larger than ${formatMegabytes(MAX_SPEC_BYTES)}.`,
          }),
        );
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => {
      signal.removeEventListener("abort", onAbort);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    response.on("error", (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

function failure(code: string, message: string): FetchUrlResult {
  return { ok: false, errors: [{ code, message }] };
}
