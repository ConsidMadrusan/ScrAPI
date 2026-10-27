import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isJsonObject } from "@/lib/openapi/json";
import { prepareGeneration } from "./prepare";

const todo = readFileSync(join(process.cwd(), "samples/specs/todo.json"), "utf8");

describe("prepareGeneration", () => {
  it("revalidates the selection and filters a separate copy of the specification", async () => {
    const result = await prepareGeneration({
      spec: todo,
      options: { target: "typescript-next", httpClient: "fetch" },
      selection: [
        { method: "delete", path: "/todos/{todoId}" },
        { method: "get", path: "/todos" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.options).toEqual({ target: "typescript-next", httpClient: "fetch" });
    expect(result.value.selected.map((operation) => operation.id)).toEqual([
      "GET /todos",
      "DELETE /todos/{todoId}",
    ]);
    const paths = result.value.filteredSpec.paths;
    expect(isJsonObject(paths) ? Object.keys(paths) : []).toEqual(["/todos", "/todos/{todoId}"]);
    const todos = isJsonObject(paths) ? paths["/todos"] : undefined;
    expect(isJsonObject(todos) ? Object.keys(todos) : []).toEqual(["get"]);
  });

  it("rejects operations that are not in the specification", async () => {
    const result = await prepareGeneration({
      spec: todo,
      options: { target: "csharp" },
      selection: [{ method: "patch", path: "/todos" }],
    });
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "unknown-operations",
          message: "These operations are not in the specification: PATCH /todos.",
        },
      ],
    });
  });

  it("rejects an empty selection even if the schema check was skipped", async () => {
    const result = await prepareGeneration({ spec: todo, options: { target: "csharp" }, selection: [] });
    expect(result).toEqual({
      ok: false,
      errors: [{ code: "empty-selection", message: "Select at least one operation." }],
    });
  });

  it("returns specification errors instead of generating", async () => {
    const result = await prepareGeneration({
      spec: '{"swagger": "2.0"}',
      options: { target: "csharp" },
      selection: [{ method: "get", path: "/todos" }],
    });
    expect(result).toEqual({ ok: false, errors: [expect.objectContaining({ code: "swagger-2" })] });
  });
});
