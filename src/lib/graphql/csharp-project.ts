/**
 * The files of the C# GraphQL client project. StrawberryShake generates the
 * C# client from them during the user's own `dotnet build`; ScrAPI generates
 * no C# code. Verified with StrawberryShake.Server 16.7.5 and .NET 10 (see
 * CLAUDE.md, "GraphQL targets"). Re-verify when changing the version.
 */

export const STRAWBERRY_SHAKE_VERSION = "16.7.5";

/** Name of the generated client: the interface is `IGraphQLClient`, registered with `AddGraphQLClient()`. */
export const CSHARP_CLIENT_NAME = "GraphQLClient";

export function csharpProjectFile(namespace: string): string {
  return `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>${namespace}</RootNamespace>
  </PropertyGroup>

  <ItemGroup>
    <!-- Generates the typed client from the .graphql files on build. -->
    <PackageReference Include="StrawberryShake.Server" Version="${STRAWBERRY_SHAKE_VERSION}" />
  </ItemGroup>

</Project>
`;
}

export function graphqlConfigFile(namespace: string): string {
  return `${JSON.stringify(
    {
      schema: "schema.graphql",
      documents: "**/*.graphql",
      extensions: {
        strawberryShake: {
          name: CSHARP_CLIENT_NAME,
          namespace,
          dependencyInjection: true,
          transportProfiles: [{ default: "HTTP", subscription: "WebSocket" }],
        },
      },
    },
    null,
    2,
  )}\n`;
}

/** The client directives StrawberryShake expects next to the schema (as `dotnet graphql init` writes them). */
export const SCHEMA_EXTENSIONS = `scalar _KeyFieldSet

directive @key(fields: _KeyFieldSet!) on SCHEMA | OBJECT

directive @serializationType(name: String!) on SCALAR

directive @runtimeType(name: String!) on SCALAR

directive @enumValue(value: String!) on ENUM_VALUE

directive @rename(name: String!) on INPUT_FIELD_DEFINITION | INPUT_OBJECT | ENUM | ENUM_VALUE

extend schema @key(fields: "id")
`;
