import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateResult } from "@/lib/generation/generate";
import type { PreparedGeneration } from "@/lib/generation/prepare";
import { generateResponseSchema } from "@/lib/validation/responses";

const generateClientMock = vi.hoisted(() =>
  vi.fn<(prepared: PreparedGeneration) => Promise<GenerateResult>>(),
);
vi.mock("@/lib/generation/generate", () => ({ generateClient: generateClientMock }));

const { POST } = await import("./route");

const todo = readFileSync(join(process.cwd(), "samples/specs/todo.json"), "utf8");

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const request = {
  spec: todo,
  options: { target: "csharp" },
  selection: [{ method: "get", path: "/todos" }],
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/generate", () => {
  it("revalidates the request and returns the generation result", async () => {
    generateClientMock.mockImplementation((prepared) =>
      Promise.resolve({
        ok: true,
        value: {
          ok: true,
          options: prepared.options,
          archiveRoot: "ApiClient",
          destinationRoot: "src/ApiClient",
          operations: prepared.selected,
          files: [{ archivePath: "ApiClient/A.cs", destinationPath: "src/ApiClient/A.cs", content: "" }],
        },
      }),
    );

    const response = await post(request);

    expect(response.status).toBe(200);
    const body = generateResponseSchema.parse(await response.json());
    expect(body.ok && body.operations.map((operation) => operation.id)).toEqual(["GET /todos"]);
    const prepared = generateClientMock.mock.calls[0]?.[0];
    expect(prepared?.filteredSpec.paths).toHaveProperty(["/todos", "get"]);
    expect(prepared?.filteredSpec.paths).not.toHaveProperty(["/todos", "post"]);
  });

  it("rejects unknown operations before generating", async () => {
    const response = await post({ ...request, selection: [{ method: "patch", path: "/todos" }] });

    expect(response.status).toBe(422);
    expect(generateResponseSchema.parse(await response.json())).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: "unknown-operations" })],
    });
    expect(generateClientMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...request, selection: [] }],
    [{ ...request, options: { target: "typescript-next" } }],
    [{ ...request, options: { target: "rust" } }],
  ])("rejects invalid generation options %#", async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(generateClientMock).not.toHaveBeenCalled();
  });

  it("passes generator failures through with their status", async () => {
    generateClientMock.mockResolvedValue({
      ok: false,
      status: 422,
      errors: [{ code: "generation-timeout", message: "Generation took too long." }],
    });

    const response = await post(request);
    expect(response.status).toBe(422);
  });

  it("hides unexpected errors behind a generic message", async () => {
    generateClientMock.mockRejectedValue(new Error("/tmp/scrapi-abc: secret details"));

    const response = await post(request);

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("/tmp");
  });
});
