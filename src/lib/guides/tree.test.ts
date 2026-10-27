import { describe, expect, it } from "vitest";
import { renderTree } from "./tree";

describe("renderTree", () => {
  it("draws folders before files, sorted, relative to the root", () => {
    const tree = renderTree("src/lib/api-client", [
      "src/lib/api-client/index.ts",
      "src/lib/api-client/models/Todo.ts",
      "src/lib/api-client/apis/TodosApi.ts",
      "src/lib/api-client/models/NewTodo.ts",
      "src/lib/api-client/runtime.ts",
    ]);

    expect(tree).toBe(
      [
        "src/lib/api-client/",
        "├── apis/",
        "│   └── TodosApi.ts",
        "├── models/",
        "│   ├── NewTodo.ts",
        "│   └── Todo.ts",
        "├── index.ts",
        "└── runtime.ts",
      ].join("\n"),
    );
  });
});
