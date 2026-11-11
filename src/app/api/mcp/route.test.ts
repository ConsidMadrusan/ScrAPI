import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateResult } from "@/lib/generation/generate";
import type { PreparedGeneration } from "@/lib/generation/prepare";
import { TOOL_NAMES } from "@/lib/mcp/server";
import { combinationKey, COMBINATIONS } from "@/lib/targets/catalog";
import { resolveTarget } from "@/lib/targets/config";

const generateClientMock = vi.hoisted(() =>
  vi.fn<(prepared: PreparedGeneration) => Promise<GenerateResult>>(),
);
vi.mock("@/lib/generation/generate", () => ({ generateClient: generateClientMock }));

const busy = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/generation/java-generator", () => ({ isGeneratorBusy: () => busy.value }));

/** URL loading on the server, replaced so no test touches the network. */
const loadUrlSourceMock = vi.hoisted(() =>
  vi.fn<
    (url: string, headers: Record<string, string>, kind: string) => Promise<
      { ok: true; text: string; kind: "openapi" | "graphql" } | { ok: false; errors: { code: string; message: string }[] }
    >
  >(),
);
vi.mock("@/lib/source/load-url", () => ({ loadUrlSource: loadUrlSourceMock }));

const { POST, GET } = await import("./route");

const spec = (name: string) => readFileSync(join(process.cwd(), "samples/specs", name), "utf8");
const todo = spec("todo.json");

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

let nextId = 1;

/** Sends one JSON-RPC request the way an MCP client does and returns its `result` or `error`. */
async function rpc(
  method: string,
  params: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: { result?: unknown; error?: { message: string } } }> {
  const response = await POST(
    new Request("http://localhost:13000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
  const text = await response.text();
  const data = text.startsWith("{") ? text : (text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) ?? "{}");
  return { status: response.status, body: JSON.parse(data) as { result?: unknown; error?: { message: string } } };
}

async function callTool(name: string, args: unknown): Promise<ToolResult> {
  const { body } = await rpc("tools/call", { name, arguments: args });
  return body.result as ToolResult;
}

function firstJson(result: ToolResult): unknown {
  return JSON.parse(result.content[0]?.text ?? "null");
}

/** A fake OpenAPI generator result with one file in the target's real destination folder. */
function fakeGeneration(content = "export {};\n") {
  generateClientMock.mockImplementation((prepared) => {
    const target = resolveTarget(prepared.options);
    return Promise.resolve({
      ok: true,
      value: {
        ok: true,
        options: prepared.options,
        archiveRoot: target.archiveRoot,
        destinationRoot: target.destinationRoot,
        operations: prepared.selected,
        files: [
          {
            archivePath: `${target.archiveRoot}/index.ts`,
            destinationPath: `${target.destinationRoot}/index.ts`,
            content,
          },
        ],
      },
    });
  });
}

interface GenerateFiles {
  kind: string;
  results: { combination: string; files: { destinationPath: string; content: string }[] }[];
  failures: { combination: string; problems: { message: string }[] }[];
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  generateClientMock.mockReset();
  loadUrlSourceMock.mockReset();
  busy.value = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/mcp transport", () => {
  it("initializes as the scrapi server with instructions", async () => {
    const { status, body } = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });

    expect(status).toBe(200);
    expect(body.result).toMatchObject({ serverInfo: { name: "scrapi" }, instructions: expect.stringContaining("scrapi_generate") as unknown });
  });

  it("lists exactly the ScrAPI tools", async () => {
    const { body } = await rpc("tools/list", {});

    const names = (body.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(names).toEqual([...TOOL_NAMES]);
  });

  it("rejects a browser request from another origin", async () => {
    const { status } = await rpc("tools/list", {}, { origin: "http://attacker.example" });

    expect(status).toBe(403);
  });

  it("accepts a browser request from its own origin", async () => {
    const { status } = await rpc("tools/list", {}, { origin: "http://localhost:13000" });

    expect(status).toBe(200);
  });

  it("answers GET with 405 because it keeps no sessions", async () => {
    const response = await GET(new Request("http://localhost:13000/api/mcp", { headers: { accept: "text/event-stream" } }));

    expect(response.status).toBe(405);
  });
});

describe("scrapi_list_targets", () => {
  it("lists every combination with its destination folder", async () => {
    const result = await callTool("scrapi_list_targets", {});

    const { combinations } = firstJson(result) as { combinations: { combination: string; destinationRoot: string }[] };
    expect(combinations.map((entry) => entry.combination)).toEqual(COMBINATIONS.map(combinationKey));
    expect(combinations).toContainEqual(expect.objectContaining({ combination: "csharp", destinationRoot: "src/ApiClient" }));
  });
});

describe("scrapi_validate", () => {
  it.each([
    ["todo.json", []],
    ["todo.yaml", ["yaml"]],
    ["todo-swagger2.json", ["swagger-2"]],
  ])("lists the operations of %s", async (file, conversions) => {
    const result = await callTool("scrapi_validate", { source: spec(file) });

    expect(result.isError).toBeFalsy();
    const body = firstJson(result) as { kind: string; conversions: string[]; groups: { operations: { id: string }[] }[] };
    expect(body.kind).toBe("openapi");
    expect(body.conversions).toEqual(conversions);
    expect(body.groups.flatMap((group) => group.operations.map((operation) => operation.id))).toContain("GET /todos");
  });

  it("lists the root fields of a GraphQL schema", async () => {
    const result = await callTool("scrapi_validate", { source: spec("books.graphql") });

    const body = firstJson(result) as { kind: string; groups: { name: string; operations: { id: string }[] }[] };
    expect(body.kind).toBe("graphql");
    expect(body.groups.map((group) => group.name)).toEqual(["Queries", "Mutations"]);
    expect(body.groups[0]?.operations.map((operation) => operation.id)).toContain("query books");
  });

  it("reports an invalid description as a tool error", async () => {
    const result = await callTool("scrapi_validate", { source: '{"openapi": "3.0.3"}' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("ScrAPI could not complete the request");
  });
});

describe("scrapi_generate", () => {
  it("returns each file at its destination path and the guide", async () => {
    fakeGeneration();

    const result = await callTool("scrapi_generate", {
      source: todo,
      combinations: ["csharp", "nextjs-axios"],
      operations: ["get /todos"],
    });

    expect(result.isError).toBeFalsy();
    const files = firstJson(result) as GenerateFiles;
    expect(files.results.map((entry) => entry.combination)).toEqual(["nextjs-axios", "csharp"]);
    expect(files.results[0]?.files[0]?.destinationPath).toBe("src/lib/api-client/index.ts");
    expect(files.failures).toEqual([]);
    expect(result.content[1]?.text).toMatch(/^# /);
    const prepared = generateClientMock.mock.calls[0]?.[0];
    expect(prepared?.selected.map((operation) => operation.id)).toEqual(["GET /todos"]);
  });

  it("generates every operation when allOperations is set", async () => {
    fakeGeneration();

    await callTool("scrapi_generate", { source: todo, combinations: ["angular"], allOperations: true });

    expect(generateClientMock.mock.calls[0]?.[0].selected).toHaveLength(5);
  });

  it("rejects operations that are not in the description", async () => {
    const result = await callTool("scrapi_generate", {
      source: todo,
      combinations: ["csharp"],
      operations: ["GET /todos", "GET /nope"],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("GET /nope");
    expect(generateClientMock).not.toHaveBeenCalled();
  });

  it("rejects an empty selection", async () => {
    const result = await callTool("scrapi_generate", { source: todo, combinations: ["csharp"], operations: [] });

    expect(result.isError).toBe(true);
    expect(generateClientMock).not.toHaveBeenCalled();
  });

  it("rejects operations and allOperations together", async () => {
    const result = await callTool("scrapi_generate", {
      source: todo,
      combinations: ["csharp"],
      operations: ["GET /todos"],
      allOperations: true,
    });

    expect(result.isError).toBe(true);
  });

  it("keeps the successful combinations when one fails", async () => {
    fakeGeneration();
    generateClientMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 500, errors: [{ code: "generator-failed", message: "Generation failed." }] }),
    );

    const result = await callTool("scrapi_generate", {
      source: todo,
      combinations: ["nextjs-fetch", "csharp"],
      operations: ["GET /todos"],
    });

    const files = firstJson(result) as GenerateFiles;
    expect(files.results.map((entry) => entry.combination)).toEqual(["csharp"]);
    expect(files.failures).toEqual([
      expect.objectContaining({ combination: "nextjs-fetch", problems: [expect.objectContaining({ message: "Generation failed." })] }),
    ]);
  });

  it("reports a busy generator", async () => {
    busy.value = true;

    const result = await callTool("scrapi_generate", { source: todo, combinations: ["csharp"], allOperations: true });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("busy");
  });

  it("refuses a result too large for an agent's context", async () => {
    fakeGeneration("x".repeat(3 * 1024 * 1024));

    const result = await callTool("scrapi_generate", { source: todo, combinations: ["csharp"], allOperations: true });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Select fewer operations");
  });

  it("generates a GraphQL client in process", async () => {
    const result = await callTool("scrapi_generate", {
      source: spec("books.graphql"),
      combinations: ["nextjs-fetch"],
      operations: ["Query books"],
    });

    expect(result.isError).toBeFalsy();
    const files = firstJson(result) as GenerateFiles;
    expect(files.kind).toBe("graphql");
    expect(files.results[0]?.files.map((file) => file.destinationPath)).toContain("src/lib/api-client/graphql.ts");
    expect(generateClientMock).not.toHaveBeenCalled();
  });
});

describe("loading the description from a URL", () => {
  const ENDPOINT = "https://api.example.com/graphql";
  const introspection = JSON.stringify({ __schema: (JSON.parse(spec("books-introspection.json")) as { data: { __schema: unknown } }).data.__schema });

  it("validates a GraphQL endpoint that ScrAPI's server introspects", async () => {
    loadUrlSourceMock.mockResolvedValue({ ok: true, text: introspection, kind: "graphql" });

    const result = await callTool("scrapi_validate", { url: ENDPOINT, headers: { Authorization: "Bearer t" } });

    expect(result.isError).toBeFalsy();
    const body = firstJson(result) as { kind: string; groups: { operations: { id: string }[] }[] };
    expect(body.kind).toBe("graphql");
    expect(body.groups[0]?.operations.map((operation) => operation.id)).toContain("query books");
    expect(loadUrlSourceMock).toHaveBeenCalledWith(ENDPOINT, { Authorization: "Bearer t" }, "auto", expect.anything());
  });

  it("generates from a URL with the requested kind", async () => {
    loadUrlSourceMock.mockResolvedValue({ ok: true, text: introspection, kind: "graphql" });

    const result = await callTool("scrapi_generate", {
      url: ENDPOINT,
      kind: "graphql",
      combinations: ["nextjs-fetch"],
      operations: ["query books"],
    });

    expect(result.isError).toBeFalsy();
    expect((firstJson(result) as GenerateFiles).results[0]?.files.map((file) => file.destinationPath)).toContain(
      "src/lib/api-client/graphql.ts",
    );
    expect(loadUrlSourceMock).toHaveBeenCalledWith(ENDPOINT, {}, "graphql", expect.anything());
  });

  it("reports why the URL could not be loaded", async () => {
    loadUrlSourceMock.mockResolvedValue({
      ok: false,
      errors: [{ code: "blocked-address", message: "This URL points to a private or local network address." }],
    });

    const result = await callTool("scrapi_validate", { url: "http://10.0.0.1/openapi.json" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("private or local network address");
  });

  it("words loading problems for an agent, not for the web app", async () => {
    loadUrlSourceMock.mockResolvedValue({
      ok: false,
      errors: [
        { code: "private-url", message: "ScrAPI's server only loads public internet addresses, and your browser could not load this one (CORS)." },
        { code: "url-timeout", message: "The URL did not answer within 20 seconds. Try again, or download the file and upload it." },
      ],
    });

    const result = await callTool("scrapi_validate", { url: "http://localhost:8080/openapi.json" });

    const text = result.content[0]?.text ?? "";
    expect(text).not.toMatch(/browser|upload/);
    expect(text).toContain("pass its contents as source");
    expect(text).toContain("SCRAPI_ALLOW_PRIVATE_URLS=true");
  });

  it("rejects both source and url", async () => {
    const result = await callTool("scrapi_validate", { source: todo, url: ENDPOINT });

    expect(result.isError).toBe(true);
    expect(loadUrlSourceMock).not.toHaveBeenCalled();
  });

  it("rejects neither source nor url", async () => {
    const result = await callTool("scrapi_generate", { combinations: ["csharp"], allOperations: true });

    expect(result.isError).toBe(true);
  });
});
