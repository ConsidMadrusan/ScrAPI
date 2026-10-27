import type { GenerationOptions } from "@/lib/validation/requests";

/** How to run OpenAPI Generator for a target. All values are fixed, never user input. */
export interface GeneratorSettings {
  generatorName: string;
  additionalProperties: Readonly<Record<string, string>>;
  /** Template override folder, relative to the application root. */
  templateDir?: string;
}

/** Everything ScrAPI needs to generate, package, and place one target's output. */
export interface TargetConfig {
  generator: GeneratorSettings;
  /** Top folder of the generated files inside the ZIP. */
  archiveRoot: string;
  /** Where `archiveRoot` goes in the supported project layout. */
  destinationRoot: string;
  /** Generator output folder (relative, `/`-separated, may be empty) that holds the files to keep. */
  sourceDir: string;
  /** File extensions to keep from `sourceDir`. Everything else is generator scaffolding. */
  extensions: readonly string[];
}

/** Generator global properties for every target: no generated docs or tests. */
export const GLOBAL_PROPERTIES = "apiTests=false,modelTests=false,apiDocs=false,modelDocs=false";

/** Verified with OpenAPI Generator 7.26.0 (see CLAUDE.md, "Generated output targets"). */
export function resolveTarget(options: GenerationOptions): TargetConfig {
  switch (options.target) {
    case "typescript-next":
      return typescriptTarget(options.httpClient, "src/lib/api-client");
    case "typescript-nuxt":
      return typescriptTarget(options.httpClient, "app/lib/api-client");
    case "typescript-angular":
      return {
        generator: {
          generatorName: "typescript-angular",
          additionalProperties: { ngVersion: "22.0.0" },
        },
        archiveRoot: "api-client",
        destinationRoot: "src/app/api-client",
        sourceDir: "",
        extensions: [".ts"],
      };
    case "csharp":
      return {
        generator: {
          generatorName: "csharp",
          additionalProperties: {
            library: "generichost",
            targetFramework: "net10.0",
            nullableReferenceTypes: "true",
            packageName: "ApiClient",
          },
        },
        archiveRoot: "ApiClient",
        destinationRoot: "src/ApiClient",
        sourceDir: "src/ApiClient",
        extensions: [".cs", ".csproj"],
      };
  }
}

function typescriptTarget(httpClient: "axios" | "fetch", destinationRoot: string): TargetConfig {
  const common = { archiveRoot: "api-client", destinationRoot, sourceDir: "", extensions: [".ts"] };
  switch (httpClient) {
    case "axios":
      return {
        ...common,
        generator: {
          generatorName: "typescript-axios",
          additionalProperties: {
            supportsES6: "true",
            withSeparateModelsAndApi: "true",
            apiPackage: "api",
            modelPackage: "model",
          },
        },
      };
    case "fetch":
      return {
        ...common,
        generator: {
          generatorName: "typescript-fetch",
          additionalProperties: { supportsES6: "true" },
          // Makes runtime.ts pass Nuxt 4's default compiler options.
          templateDir: "generator-templates/typescript-fetch",
        },
      };
  }
}

/**
 * Maps a generator output path (relative, `/`-separated) to its path in the
 * archive, or returns undefined for files that are left out.
 */
export function toArchivePath(target: TargetConfig, outputPath: string): string | undefined {
  const prefix = target.sourceDir === "" ? "" : `${target.sourceDir}/`;
  if (!outputPath.startsWith(prefix)) return undefined;
  const relative = outputPath.slice(prefix.length);
  const segments = relative.split("/");
  // Hidden files and folders (.openapi-generator, .gitignore, ...) are scaffolding.
  if (segments.some((segment) => segment.startsWith("."))) return undefined;
  if (!target.extensions.some((extension) => relative.endsWith(extension))) return undefined;
  return `${target.archiveRoot}/${relative}`;
}

/** Destination of an archive path in the supported project layout. */
export function toDestinationPath(target: TargetConfig, archivePath: string): string {
  const relative = archivePath.slice(target.archiveRoot.length + 1);
  return `${target.destinationRoot}/${relative}`;
}
