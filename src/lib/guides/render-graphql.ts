import type { GraphqlGenerateSuccess, GraphqlOperation } from "@/lib/validation/responses";
import {
  addFilesStep,
  createStep,
  FRAMEWORKS,
  NEW_DOTNET_PROJECT,
  NEW_DOTNET_SOLUTION,
  PROJECT,
  projectSetup,
  verifyStep,
  type ProjectSetup,
  type RenderGuideOptions,
} from "./common";
import type { Guide, GuideBlock, GuideStep } from "./types";

const ENDPOINT = "<YOUR_GRAPHQL_ENDPOINT>";

const ENDPOINT_PLACEHOLDER = {
  token: ENDPOINT,
  description: "The URL of the GraphQL endpoint, for example https://api.example.com/graphql.",
};

/** A generated operation method that one example calls. */
interface GraphqlUsage {
  operation: GraphqlOperation;
  /** `Books`: the SDK method (TypeScript) or client property (C#). */
  name: string;
  /** False when the operation has variables the user must fill in. */
  callableWithoutArguments: boolean;
  /** The generated variables type, e.g. `BookQueryVariables` (TypeScript only). */
  variablesType?: string;
  /** C# only: `genre: null, first: null, ` for variables that may be null (ExecuteAsync takes every variable). */
  csharpArguments?: string;
}

/**
 * Renders the guide for a GraphQL result. Like the OpenAPI guides, every
 * file, path, and method comes from the result: the TypeScript example calls
 * a method declared in the generated SDK, the C# example a property named
 * after an operation in the generated Operations.graphql.
 */
export function renderGraphqlGuide(result: GraphqlGenerateSuccess, options: RenderGuideOptions = {}): Guide {
  const setup = projectSetup(result, options.project ?? "existing");
  const filesStep = addFilesStep(result, options.zipFolder, setup);
  switch (result.options.target) {
    case "typescript-next":
    case "typescript-nuxt":
      return typescriptGuide(result, result.options.target, result.options.httpClient, filesStep, setup);
    case "typescript-angular":
      return angularGuide(result, filesStep, setup);
    case "csharp":
      return csharpGuide(result, filesStep, setup);
  }
}

function typescriptGuide(
  result: GraphqlGenerateSuccess,
  target: "typescript-next" | "typescript-nuxt",
  httpClient: "axios" | "fetch",
  filesStep: GuideStep,
  setup: ProjectSetup,
): Guide {
  const framework = FRAMEWORKS[target];
  const create = framework.create(setup.newFolder);
  const usage = typescriptUsage(result);
  const clientFile = `${framework.exampleDir}/graphql-client.ts`;
  const importPath = `${framework.importPath}/graphql`;

  return {
    title:
      setup.mode === "new"
        ? `Create a ${framework.name} project with the GraphQL client`
        : `Add the GraphQL client to your ${framework.name} project`,
    placeholders: [ENDPOINT_PLACEHOLDER],
    steps: [
      setup.mode === "new"
        ? createStep(`Create the ${framework.name} project`, create.description, create.commands, setup)
        : checkSetupStep([...framework.setup, `The \`${httpClient}\` HTTP client, as chosen when generating.`], "new files"),
      filesStep,
      installStep(httpClient === "axios" ? ["graphql", "axios"] : ["graphql"]),
      {
        title: "Create the client and call an operation",
        blocks: [
          {
            kind: "text",
            text: `Create \`${clientFile}\`. It sends each operation to the endpoint with ${httpClient === "axios" ? "axios" : "the Fetch API"} and creates the typed SDK${usage ? `, and calls \`${usage.operation.id}\`` : ""}. Replace \`${ENDPOINT}\` with the URL of the GraphQL endpoint.`,
          },
          {
            kind: "code",
            language: "ts",
            file: clientFile,
            action: "create",
            code: typescriptClient(importPath, httpClient, usage),
          },
          ...argumentsNote(usage),
          {
            kind: "text",
            text: "The SDK has one method per selected operation, named after it. If the API needs authentication, add the header to the request in the requester.",
          },
        ],
      },
      verifyStep(framework.verify, [
        framework.aliasError,
        "Cannot find module 'graphql': run `npm install graphql`.",
        "Requests blocked by CORS in the browser: the API must allow your site's origin, or call it from server code instead.",
        "A field you need is missing from a result: ScrAPI selects scalar fields two levels deep. Add fields to the operation in `operations.graphql` and generate again, or write your own operations.",
      ]),
    ],
  };
}

function typescriptClient(importPath: string, httpClient: "axios" | "fetch", usage: GraphqlUsage | undefined): string {
  const send =
    httpClient === "axios"
      ? [
          "  const response = await axios.post<GraphQLResponse<R>>(endpoint, { query: print(document), variables });",
          "  const body = response.data;",
        ]
      : [
          "  const response = await fetch(endpoint, {",
          '    method: "POST",',
          '    headers: { "content-type": "application/json" },',
          "    body: JSON.stringify({ query: print(document), variables }),",
          "  });",
          "  const body = (await response.json()) as GraphQLResponse<R>;",
        ];
  return [
    ...(httpClient === "axios" ? ['import axios from "axios";'] : []),
    'import { print, type DocumentNode } from "graphql";',
    `import { getSdk, type Requester } from "${importPath}";`,
    "",
    `// TODO: Replace ${ENDPOINT} with the URL of the GraphQL endpoint.`,
    `const endpoint = "${ENDPOINT}";`,
    "",
    "interface GraphQLResponse<R> {",
    "  data?: R;",
    "  errors?: { message: string }[];",
    "}",
    "",
    "const requester: Requester = async <R, V>(document: DocumentNode, variables?: V): Promise<R> => {",
    ...send,
    "  if (body.errors !== undefined && body.errors.length > 0) {",
    '    throw new Error(body.errors.map((error) => error.message).join("\\n"));',
    "  }",
    '  if (body.data === undefined) throw new Error("The GraphQL response has no data.");',
    "  return body.data;",
    "};",
    "",
    "export const api = getSdk(requester);",
    ...(usage
      ? [
          "",
          `export async function ${lowerFirst(usage.name)}Example() {`,
          `  return api.${usage.name}(${usage.callableWithoutArguments ? "" : "/* TODO: variables */"});`,
          "}",
        ]
      : []),
    "",
  ].join("\n");
}

function angularGuide(result: GraphqlGenerateSuccess, filesStep: GuideStep, setup: ProjectSetup): Guide {
  const usage = typescriptUsage(result);
  const serviceFile = "src/app/graphql-api.ts";
  return {
    title:
      setup.mode === "new"
        ? "Create an Angular project with the GraphQL client"
        : "Add the GraphQL client to your Angular project",
    placeholders: [ENDPOINT_PLACEHOLDER],
    steps: [
      setup.mode === "new"
        ? createStep(
            "Create the Angular project",
            "Create an Angular 22 standalone application with the Angular CLI's default options (CSS styles, no server-side rendering).",
            [`npx @angular/cli@22 new ${setup.newFolder} --defaults`, `cd ${setup.newFolder}`],
            setup,
          )
        : checkSetupStep(
            ["An Angular 22 standalone application created with the Angular CLI.", "Application providers in `src/app/app.config.ts`."],
            "new files and one small edit to `app.config.ts`",
          ),
      filesStep,
      installStep(["graphql"]),
      {
        title: "Register the HTTP client",
        blocks: [
          {
            kind: "text",
            text: "Edit `src/app/app.config.ts`: add the import and `provideHttpClient()`. Keep your existing providers. If `provideHttpClient()` is already there, skip this step.",
          },
          {
            kind: "code",
            language: "ts",
            file: "src/app/app.config.ts",
            action: "edit",
            code: [
              'import { provideHttpClient } from "@angular/common/http";',
              "",
              "export const appConfig: ApplicationConfig = {",
              "  providers: [",
              "    // ...your existing providers",
              "    provideHttpClient(),",
              "  ],",
              "};",
              "",
            ].join("\n"),
          },
        ],
      },
      {
        title: "Create the client and call an operation",
        blocks: [
          {
            kind: "text",
            text: `Create \`${serviceFile}\` with a service that sends each operation with \`HttpClient\` and exposes the typed SDK${usage ? `, and calls \`${usage.operation.id}\`` : ""}. Inject it where you need the data.`,
          },
          {
            kind: "code",
            language: "ts",
            file: serviceFile,
            action: "create",
            code: [
              'import { HttpClient } from "@angular/common/http";',
              'import { inject, Injectable } from "@angular/core";',
              'import { print, type DocumentNode } from "graphql";',
              'import { firstValueFrom } from "rxjs";',
              'import { getSdk, type Requester } from "./api-client/graphql";',
              "",
              `// TODO: Replace ${ENDPOINT} with the URL of the GraphQL endpoint.`,
              `const endpoint = "${ENDPOINT}";`,
              "",
              "interface GraphQLResponse<R> {",
              "  data?: R;",
              "  errors?: { message: string }[];",
              "}",
              "",
              '@Injectable({ providedIn: "root" })',
              "export class GraphqlApi {",
              "  private readonly http = inject(HttpClient);",
              "",
              "  private readonly requester: Requester = async <R, V>(document: DocumentNode, variables?: V): Promise<R> => {",
              "    const body = await firstValueFrom(",
              "      this.http.post<GraphQLResponse<R>>(endpoint, { query: print(document), variables }),",
              "    );",
              "    if (body.errors !== undefined && body.errors.length > 0) {",
              '      throw new Error(body.errors.map((error) => error.message).join("\\n"));',
              "    }",
              '    if (body.data === undefined) throw new Error("The GraphQL response has no data.");',
              "    return body.data;",
              "  };",
              "",
              "  readonly api = getSdk(this.requester);",
              ...(usage
                ? [
                    "",
                    `  ${lowerFirst(usage.name)}() {`,
                    "    // Returns a Promise; use `from(...)` from rxjs if you need an Observable.",
                    `    return this.api.${usage.name}(${usage.callableWithoutArguments ? "" : "/* TODO: variables */"});`,
                    "  }",
                  ]
                : []),
              "}",
              "",
            ].join("\n"),
          },
          ...argumentsNote(usage),
        ],
      },
      verifyStep(
        ["npx ng build"],
        [
          "NullInjectorError: No provider for HttpClient: add `provideHttpClient()` to the providers in `app.config.ts`.",
          "Cannot find module 'graphql': run `npm install graphql`.",
          "Requests blocked by CORS in the browser: the API must allow your site's origin.",
        ],
      ),
    ],
  };
}

function csharpGuide(result: GraphqlGenerateSuccess, filesStep: GuideStep, setup: ProjectSetup): Guide {
  const projectFile = `${result.destinationRoot}/${result.archiveRoot}.csproj`;
  const appDir = setup.mode === "new" ? `src/${NEW_DOTNET_PROJECT}` : PROJECT;
  const appProject = setup.mode === "new" ? `${appDir}/${NEW_DOTNET_PROJECT}.csproj` : `${PROJECT}/${PROJECT}.csproj`;
  const usage = csharpUsage(result);
  const exampleClass = usage ? `${usage.name}Example` : "";

  return {
    title: setup.mode === "new" ? "Create a .NET solution with the GraphQL client" : "Add the GraphQL client to your .NET solution",
    placeholders:
      setup.mode === "new"
        ? [ENDPOINT_PLACEHOLDER]
        : [ENDPOINT_PLACEHOLDER, { token: PROJECT, description: "The folder and project file name of your application project." }],
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
        : checkSetupStep(
            [
              "The .NET 10 SDK. The client project targets `net10.0`, so the project that uses it must target `net10.0` as well.",
              "A solution with your application project. The client becomes a separate project in `src/` next to it.",
              "An application with dependency injection, for example ASP.NET Core (`builder.Services`).",
            ],
            "a new project and one small edit to `Program.cs`",
          ),
      filesStep,
      {
        title: "Add the project to your solution",
        blocks: [
          { kind: "text", text: "From the solution folder, add the client project and reference it from your application project:" },
          { kind: "command", command: `dotnet sln add ${projectFile}` },
          { kind: "command", command: `dotnet add ${appProject} reference ${projectFile}` },
          {
            kind: "text",
            text: `The C# client is not in the ZIP: StrawberryShake generates it from \`schema.graphql\` and \`Operations.graphql\` when the project builds. \`${result.archiveRoot}.csproj\` references the \`StrawberryShake.Server\` NuGet package, which is restored on the next build.`,
          },
        ],
      },
      {
        title: "Register the client",
        blocks: [
          {
            kind: "text",
            text: "Edit `Program.cs`: after the builder is created (for example `var builder = WebApplication.CreateBuilder(args);`), register the GraphQL client. Keep the rest of the file as it is.",
          },
          {
            kind: "code",
            language: "csharp",
            file: `${appDir}/Program.cs`,
            action: "edit",
            code: [
              "builder.Services",
              "    .AddGraphQLClient()",
              `    // TODO: Replace ${ENDPOINT} with the URL of the GraphQL endpoint.`,
              `    .ConfigureHttpClient(client => client.BaseAddress = new Uri("${ENDPOINT}"));`,
              "",
            ].join("\n"),
          },
          {
            kind: "text",
            text: "If the API needs authentication, set the header in `ConfigureHttpClient`, for example `client.DefaultRequestHeaders.Authorization`.",
          },
        ],
      },
      usage
        ? {
            title: "Call an operation",
            blocks: [
              {
                kind: "text",
                text: `Create \`${appDir}/${exampleClass}.cs\`, which receives \`IGraphQLClient\` through dependency injection and calls \`${usage.operation.id}\`. Register it with \`builder.Services.AddTransient<${exampleClass}>();\` or inject \`IGraphQLClient\` into your own services and controllers.`,
              },
              {
                kind: "code",
                language: "csharp",
                file: `${appDir}/${exampleClass}.cs`,
                action: "create",
                code: [
                  `using ${result.archiveRoot};`,
                  "using StrawberryShake;",
                  "",
                  `public sealed class ${exampleClass}(IGraphQLClient client)`,
                  "{",
                  "    public async Task RunAsync(CancellationToken cancellationToken = default)",
                  "    {",
                  `        var result = await client.${usage.name}.ExecuteAsync(${usage.callableWithoutArguments ? (usage.csharpArguments ?? "") : "/* TODO: variables */ "}cancellationToken);`,
                  "        result.EnsureNoErrors();",
                  "        // TODO: Use result.Data.",
                  "    }",
                  "}",
                  "",
                ].join("\n"),
              },
              ...(usage.callableWithoutArguments
                ? []
                : [
                    {
                      kind: "text",
                      text: `\`${usage.operation.id}\` has variables: \`ExecuteAsync\` takes them as arguments, in the order of \`${usage.name}\` in \`Operations.graphql\`, before the cancellation token.`,
                    } satisfies GuideBlock,
                  ]),
            ],
          }
        : noUsageStep(),
      verifyStep(
        ["dotnet build"],
        [
          "NETSDK1045 (the current .NET SDK does not support targeting .NET 10.0): install the .NET 10 SDK.",
          "`IGraphQLClient` or `AddGraphQLClient` not found: build the solution once, so StrawberryShake generates the client, and check that `.graphqlrc.json` is in the client folder.",
          "Unable to resolve service for type 'ApiClient.IGraphQLClient': call `AddGraphQLClient()` in `Program.cs` before `builder.Build()`.",
        ],
      ),
    ],
  };
}

function checkSetupStep(items: string[], changes: string): GuideStep {
  return {
    title: "Check your project setup",
    blocks: [
      { kind: "text", text: "This guide assumes:" },
      { kind: "list", items },
      { kind: "text", text: `The steps add ${changes}, and make no other changes to your application files.` },
    ],
  };
}

function installStep(packages: readonly string[]): GuideStep {
  return {
    title: "Install dependencies",
    blocks: [
      {
        kind: "text",
        text: `The client needs ${packages.map((name) => `\`${name}\``).join(" and ")}. Add ${packages.length > 1 ? "them" : "it"} to your project:`,
      },
      { kind: "command", command: `npm install ${packages.join(" ")}` },
      { kind: "text", text: "ScrAPI checked the generated code with graphql 16.x." },
    ],
  };
}

function argumentsNote(usage: GraphqlUsage | undefined): GuideBlock[] {
  if (usage === undefined || usage.callableWithoutArguments) return [];
  return [
    {
      kind: "text",
      text: `\`${usage.operation.id}\` has required variables, so the call does not compile until you replace the TODO.${usage.variablesType === undefined ? "" : ` Their type is \`${usage.variablesType}\` in the generated \`graphql.ts\`.`}`,
    },
  ];
}

function noUsageStep(): GuideStep {
  return {
    title: "Call an operation",
    blocks: [
      {
        kind: "text",
        text: "ScrAPI could not find a generated method for the selected operations, so no example is shown. The client has one member per operation in `Operations.graphql`.",
      },
    ],
  };
}

/** Queries without required variables first, then the rest, in selection order. */
function preferred(operations: readonly GraphqlOperation[]): GraphqlOperation[] {
  const rank = (operation: GraphqlOperation) =>
    Number(operation.requiresInput) * 2 + Number(operation.operationType !== "query");
  return [...operations].sort((a, b) => rank(a) - rank(b));
}

/** An operation whose method is declared in the generated SDK (`Books(variables?: …)`). */
function typescriptUsage(result: GraphqlGenerateSuccess): GraphqlUsage | undefined {
  const sdk = result.files.find((file) => file.archivePath.endsWith("/graphql.ts"))?.content ?? "";
  for (const operation of preferred(result.operations)) {
    const declaration = new RegExp(`^\\s+${operation.name}\\(variables(\\??): (\\w+)`, "m").exec(sdk);
    if (declaration) {
      const usage: GraphqlUsage = { operation, name: operation.name, callableWithoutArguments: declaration[1] === "?" };
      if (declaration[2] !== undefined) usage.variablesType = declaration[2];
      return usage;
    }
  }
  return undefined;
}

/**
 * An operation defined in the generated Operations.graphql, which StrawberryShake
 * turns into `client.<Name>`. Its `ExecuteAsync` takes every variable as a
 * parameter named like the variable, so nullable variables are passed as `null`.
 */
function csharpUsage(result: GraphqlGenerateSuccess): GraphqlUsage | undefined {
  const document = result.files.find((file) => file.archivePath.endsWith("/Operations.graphql"))?.content ?? "";
  for (const operation of preferred(result.operations)) {
    const definition = new RegExp(`^${operation.operationType} ${operation.name}(?:\\(([^)]*)\\))?\\s*\\{`, "m").exec(document);
    if (!definition) continue;
    const variables = (definition[1] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    const required = variables.some((variable) => variable.endsWith("!"));
    const names = variables.map((variable) => /^\$(\w+)/.exec(variable)?.[1] ?? "");
    return {
      operation,
      name: operation.name,
      callableWithoutArguments: !required,
      csharpArguments: names.map((name) => `${name}: null, `).join(""),
    };
  }
  return undefined;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
