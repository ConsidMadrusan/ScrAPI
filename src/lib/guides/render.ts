import { ANGULAR_APP_DIR, DOTNET_TARGET_FRAMEWORK } from "@/lib/targets/config";
import type { GenerateSuccess } from "@/lib/validation/responses";
import type { Guide, GuideBlock, GuideStep } from "./types";
import { findUsageExample, pascalCase, type UsageExample } from "./usage";

const BASE_URL = "<YOUR_API_BASE_URL>";
const PROJECT = "<YourProject>";

const BASE_URL_PLACEHOLDER = {
  token: BASE_URL,
  description: "The base URL of the API, for example the URL your API is deployed at.",
};

/**
 * Renders the integration guide for a generation result. Deterministic: the
 * same result always gives the same guide, and every path, file, and method
 * in it comes from the result.
 */
export function renderGuide(result: GenerateSuccess): Guide {
  const usage = findUsageExample(result);
  switch (result.options.target) {
    case "typescript-next":
    case "typescript-nuxt":
      return typescriptGuide(result, result.options.target, result.options.httpClient, usage);
    case "typescript-angular":
      return angularGuide(result, usage);
    case "csharp":
      return csharpGuide(result, usage);
  }
}

const FRAMEWORKS = {
  "typescript-next": {
    name: "Next.js",
    setup: [
      "A Next.js 16 project with the App Router and TypeScript, using the `src/` directory.",
      "The default `@/*` import alias that points to `src/*` (created by `create-next-app`).",
    ],
    /** The `@/*` alias resolves `src/*`. */
    alias: { prefix: "@/", root: "src" },
    verify: ["npx tsc --noEmit", "npm run build"],
    aliasError: (importPath: string) =>
      `Cannot find module '${importPath}': the \`@/*\` alias is missing. Add \`"paths": { "@/*": ["./src/*"] }\` to \`compilerOptions\` in \`tsconfig.json\`, or import with a relative path.`,
  },
  "typescript-nuxt": {
    name: "Nuxt",
    setup: [
      "A Nuxt 4 project with the default `app/` source directory.",
      "The default `~` alias, which points to `app/`.",
    ],
    /** The `~` alias resolves `app/`. */
    alias: { prefix: "~/", root: "app" },
    verify: ["npm install --save-dev vue-tsc typescript@^6", "npx nuxi typecheck", "npm run build"],
    aliasError: (importPath: string, destinationRoot: string) =>
      `Cannot find module '${importPath}': check that the files are in \`${destinationRoot}/\` (Nuxt 4 uses \`app/\` as its source directory).`,
  },
} as const;

/** The Angular application's providers file, in the folder the client goes into. */
const ANGULAR_APP_CONFIG = `${ANGULAR_APP_DIR}/app.config.ts`;

/** `net10.0` → `10`: the .NET version the SDK and the user's project need. */
const DOTNET_VERSION = DOTNET_TARGET_FRAMEWORK.replace(/^net(\d+)\.0$/, "$1");

const DO_NOT_EDIT_NOTE = "Do not edit the generated files; generate them again when the API changes.";

/** The import specifier for the destination folder through the framework's alias. */
function aliasImportPath(destinationRoot: string, alias: { prefix: string; root: string }): string {
  if (!destinationRoot.startsWith(`${alias.root}/`)) {
    throw new Error(`The destination ${destinationRoot} is outside the alias root ${alias.root}/.`);
  }
  return `${alias.prefix}${destinationRoot.slice(alias.root.length + 1)}`;
}

/** The folder that contains `path` (`/`-separated). */
function parentDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

function typescriptGuide(
  result: GenerateSuccess,
  target: "typescript-next" | "typescript-nuxt",
  httpClient: "axios" | "fetch",
  usage: UsageExample | undefined,
): Guide {
  const framework = FRAMEWORKS[target];
  // The example sits next to the client folder, so every path follows the destination.
  const importPath = aliasImportPath(result.destinationRoot, framework.alias);
  const exampleDir = parentDir(result.destinationRoot);
  const commonErrors = [
    framework.aliasError(importPath, result.destinationRoot),
    ...(httpClient === "axios"
      ? ["Cannot find module 'axios': run `npm install axios`."]
      : []),
    "Type errors inside the generated files with `exactOptionalPropertyTypes` enabled: the generated code is not compatible with that compiler option. Turn it off, or exclude the client folder from type checking.",
    "Requests blocked by CORS in the browser: the API must allow your site's origin, or call it from server code instead.",
  ];

  return {
    title: `Add the TypeScript client to your ${framework.name} project`,
    placeholders: [BASE_URL_PLACEHOLDER],
    steps: [
      setupStep(
        [...framework.setup, `The \`${httpClient}\` HTTP client, as chosen when generating.`],
        "The steps add new files and make no changes to your existing application files.",
      ),
      addFilesStep(result, DO_NOT_EDIT_NOTE),
      {
        title: "Install dependencies",
        blocks:
          httpClient === "axios"
            ? [
                { kind: "text", text: "The client uses axios. Add it to your project:" },
                { kind: "command", command: "npm install axios" },
                { kind: "text", text: "ScrAPI checked the generated code with axios 1.x." },
              ]
            : [
                {
                  kind: "text",
                  text: "Nothing to install. The client uses the Fetch API that browsers and Node.js 18 or newer provide.",
                },
              ],
      },
      callStep(usage, (found) => {
        const file = `${exampleDir}/${kebabCase(found.typeName)}-example.ts`;
        return {
          intro: `Create \`${file}\` with a configured client and a call to \`${found.operation.id}\`. Replace \`${BASE_URL}\` with the base URL of the API.`,
          file,
          language: "ts",
          code: typescriptExample(found, importPath, httpClient),
          notes: [
            "Every API class is created the same way and can be used from server or client code. If the API needs authentication, set the matching option (`accessToken` or `apiKey`) on `Configuration`.",
          ],
        };
      }),
      verifyStep(framework.verify, commonErrors),
    ],
  };
}

function typescriptExample(usage: UsageExample, importPath: string, httpClient: "axios" | "fetch"): string {
  const instance = lowerFirst(usage.typeName);
  const call = `${instance}.${usage.methodName}(${callArguments(usage)})`;
  const body =
    httpClient === "axios"
      ? [`  const response = await ${call};`, "  return response.data;"]
      : [`  return ${call};`];
  return [
    `import { Configuration, ${usage.typeName} } from "${importPath}";`,
    "",
    `// TODO: Replace ${BASE_URL} with the base URL of the API.`,
    `const configuration = new Configuration({ basePath: "${BASE_URL}" });`,
    "",
    `export const ${instance} = new ${usage.typeName}(configuration);`,
    "",
    `export async function ${usage.methodName}Example() {`,
    ...body,
    "}",
    "",
  ].join("\n");
}

function angularGuide(result: GenerateSuccess, usage: UsageExample | undefined): Guide {
  // Both app.config.ts and the example live in the app folder, next to the client folder.
  const importPath = aliasImportPath(result.destinationRoot, { prefix: "./", root: ANGULAR_APP_DIR });

  return {
    title: "Add the TypeScript client to your Angular project",
    placeholders: [BASE_URL_PLACEHOLDER],
    steps: [
      setupStep(
        [
          "An Angular 22 standalone application created with the Angular CLI.",
          `Application providers in \`${ANGULAR_APP_CONFIG}\`.`,
        ],
        "The steps add new files and make one small edit to `app.config.ts`.",
      ),
      addFilesStep(result, DO_NOT_EDIT_NOTE),
      {
        title: "Register the HTTP client and the API",
        blocks: [
          {
            kind: "text",
            text: `Edit \`${ANGULAR_APP_CONFIG}\`: add the two imports and the two providers. Keep your existing providers. If \`provideHttpClient()\` is already there, do not add it twice.`,
          },
          {
            kind: "code",
            language: "ts",
            file: ANGULAR_APP_CONFIG,
            action: "edit",
            code: angularProviders(importPath),
          },
          {
            kind: "text",
            text: "No packages need to be installed: the client uses `@angular/common/http`, which Angular projects already include.",
          },
        ],
      },
      callStep(usage, (found) => {
        const file = `${ANGULAR_APP_DIR}/${kebabCase(found.methodName)}-example.ts`;
        return {
          intro: `Create \`${file}\` with a service that calls \`${found.operation.id}\`. Inject it where you need the data.`,
          file,
          language: "ts",
          code: angularExample(found, importPath),
        };
      }),
      verifyStep(
        ["npx ng build"],
        [
          "NullInjectorError: No provider for HttpClient: add `provideHttpClient()` to the providers in `app.config.ts`.",
          "Requests go to the wrong host: check the base URL passed to `provideApi(...)`.",
          "Requests blocked by CORS in the browser: the API must allow your site's origin.",
        ],
      ),
    ],
  };
}

function angularProviders(importPath: string): string {
  return [
    'import { provideHttpClient } from "@angular/common/http";',
    `import { provideApi } from "${importPath}";`,
    "",
    "export const appConfig: ApplicationConfig = {",
    "  providers: [",
    "    // ...your existing providers",
    "    provideHttpClient(),",
    `    // TODO: Replace ${BASE_URL} with the base URL of the API.`,
    `    provideApi("${BASE_URL}"),`,
    "  ],",
    "};",
    "",
  ].join("\n");
}

function angularExample(usage: UsageExample, importPath: string): string {
  return [
    'import { inject, Injectable } from "@angular/core";',
    `import { ${usage.typeName} } from "${importPath}";`,
    "",
    '@Injectable({ providedIn: "root" })',
    `export class ${pascalCase(usage.methodName)}Example {`,
    `  private readonly api = inject(${usage.typeName});`,
    "",
    `  ${usage.methodName}() {`,
    "    // Returns an Observable: subscribe to it or use the async pipe.",
    `    return this.api.${usage.methodName}(${callArguments(usage)});`,
    "  }",
    "}",
    "",
  ].join("\n");
}

function csharpGuide(result: GenerateSuccess, usage: UsageExample | undefined): Guide {
  // The archive root is the generated project's name and root namespace.
  const project = result.archiveRoot;

  return {
    title: "Add the C# client to your .NET solution",
    placeholders: [
      BASE_URL_PLACEHOLDER,
      { token: PROJECT, description: "The folder and project file name of your application project." },
    ],
    steps: [
      setupStep(
        [
          `The .NET ${DOTNET_VERSION} SDK. The client project targets \`${DOTNET_TARGET_FRAMEWORK}\`, so the project that uses it must target \`${DOTNET_TARGET_FRAMEWORK}\` as well.`,
          "A solution with your application project. The client becomes a separate project in `src/` next to it.",
          "An application that uses the .NET generic host, for example ASP.NET Core or a worker service (`builder.Services`).",
        ],
        "The steps add a new project and make one small edit to `Program.cs`.",
      ),
      addFilesStep(result, DO_NOT_EDIT_NOTE),
      csharpSolutionStep(result),
      {
        title: "Register the API",
        blocks: [
          {
            kind: "text",
            text: "Edit `Program.cs`: after the builder is created (for example `var builder = WebApplication.CreateBuilder(args);`), register the API clients. Keep the rest of the file as it is.",
          },
          {
            kind: "code",
            language: "csharp",
            file: `${PROJECT}/Program.cs`,
            action: "edit",
            code: csharpRegistration(project),
          },
          {
            kind: "text",
            text: "If the API needs authentication, add a token inside `ConfigureApi` with `options.AddTokens(...)` (for example `BearerToken` or `ApiKeyToken` from the client's `Client` folder).",
          },
        ],
      },
      callStep(usage, (found) => {
        const exampleClass = `${found.typeName.replace(/^I(?=[A-Z])/, "")}Example`;
        return {
          intro: `Create \`${PROJECT}/${exampleClass}.cs\`, which receives \`${found.typeName}\` through dependency injection and calls \`${found.operation.id}\`. Register it with \`builder.Services.AddTransient<${exampleClass}>();\` or inject \`${found.typeName}\` into your own services and controllers.`,
          file: `${PROJECT}/${exampleClass}.cs`,
          language: "csharp",
          code: csharpExample(found, project, exampleClass),
        };
      }),
      verifyStep(
        ["dotnet build"],
        [
          `NETSDK1045 (the current .NET SDK does not support targeting .NET ${DOTNET_VERSION}.0): install the .NET ${DOTNET_VERSION} SDK.`,
          `NU1201 (project ${project} is not compatible with your project's framework): your project must target \`${DOTNET_TARGET_FRAMEWORK}\` as well.`,
          "No service for type '...Api' has been registered: call `builder.ConfigureApi(...)` in `Program.cs` before `builder.Build()`.",
        ],
      ),
    ],
  };
}

function csharpSolutionStep(result: GenerateSuccess): GuideStep {
  const projectFile = `${result.destinationRoot}/${result.archiveRoot}.csproj`;
  const packages = packageReferences(result);
  return {
    title: "Add the project to your solution",
    blocks: [
      { kind: "text", text: "From the solution folder, add the client project and reference it from your application project:" },
      { kind: "command", command: `dotnet sln add ${projectFile}` },
      { kind: "command", command: `dotnet add ${PROJECT}/${PROJECT}.csproj reference ${projectFile}` },
      ...(packages.length > 0
        ? ([
            {
              kind: "text",
              text: `\`${result.archiveRoot}.csproj\` already references these NuGet packages. They are restored on the next build:`,
            },
            { kind: "list", items: packages },
          ] satisfies GuideBlock[])
        : []),
    ],
  };
}

function csharpRegistration(project: string): string {
  return [
    `using ${project}.Extensions;`,
    "",
    "builder.ConfigureApi(options =>",
    "{",
    "    options.AddApiHttpClients((HttpClient client) =>",
    "    {",
    `        // TODO: Replace ${BASE_URL} with the base URL of the API.`,
    `        client.BaseAddress = new Uri("${BASE_URL}");`,
    "    });",
    "});",
    "",
  ].join("\n");
}

function csharpExample(usage: UsageExample, project: string, exampleClass: string): string {
  return [
    `using ${project}.Api;`,
    "",
    `public sealed class ${exampleClass}(${usage.typeName} api)`,
    "{",
    "    public async Task RunAsync()",
    "    {",
    `        var response = await api.${usage.methodName}(${callArguments(usage)});`,
    `        // TODO: Check the response. Its interface in ${project}/Api lists the available checks, such as IsOk and Ok().`,
    "    }",
    "}",
    "",
  ].join("\n");
}

/** The "Check your project setup" step: the assumed project layout and what the guide changes. */
function setupStep(assumptions: readonly string[], changes: string): GuideStep {
  return {
    title: "Check your project setup",
    blocks: [
      { kind: "text", text: "This guide assumes:" },
      { kind: "list", items: [...assumptions] },
      { kind: "text", text: changes },
    ],
  };
}

/** A new example file that calls the generated method. */
interface CallExample {
  intro: string;
  file: string;
  language: "ts" | "csharp";
  code: string;
  /** Extra text after the example and its signature note. */
  notes?: readonly string[];
}

/** The "Call an operation" step, or an explanation when no generated method was found. */
function callStep(usage: UsageExample | undefined, example: (usage: UsageExample) => CallExample): GuideStep {
  if (!usage) return noUsageStep();
  const { intro, file, language, code, notes = [] } = example(usage);
  return {
    title: "Call an operation",
    blocks: [
      { kind: "text", text: intro },
      { kind: "code", language, file, action: "create", code },
      ...signatureNote(usage),
      ...notes.map((text): GuideBlock => ({ kind: "text", text })),
    ],
  };
}

/** The argument list of the example call: empty, or a TODO the user must fill in. */
function callArguments(usage: UsageExample): string {
  return usage.callableWithoutArguments ? "" : "/* TODO: required arguments */";
}

/** One step for all generated files: they are copied as one folder. */
function addFilesStep(result: GenerateSuccess, note: string): GuideStep {
  return {
    title: "Add the generated files",
    blocks: [
      {
        kind: "text",
        text: `Copy the \`${result.archiveRoot}\` folder from the ZIP to \`${result.destinationRoot}/\` in your project (${String(result.files.length)} files). ${note}`,
      },
      { kind: "tree" },
      { kind: "mapping" },
      { kind: "files" },
    ],
  };
}

function signatureNote(usage: UsageExample): GuideBlock[] {
  if (usage.callableWithoutArguments) return [];
  return [
    {
      kind: "text",
      text: `\`${usage.operation.id}\` needs arguments, so the call does not compile until you replace the TODO. The generated signature is:`,
    },
    { kind: "command", command: `${usage.methodName}(${usage.parameters})` },
  ];
}

function noUsageStep(): GuideStep {
  return {
    title: "Call an operation",
    blocks: [
      {
        kind: "text",
        text: "ScrAPI could not match a selected operation to a generated method (for example because the operations have no operationId), so no example is shown. The generated API classes in the copied folder contain one method per selected operation.",
      },
    ],
  };
}

function verifyStep(commands: readonly string[], errors: readonly string[]): GuideStep {
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

/** NuGet packages referenced by the generated project file, as `Name (Version)`. */
function packageReferences(result: GenerateSuccess): string[] {
  const projectFile = result.files.find((file) => file.archivePath.endsWith(".csproj"));
  if (!projectFile) return [];
  return [...projectFile.content.matchAll(/<PackageReference Include="([^"]+)"[^>]*?Version="([^"]+)"/g)].map(
    (match) => `${match[1] ?? ""} ${match[2] ?? ""}`,
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** `TodosApi` → `todos-api`. */
function kebabCase(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
