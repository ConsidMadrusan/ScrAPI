import { describe, expect, it } from "vitest";
import { ALL_OPTIONS, generationResult, TODO_OPERATIONS } from "@/test/generation-fixtures";
import { renderGuideMarkdown } from "./markdown";
import { renderGuide } from "./render";
import type { Guide, GuideBlock } from "./types";
import { camelCase, findUsageExample, pascalCase } from "./usage";

function blocks(guide: Guide): GuideBlock[] {
  return guide.steps.flatMap((step) => step.blocks);
}

function codeAndCommands(guide: Guide): string {
  return blocks(guide)
    .map((block) => (block.kind === "code" ? block.code : block.kind === "command" ? block.command : ""))
    .join("\n");
}

describe("renderGuide", () => {
  it.each(ALL_OPTIONS)("covers every generated file exactly once for %j", (options) => {
    const result = generationResult(options);
    const guide = renderGuide(result);
    const markdown = renderGuideMarkdown(guide, result);

    const mappingRows = markdown.split("\n").filter((line) => line.startsWith("| `"));
    expect(mappingRows).toEqual(
      result.files.map((file) => `| \`${file.archivePath}\` | \`${file.destinationPath}\` |`),
    );
    expect(blocks(guide).filter((block) => block.kind === "files")).toHaveLength(1);
    expect(markdown).toContain(`to \`${result.destinationRoot}/\``);
  });

  it.each(ALL_OPTIONS)("calls a method that exists in the generated files for %j", (options) => {
    const result = generationResult(options);
    const guide = renderGuide(result);
    const usage = findUsageExample(result);

    expect(usage?.operation.id).toBe("GET /todos");
    const code = blocks(guide).find((block) => block.kind === "code" && block.action === "create");
    expect(code?.kind === "code" ? code.code : "").toContain(`.${usage?.methodName ?? "?"}()`);
    const declaringFile = result.files.find((file) => file.content.includes(` ${usage?.methodName ?? "?"}(`));
    expect(declaringFile).toBeDefined();
  });

  it.each(ALL_OPTIONS)("lists every placeholder used in code and nothing else for %j", (options) => {
    const guide = renderGuide(generationResult(options));
    const used = new Set(codeAndCommands(guide).match(/<[A-Za-z_]+>/g));
    expect(new Set(guide.placeholders.map((placeholder) => placeholder.token))).toEqual(used);
  });

  it("separates new files from edits to existing files", () => {
    const actions = (options: (typeof ALL_OPTIONS)[number]) =>
      blocks(renderGuide(generationResult(options))).flatMap((block) =>
        block.kind === "code" ? [`${block.action} ${block.file}`] : [],
      );

    expect(actions({ target: "typescript-next", httpClient: "axios" })).toEqual([
      "create src/lib/todos-api-example.ts",
    ]);
    expect(actions({ target: "typescript-angular" })).toEqual([
      "edit src/app/app.config.ts",
      "create src/app/list-todos-example.ts",
    ]);
    expect(actions({ target: "csharp" })).toEqual([
      "edit <YourProject>/Program.cs",
      "create <YourProject>/TodosApiExample.cs",
    ]);
  });

  it("uses the framework's import alias and the right response handling", () => {
    const code = (options: (typeof ALL_OPTIONS)[number]) => codeAndCommands(renderGuide(generationResult(options)));

    expect(code({ target: "typescript-next", httpClient: "axios" })).toContain(
      'import { Configuration, TodosApi } from "@/lib/api-client";',
    );
    expect(code({ target: "typescript-next", httpClient: "axios" })).toContain("return response.data;");
    expect(code({ target: "typescript-nuxt", httpClient: "fetch" })).toContain(
      'import { Configuration, TodosApi } from "~/lib/api-client";',
    );
    expect(code({ target: "typescript-nuxt", httpClient: "fetch" })).toContain("return todosApi.listTodos();");
  });

  it("asks for axios only when axios was chosen", () => {
    const commands = (httpClient: "axios" | "fetch") =>
      codeAndCommands(renderGuide(generationResult({ target: "typescript-next", httpClient })));
    expect(commands("axios")).toContain("npm install axios");
    expect(commands("fetch")).not.toContain("npm install");
  });

  it("installs a type checker before nuxi typecheck, only for Nuxt", () => {
    const commands = (target: "typescript-next" | "typescript-nuxt") =>
      codeAndCommands(renderGuide(generationResult({ target, httpClient: "fetch" })));
    expect(commands("typescript-nuxt")).toContain("npm install --save-dev vue-tsc typescript@^6\nnpx nuxi typecheck");
    expect(commands("typescript-next")).not.toContain("vue-tsc");
  });

  it("lists the NuGet packages from the generated project file", () => {
    const guide = renderGuide(generationResult({ target: "csharp" }));
    expect(blocks(guide)).toContainEqual({
      kind: "list",
      items: ["Microsoft.Extensions.Http 10.0.1", "Microsoft.Extensions.Hosting 10.0.1"],
    });
  });

  it("marks calls that still need arguments and shows the generated signature", () => {
    const needsInput = TODO_OPERATIONS.filter((operation) => operation.requiresInput);
    const result = generationResult({ target: "typescript-next", httpClient: "fetch" }, needsInput);

    const all = codeAndCommands(renderGuide(result));

    expect(all).toContain("todosApi.getTodo(/* TODO: required arguments */)");
    expect(all).toContain(
      "getTodo(requestParameters: GetTodoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction)",
    );
  });

  it("shows no example rather than guessing when no method can be found", () => {
    const withoutIds = TODO_OPERATIONS.map((operation) => {
      const copy = { ...operation };
      delete copy.operationId;
      return copy;
    });
    const guide = renderGuide(generationResult({ target: "csharp" }, withoutIds));

    expect(blocks(guide).some((block) => block.kind === "code" && block.action === "create")).toBe(false);
    expect(JSON.stringify(guide)).toContain("could not match a selected operation");
  });

  it("skips operations whose generated method is not in the files", () => {
    const renamed = TODO_OPERATIONS.map((operation) =>
      operation.id === "GET /todos" ? { ...operation, operationId: "somethingElse" } : operation,
    );
    const usage = findUsageExample(generationResult({ target: "typescript-angular" }, renamed));
    expect(usage?.methodName).toBe("getTodo");
  });

  it("is deterministic", () => {
    const result = generationResult({ target: "csharp" });
    expect(renderGuide(result)).toEqual(renderGuide(structuredClone(result)));
  });
});

describe("name conversion", () => {
  it.each([
    ["listTodos", "listTodos", "ListTodos"],
    ["list_todos", "listTodos", "ListTodos"],
    ["list-todos", "listTodos", "ListTodos"],
    ["ListTodos", "listTodos", "ListTodos"],
  ])("%s", (input, camel, pascal) => {
    expect(camelCase(input)).toBe(camel);
    expect(pascalCase(input)).toBe(pascal);
  });
});
