import type { GenerateSuccess, OpenApiGenerateSuccess } from "@/lib/validation/responses";
import {
  addFilesStep,
  createStep,
  FRAMEWORKS,
  kebabCase,
  lowerFirst,
  NEW_DOTNET_PROJECT,
  NEW_DOTNET_SOLUTION,
  PROJECT,
  projectSetup,
  verifyStep,
  type ProjectSetup,
  type RenderGuideOptions,
} from "./common";

export type { RenderGuideOptions };
import { renderGraphqlGuide } from "./render-graphql";
import type { Guide, GuideBlock, GuideStep } from "./types";
import { findUsageExample, pascalCase, type UsageExample } from "./usage";

const BASE_URL = "<YOUR_API_BASE_URL>";

const BASE_URL_PLACEHOLDER = {
  token: BASE_URL,
  description: "The base URL of the API, for example the URL your API is deployed at.",
};


/**
 * Renders the integration guide for a generation result. Deterministic: the
 * same result always gives the same guide, and every path, file, and method
 * in it comes from the result.
 */
export function renderGuide(result: GenerateSuccess, options: RenderGuideOptions = {}): Guide {
  if (result.kind === "graphql") return renderGraphqlGuide(result, options);
  const usage = findUsageExample(result);
  const setup = projectSetup(result, options.project ?? "existing");
  const filesStep = addFilesStep(result, options.zipFolder, setup);
  switch (result.options.target) {
    case "typescript-next":
    case "typescript-nuxt":
      return typescriptGuide(result, result.options.target, result.options.httpClient, usage, filesStep, setup);
    case "typescript-angular":
      return angularGuide(usage, filesStep, setup);
    case "csharp":
      return csharpGuide(result, usage, filesStep, setup);
  }
}

function typescriptGuide(
  result: OpenApiGenerateSuccess,
  target: "typescript-next" | "typescript-nuxt",
  httpClient: "axios" | "fetch",
  usage: UsageExample | undefined,
  filesStep: GuideStep,
  setup: ProjectSetup,
): Guide {
  const framework = FRAMEWORKS[target];
  const create = framework.create(setup.newFolder);
  const exampleFile = usage ? `${framework.exampleDir}/${kebabCase(usage.typeName)}-example.ts` : "";
  const commonErrors = [
    framework.aliasError,
    ...(httpClient === "axios"
      ? ["Cannot find module 'axios': run `npm install axios`."]
      : []),
    "Type errors inside the generated files with `exactOptionalPropertyTypes` enabled: the generated code is not compatible with that compiler option. Turn it off, or exclude the client folder from type checking.",
    "Requests blocked by CORS in the browser: the API must allow your site's origin, or call it from server code instead.",
  ];

  return {
    title:
      setup.mode === "new"
        ? `Create a ${framework.name} project with the TypeScript client`
        : `Add the TypeScript client to your ${framework.name} project`,
    placeholders: [BASE_URL_PLACEHOLDER],
    steps: [
      setup.mode === "new"
        ? createStep(`Create the ${framework.name} project`, create.description, create.commands, setup)
        : {
            title: "Check your project setup",
            blocks: [
              { kind: "text", text: "This guide assumes:" },
              {
                kind: "list",
                items: [
                  ...framework.setup,
                  `The \`${httpClient}\` HTTP client, as chosen when generating.`,
                ],
              },
              {
                kind: "text",
                text: "The steps add new files and make no changes to your existing application files.",
              },
            ],
          },
      filesStep,
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
      usage
        ? {
            title: "Call an operation",
            blocks: [
              {
                kind: "text",
                text: `Create \`${exampleFile}\` with a configured client and a call to \`${usage.operation.id}\`. Replace \`${BASE_URL}\` with the base URL of the API.`,
              },
              {
                kind: "code",
                language: "ts",
                file: exampleFile,
                action: "create",
                code: typescriptExample(usage, framework.importPath, httpClient),
              },
              ...signatureNote(usage),
              {
                kind: "text",
                text: "Every API class is created the same way and can be used from server or client code. If the API needs authentication, set the matching option (`accessToken` or `apiKey`) on `Configuration`.",
              },
            ],
          }
        : noUsageStep(),
      verifyStep(framework.verify, commonErrors),
    ],
  };
}

function typescriptExample(usage: UsageExample, importPath: string, httpClient: "axios" | "fetch"): string {
  const instance = lowerFirst(usage.typeName);
  const call = `${instance}.${usage.methodName}(${usage.callableWithoutArguments ? "" : "/* TODO: required arguments */"})`;
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

function angularGuide(usage: UsageExample | undefined, filesStep: GuideStep, setup: ProjectSetup): Guide {
  const exampleClass = usage ? `${pascalCase(usage.methodName)}Example` : "";
  const exampleFile = usage ? `src/app/${kebabCase(usage.methodName)}-example.ts` : "";

  return {
    title:
      setup.mode === "new"
        ? "Create an Angular project with the TypeScript client"
        : "Add the TypeScript client to your Angular project",
    placeholders: [BASE_URL_PLACEHOLDER],
    steps: [
      setup.mode === "new"
        ? createStep(
            "Create the Angular project",
            "Create an Angular 22 standalone application with the Angular CLI's default options (CSS styles, no server-side rendering).",
            [`npx @angular/cli@22 new ${setup.newFolder} --defaults`, `cd ${setup.newFolder}`],
            setup,
          )
        : {
            title: "Check your project setup",
            blocks: [
              { kind: "text", text: "This guide assumes:" },
              {
                kind: "list",
                items: [
                  "An Angular 22 standalone application created with the Angular CLI.",
                  "Application providers in `src/app/app.config.ts`.",
                ],
              },
              {
                kind: "text",
                text: "The steps add new files and make one small edit to `app.config.ts`.",
              },
            ],
          },
      filesStep,
      {
        title: "Register the HTTP client and the API",
        blocks: [
          {
            kind: "text",
            text: "Edit `src/app/app.config.ts`: add the two imports and the two providers. Keep your existing providers. If `provideHttpClient()` is already there, do not add it twice.",
          },
          {
            kind: "code",
            language: "ts",
            file: "src/app/app.config.ts",
            action: "edit",
            code: [
              'import { provideHttpClient } from "@angular/common/http";',
              'import { provideApi } from "./api-client";',
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
            ].join("\n"),
          },
          {
            kind: "text",
            text: "No packages need to be installed: the client uses `@angular/common/http`, which Angular projects already include.",
          },
        ],
      },
      usage
        ? {
            title: "Call an operation",
            blocks: [
              {
                kind: "text",
                text: `Create \`${exampleFile}\` with a service that calls \`${usage.operation.id}\`. Inject it where you need the data.`,
              },
              {
                kind: "code",
                language: "ts",
                file: exampleFile,
                action: "create",
                code: [
                  'import { inject, Injectable } from "@angular/core";',
                  `import { ${usage.typeName} } from "./api-client";`,
                  "",
                  '@Injectable({ providedIn: "root" })',
                  `export class ${exampleClass} {`,
                  `  private readonly api = inject(${usage.typeName});`,
                  "",
                  `  ${usage.methodName}() {`,
                  "    // Returns an Observable: subscribe to it or use the async pipe.",
                  `    return this.api.${usage.methodName}(${usage.callableWithoutArguments ? "" : "/* TODO: required arguments */"});`,
                  "  }",
                  "}",
                  "",
                ].join("\n"),
              },
              ...signatureNote(usage),
            ],
          }
        : noUsageStep(),
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

function csharpGuide(
  result: OpenApiGenerateSuccess,
  usage: UsageExample | undefined,
  filesStep: GuideStep,
  setup: ProjectSetup,
): Guide {
  const projectFile = `${result.destinationRoot}/${result.archiveRoot}.csproj`;
  // The application project that uses the client: a placeholder, or the one the guide creates.
  const appDir = setup.mode === "new" ? `src/${NEW_DOTNET_PROJECT}` : PROJECT;
  const appProject = setup.mode === "new" ? `${appDir}/${NEW_DOTNET_PROJECT}.csproj` : `${PROJECT}/${PROJECT}.csproj`;
  const exampleClass = usage ? `${usage.typeName.replace(/^I(?=[A-Z])/, "")}Example` : "";
  const packages = packageReferences(result);

  return {
    title: setup.mode === "new" ? "Create a .NET solution with the C# client" : "Add the C# client to your .NET solution",
    placeholders:
      setup.mode === "new"
        ? [BASE_URL_PLACEHOLDER]
        : [
            BASE_URL_PLACEHOLDER,
            { token: PROJECT, description: "The folder and project file name of your application project." },
          ],
    steps: [
      setup.mode === "new"
        ? createStep(
            "Create the solution and the Web API project",
            `Create a solution with an ASP.NET Core Web API project, \`${NEW_DOTNET_PROJECT}\`, in \`src/\`. You need the .NET 10 SDK.`,
            [
              `dotnet new sln -n ${NEW_DOTNET_SOLUTION} -o ${setup.newFolder}`,
              `cd ${setup.newFolder}`,
              `dotnet new webapi -n ${NEW_DOTNET_PROJECT} -o ${appDir} -f net10.0`,
              `dotnet sln add ${appProject}`,
            ],
            setup,
          )
        : {
            title: "Check your project setup",
            blocks: [
              { kind: "text", text: "This guide assumes:" },
              {
                kind: "list",
                items: [
                  "The .NET 10 SDK. The client project targets `net10.0`, so the project that uses it must target `net10.0` as well.",
                  "A solution with your application project. The client becomes a separate project in `src/` next to it.",
                  "An application that uses the .NET generic host, for example ASP.NET Core or a worker service (`builder.Services`).",
                ],
              },
              {
                kind: "text",
                text: "The steps add a new project and make one small edit to `Program.cs`.",
              },
            ],
          },
      filesStep,
      {
        title: "Add the project to your solution",
        blocks: [
          { kind: "text", text: "From the solution folder, add the client project and reference it from your application project:" },
          { kind: "command", command: `dotnet sln add ${projectFile}` },
          { kind: "command", command: `dotnet add ${appProject} reference ${projectFile}` },
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
      },
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
            file: `${appDir}/Program.cs`,
            action: "edit",
            code: [
              `using ${result.archiveRoot}.Extensions;`,
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
            ].join("\n"),
          },
          {
            kind: "text",
            text: "If the API needs authentication, add a token inside `ConfigureApi` with `options.AddTokens(...)` (for example `BearerToken` or `ApiKeyToken` from the client's `Client` folder).",
          },
        ],
      },
      usage
        ? {
            title: "Call an operation",
            blocks: [
              {
                kind: "text",
                text: `Create \`${appDir}/${exampleClass}.cs\`, which receives \`${usage.typeName}\` through dependency injection and calls \`${usage.operation.id}\`. Register it with \`builder.Services.AddTransient<${exampleClass}>();\` or inject \`${usage.typeName}\` into your own services and controllers.`,
              },
              {
                kind: "code",
                language: "csharp",
                file: `${appDir}/${exampleClass}.cs`,
                action: "create",
                code: [
                  `using ${result.archiveRoot}.Api;`,
                  "",
                  `public sealed class ${exampleClass}(${usage.typeName} api)`,
                  "{",
                  "    public async Task RunAsync()",
                  "    {",
                  `        var response = await api.${usage.methodName}(${usage.callableWithoutArguments ? "" : "/* TODO: required arguments */"});`,
                  `        // TODO: Check the response. Its interface in ${result.archiveRoot}/Api lists the available checks, such as IsOk and Ok().`,
                  "    }",
                  "}",
                  "",
                ].join("\n"),
              },
              ...signatureNote(usage),
            ],
          }
        : noUsageStep(),
      verifyStep(
        ["dotnet build"],
        [
          "NETSDK1045 (the current .NET SDK does not support targeting .NET 10.0): install the .NET 10 SDK.",
          "NU1201 (project ApiClient is not compatible with your project's framework): your project must target `net10.0` as well.",
          "No service for type '...Api' has been registered: call `builder.ConfigureApi(...)` in `Program.cs` before `builder.Build()`.",
        ],
      ),
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
        text: "ScrAPI could not match a selected operation to a generated method, so no example is shown. The generated API classes in the copied folder contain one method per selected operation.",
      },
    ],
  };
}

/** NuGet packages referenced by the generated project file, as `Name (Version)`. */
function packageReferences(result: OpenApiGenerateSuccess): string[] {
  const projectFile = result.files.find((file) => file.archivePath.endsWith(".csproj"));
  if (!projectFile) return [];
  return [...projectFile.content.matchAll(/<PackageReference Include="([^"]+)"[^>]*?Version="([^"]+)"/g)].map(
    (match) => `${match[1] ?? ""} ${match[2] ?? ""}`,
  );
}

