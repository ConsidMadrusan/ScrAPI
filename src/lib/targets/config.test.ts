import { describe, expect, it } from "vitest";
import { isSafeArchivePath } from "@/lib/archive/safe-path";
import type { GenerationOptions } from "@/lib/validation/requests";
import { resolveTarget, toArchivePath, toDestinationPath } from "./config";

const ALL_OPTIONS: GenerationOptions[] = [
  { target: "typescript-next", httpClient: "axios" },
  { target: "typescript-next", httpClient: "fetch" },
  { target: "typescript-nuxt", httpClient: "axios" },
  { target: "typescript-nuxt", httpClient: "fetch" },
  { target: "typescript-angular" },
  { target: "csharp" },
];

describe("resolveTarget", () => {
  it.each(ALL_OPTIONS)("is complete and safe for %j", (options) => {
    const target = resolveTarget(options);
    expect(target.generator.generatorName).not.toBe("");
    expect(isSafeArchivePath(target.archiveRoot)).toBe(true);
    expect(isSafeArchivePath(target.destinationRoot)).toBe(true);
    expect(target.extensions.length).toBeGreaterThan(0);
  });

  it.each([
    [{ target: "typescript-next", httpClient: "axios" }, "typescript-axios", undefined],
    [{ target: "typescript-nuxt", httpClient: "fetch" }, "typescript-fetch", "generator-templates/typescript-fetch"],
    [{ target: "typescript-angular" }, "typescript-angular", undefined],
    [{ target: "csharp" }, "csharp", undefined],
  ] as const)("uses the verified generator for %j", (options, generatorName, templateDir) => {
    const { generator } = resolveTarget(options);
    expect(generator.generatorName).toBe(generatorName);
    expect(generator.templateDir).toBe(templateDir);
  });

  it("shares the TypeScript generation between Next.js and Nuxt", () => {
    const next = resolveTarget({ target: "typescript-next", httpClient: "fetch" });
    const nuxt = resolveTarget({ target: "typescript-nuxt", httpClient: "fetch" });
    expect(next.generator).toEqual(nuxt.generator);
    expect(next.destinationRoot).not.toBe(nuxt.destinationRoot);
  });
});

describe("toArchivePath and toDestinationPath", () => {
  const typescript = resolveTarget({ target: "typescript-next", httpClient: "fetch" });
  const csharp = resolveTarget({ target: "csharp" });

  it.each([
    ["apis/TodosApi.ts", "api-client/apis/TodosApi.ts", "src/lib/api-client/apis/TodosApi.ts"],
    ["runtime.ts", "api-client/runtime.ts", "src/lib/api-client/runtime.ts"],
    ["README.md", undefined, undefined],
    ["git_push.sh", undefined, undefined],
    [".openapi-generator/FILES", undefined, undefined],
    [".gitignore", undefined, undefined],
  ])("TypeScript: %s", (outputPath, archivePath, destinationPath) => {
    const archived = toArchivePath(typescript, outputPath);
    expect(archived).toBe(archivePath);
    if (archived) expect(toDestinationPath(typescript, archived)).toBe(destinationPath);
  });

  it.each([
    ["src/ApiClient/Api/TodosApi.cs", "ApiClient/Api/TodosApi.cs", "src/ApiClient/Api/TodosApi.cs"],
    ["src/ApiClient/ApiClient.csproj", "ApiClient/ApiClient.csproj", "src/ApiClient/ApiClient.csproj"],
    ["src/ApiClient/README.md", undefined, undefined],
    ["src/ApiClient.Test/README.md", undefined, undefined],
    ["ApiClient.sln", undefined, undefined],
    ["appveyor.yml", undefined, undefined],
    ["docs/scripts/git_push.sh", undefined, undefined],
  ])("C#: %s", (outputPath, archivePath, destinationPath) => {
    const archived = toArchivePath(csharp, outputPath);
    expect(archived).toBe(archivePath);
    if (archived) expect(toDestinationPath(csharp, archived)).toBe(destinationPath);
  });

  it("maps Nuxt and Angular to their own project layouts", () => {
    const nuxt = resolveTarget({ target: "typescript-nuxt", httpClient: "axios" });
    const angular = resolveTarget({ target: "typescript-angular" });
    expect(toDestinationPath(nuxt, "api-client/api/todos-api.ts")).toBe("app/lib/api-client/api/todos-api.ts");
    expect(toDestinationPath(angular, "api-client/api/todos.service.ts")).toBe(
      "src/app/api-client/api/todos.service.ts",
    );
  });
});
