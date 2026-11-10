import { combinationKey } from "@/lib/targets/catalog";
import type { ProjectMode } from "@/lib/validation/requests";
import type { GenerateSuccess } from "@/lib/validation/responses";
import type { GuideBlock, GuideStep } from "./types";

/** Building blocks shared by the OpenAPI and GraphQL guides. */

export interface RenderGuideOptions {
  /** Folder in the ZIP that holds this result's files, e.g. `nextjs-axios`. */
  zipFolder?: string;
  /** Whether the guide adds the client to an existing project or creates a new one first. Default: existing. */
  project?: ProjectMode;
}

/** Placeholder for the user's own .NET application project. */
export const PROJECT = "<YourProject>";

/** Folder and project names the "new project" guides create. Fixed so every later step can name them. */
export const NEW_DOTNET_SOLUTION = "MyApp";
export const NEW_DOTNET_PROJECT = "MyApp.Api";

/** Where the guide's paths start, and the step that creates it in a new project. */
export interface ProjectSetup {
  mode: ProjectMode;
  /** How the guide refers to the folder that project paths are relative to. */
  root: string;
  /** Folder of the new project (TypeScript) or solution (C#). */
  newFolder: string;
}


export function projectSetup(result: GenerateSuccess, mode: ProjectMode): ProjectSetup {
  const isDotnet = result.options.target === "csharp";
  const newFolder = isDotnet ? NEW_DOTNET_SOLUTION : `${combinationKey(result.options)}-app`;
  if (mode === "new") {
    return {
      mode,
      newFolder,
      root: isDotnet ? `the \`${newFolder}\` solution folder you created` : `the \`${newFolder}\` project folder you created`,
    };
  }
  return {
    mode,
    newFolder,
    root: isDotnet
      ? "your solution folder (the folder that contains your `.sln` or `.slnx` file)"
      : "your project folder (the folder that contains `package.json`)",
  };
}

/** The first step of a "new project" guide: official CLI commands that create the supported layout. */
export function createStep(title: string, description: string, commands: readonly string[], setup: ProjectSetup): GuideStep {
  return {
    title,
    blocks: [
      { kind: "text", text: `${description} Run these commands in the folder where the new project should be created:` },
      ...commands.map((command): GuideBlock => ({ kind: "command", command })),
      {
        kind: "text",
        text: `Every later path and command in this part of the guide is relative to the \`${setup.newFolder}\` folder. You can choose another folder name: change it in the commands above.`,
      },
    ],
  };
}

export const FRAMEWORKS = {
  "typescript-next": {
    name: "Next.js",
    setup: [
      "A Next.js 16 project with the App Router and TypeScript, using the `src/` directory.",
      "The default `@/*` import alias that points to `src/*` (created by `create-next-app`).",
    ],
    importPath: "@/lib/api-client",
    exampleDir: "src/lib",
    create: (folder: string) => ({
      description: "Create a Next.js 16 project with the App Router, TypeScript, the `src/` directory, and the `@/*` import alias.",
      commands: [`npx create-next-app@16 ${folder} --ts --app --src-dir --import-alias "@/*" --use-npm --yes`, `cd ${folder}`],
    }),
    verify: ["npx tsc --noEmit", "npm run build"],
    aliasError: "Cannot find module '@/lib/api-client': the `@/*` alias is missing. Add `\"paths\": { \"@/*\": [\"./src/*\"] }` to `compilerOptions` in `tsconfig.json`, or import with a relative path.",
  },
  "typescript-nuxt": {
    name: "Nuxt",
    setup: [
      "A Nuxt 4 project with the default `app/` source directory.",
      "The default `~` alias, which points to `app/`.",
    ],
    importPath: "~/lib/api-client",
    exampleDir: "app/lib",
    create: (folder: string) => ({
      description: "Create a Nuxt 4 project from the minimal template. It uses the `app/` source directory and the `~` alias.",
      commands: [`npx create-nuxt@4 ${folder} --template minimal --packageManager npm --gitInit`, `cd ${folder}`],
    }),
    verify: ["npm install --save-dev vue-tsc typescript@^6", "npx nuxi typecheck", "npm run build"],
    aliasError: "Cannot find module '~/lib/api-client': check that the files are in `app/lib/api-client/` (Nuxt 4 uses `app/` as its source directory).",
  },
} as const;


/**
 * One step for all generated files: they are copied as one folder. It names
 * the folder that paths start from and a file to check the result with.
 */
export function addFilesStep(result: GenerateSuccess, zipFolder: string | undefined, setup: ProjectSetup): GuideStep {
  const folder = zipFolder === undefined ? result.archiveRoot : `${zipFolder}/${result.archiveRoot}`;
  const parent = result.destinationRoot.split("/").slice(0, -1).join("/");
  const check = checkFile(result);
  return {
    title: "Add the generated files",
    blocks: [
      {
        kind: "list",
        items: [
          `In the ZIP, find the \`${folder}\` folder (${String(result.files.length)} files).`,
          parent === ""
            ? `Copy that whole folder into ${setup.root}.`
            : `Copy that whole folder into the \`${parent}/\` folder of ${setup.root}. Create \`${parent}/\` if it does not exist yet.`,
          `The folder is now \`${result.destinationRoot}/\`${check === undefined ? "" : `: for example, \`${check}\` exists`}. It must not end up one level deeper, as \`${result.destinationRoot}/${result.archiveRoot}/\`.`,
        ],
      },
      {
        kind: "text",
        text: "The tree below shows where every file belongs. Do not edit the generated files; generate them again when the API changes.",
      },
      { kind: "tree" },
      { kind: "mapping" },
      { kind: "files" },
    ],
  };
}

/** A file directly in the client folder that shows it was copied to the right place. */
function checkFile(result: GenerateSuccess): string | undefined {
  const topLevel = result.files
    .map((file) => file.destinationPath)
    .filter((path) => !path.slice(result.destinationRoot.length + 1).includes("/"));
  return topLevel.find((path) => path.endsWith(".csproj")) ?? topLevel.find((path) => path.endsWith("/index.ts")) ?? topLevel[0];
}


export function verifyStep(commands: readonly string[], errors: readonly string[]): GuideStep {
  return {
    title: "Verify the integration",
    blocks: [
      { kind: "text", text: "Build the project to check that everything compiles:" },
      ...commands.map((command): GuideBlock => ({ kind: "command", command })),
      ...(commands.some((command) => command.includes("vue-tsc"))
        ? [
            {
              kind: "text",
              text: "`nuxi typecheck` needs `vue-tsc` and `typescript` as development dependencies; skip the first command if your project already has them. `vue-tsc` 3 does not work with TypeScript 7 yet, so the command installs TypeScript 6.",
            } satisfies GuideBlock,
          ]
        : []),
      { kind: "text", text: "Common problems:" },
      { kind: "list", items: [...errors] },
    ],
  };
}


export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** `TodosApi` → `todos-api`. */
export function kebabCase(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
