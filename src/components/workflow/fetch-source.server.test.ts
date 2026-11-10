import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { buildSchema, graphql } from "graphql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSource } from "./fetch-source";

/**
 * The URL loader against real HTTP servers on localhost (no mocked fetch):
 * an OpenAPI document, a GraphQL endpoint that answers introspection, and one
 * that refuses it.
 */
const openapi = readFileSync(join(process.cwd(), "samples/specs/todo.yaml"), "utf8");
const schema = buildSchema(readFileSync(join(process.cwd(), "samples/specs/books.graphql"), "utf8"));

let server: Server;
let origin: string;
const receivedHeaders: Record<string, string | string[] | undefined>[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    receivedHeaders.push(request.headers);
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      void (async () => {
        if (request.url === "/openapi.yaml" && request.method === "GET") {
          response.writeHead(200, { "content-type": "application/yaml" }).end(openapi);
        } else if (request.url === "/graphql" && request.method === "POST") {
          const { query } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { query: string };
          const result = await graphql({ schema, source: query });
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
        } else if (request.url === "/locked" && request.method === "POST") {
          const body = { errors: [{ message: "Introspection is disabled" }] };
          response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify(body));
        } else {
          response.writeHead(404).end("not found");
        }
      })();
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

describe("loadSource against real servers", () => {
  it("loads a YAML OpenAPI document with GET", async () => {
    expect(await loadSource(`${origin}/openapi.yaml`, {}, "auto")).toEqual({ ok: true, text: openapi, kind: "openapi" });
  });

  it("introspects a GraphQL endpoint and returns a schema the server can build", async () => {
    const result = await loadSource(`${origin}/graphql`, { Authorization: "Bearer test" }, "auto");

    expect(result.ok && result.kind).toBe("graphql");
    if (!result.ok) return;
    const introspection = JSON.parse(result.text) as { __schema: { queryType: { name: string } } };
    expect(introspection.__schema.queryType.name).toBe("Query");
    expect(receivedHeaders.some((headers) => headers.authorization === "Bearer test")).toBe(true);
  });

  it("explains an endpoint that refuses introspection", async () => {
    expect(await loadSource(`${origin}/locked`, {}, "graphql")).toMatchObject({
      ok: false,
      errors: [{ code: "introspection-disabled" }],
    });
  });

  it("reports an address that is neither", async () => {
    expect(await loadSource(`${origin}/nothing`, {}, "auto")).toMatchObject({ ok: false, errors: [{ code: "http-error" }] });
  });
});
