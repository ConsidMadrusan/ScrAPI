import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type * as Dns from "node:dns";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_SPEC_BYTES } from "@/lib/validation/limits";

/** Hostnames the mocked resolver answers; anything else uses the real resolver. */
const fakeDns = vi.hoisted(() => new Map<string, string>());
vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof Dns>();
  return {
    ...actual,
    lookup: ((hostname: string, options: object, callback: (error: Error | null, addresses: unknown) => void) => {
      const address = fakeDns.get(hostname);
      if (address === undefined) {
        actual.lookup(hostname, options as never, callback as never);
        return;
      }
      callback(null, [{ address, family: address.includes(":") ? 6 : 4 }]);
    }) as typeof actual.lookup,
  };
});

const { fetchUrl, isPublicAddress } = await import("./fetch-url");

let server: Server;
let origin: string;
let lastRequest: { method: string | undefined; headers: IncomingHttpHeaders; body: string } | undefined;

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      lastRequest = { method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") };
      if (request.url === "/spec.json") {
        response.writeHead(200, { "content-type": "application/json" }).end('{"openapi":"3.0.3"}');
      } else if (request.url === "/redirect") {
        response.writeHead(302, { location: "/spec.json" }).end();
      } else if (request.url === "/loop") {
        response.writeHead(302, { location: "/loop" }).end();
      } else if (request.url === "/huge") {
        response.writeHead(200).end("x".repeat(MAX_SPEC_BYTES + 10));
      } else {
        response.writeHead(404).end("missing");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  fakeDns.clear();
});

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "93.184.215.14", "2606:4700:4700::1111"])("accepts the public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "not-an-ip",
  ])("refuses the non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("fetchUrl", () => {
  it("refuses private addresses by default", async () => {
    expect(await fetchUrl(`${origin}/spec.json`, "document", {})).toMatchObject({
      ok: false,
      errors: [{ code: "private-url" }],
    });
    expect(await fetchUrl("http://localhost:1/spec.json", "document", {})).toMatchObject({
      ok: false,
      errors: [{ code: "private-url" }],
    });
  });

  it("refuses host names that resolve to private addresses, checked when connecting", async () => {
    fakeDns.set("api.example.test", "10.0.0.7");
    expect(await fetchUrl("http://api.example.test/spec.json", "document", {})).toMatchObject({
      ok: false,
      errors: [{ code: "private-url" }],
    });
  });

  describe("with SCRAPI_ALLOW_PRIVATE_URLS=true", () => {
    it("loads a document with GET and forwards the user's headers", async () => {
      vi.stubEnv("SCRAPI_ALLOW_PRIVATE_URLS", "true");

      const result = await fetchUrl(`${origin}/spec.json`, "document", { Authorization: "Bearer abc" });

      expect(result).toEqual({
        ok: true,
        value: { status: 200, contentType: "application/json", body: '{"openapi":"3.0.3"}' },
      });
      expect(lastRequest?.method).toBe("GET");
      expect(lastRequest?.headers.authorization).toBe("Bearer abc");
    });

    it("sends only the fixed introspection query for GraphQL", async () => {
      vi.stubEnv("SCRAPI_ALLOW_PRIVATE_URLS", "true");

      await fetchUrl(`${origin}/graphql`, "introspection", {});

      expect(lastRequest?.method).toBe("POST");
      expect((JSON.parse(lastRequest?.body ?? "{}") as { query: string }).query).toContain("__schema");
    });

    it("follows redirects within the limit", async () => {
      vi.stubEnv("SCRAPI_ALLOW_PRIVATE_URLS", "true");
      expect(await fetchUrl(`${origin}/redirect`, "document", {})).toMatchObject({ ok: true, value: { status: 200 } });
      expect(await fetchUrl(`${origin}/loop`, "document", {})).toMatchObject({
        ok: false,
        errors: [{ code: "too-many-redirects" }],
      });
    });

    it("stops reading answers over the size limit", async () => {
      vi.stubEnv("SCRAPI_ALLOW_PRIVATE_URLS", "true");
      expect(await fetchUrl(`${origin}/huge`, "document", {})).toMatchObject({
        ok: false,
        errors: [{ code: "too-large" }],
      });
    });

    it("returns HTTP errors as answers, for the browser to explain", async () => {
      vi.stubEnv("SCRAPI_ALLOW_PRIVATE_URLS", "true");
      expect(await fetchUrl(`${origin}/missing`, "document", {})).toMatchObject({ ok: true, value: { status: 404 } });
    });
  });

  it("rejects headers that ScrAPI sets itself or that are malformed", async () => {
    expect(await fetchUrl("https://api.example.com/spec.json", "document", { Host: "internal" })).toMatchObject({
      ok: false,
      errors: [{ code: "invalid-headers" }],
    });
    expect(await fetchUrl("https://api.example.com/spec.json", "document", { "X-A": "b\r\nX-Injected: c" })).toMatchObject({
      ok: false,
      errors: [{ code: "invalid-headers" }],
    });
  });

  it("rejects other schemes and credentials in the URL", async () => {
    expect(await fetchUrl("file:///etc/passwd", "document", {})).toMatchObject({ ok: false, errors: [{ code: "invalid-url" }] });
    expect(await fetchUrl("https://user:secret@api.example.com/", "document", {})).toMatchObject({
      ok: false,
      errors: [{ code: "invalid-url" }],
    });
  });
});
