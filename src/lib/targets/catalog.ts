import type { GenerationOptions, HttpClient, TargetId } from "@/lib/validation/requests";

export interface TargetDescription {
  id: TargetId;
  label: string;
  description: string;
  /** Whether the user chooses an HTTP client for this target. */
  hasHttpClient: boolean;
}

/** Display information for each output target, in the order they are offered. */
export const TARGETS: readonly TargetDescription[] = [
  {
    id: "typescript-next",
    label: "TypeScript for Next.js / React",
    description: "Typed models and API classes for a Next.js App Router project.",
    hasHttpClient: true,
  },
  {
    id: "typescript-nuxt",
    label: "TypeScript for Nuxt / Vue",
    description: "Typed models and API classes for a Nuxt project.",
    hasHttpClient: true,
  },
  {
    id: "typescript-angular",
    label: "TypeScript for Angular",
    description: "Typed models and injectable API services for an Angular project.",
    hasHttpClient: false,
  },
  {
    id: "csharp",
    label: "C# / .NET",
    description: "A .NET client library with typed models and API classes.",
    hasHttpClient: false,
  },
];

export const HTTP_CLIENT_LABELS: Record<HttpClient, { label: string; description: string }> = {
  axios: {
    label: "axios",
    description: "Uses the axios package, which you add to your project.",
  },
  fetch: {
    label: "fetch",
    description: "Uses the built-in Fetch API. No extra dependency.",
  },
};

export const DEFAULT_HTTP_CLIENT: HttpClient = "axios";
export const DEFAULT_TARGET: TargetId = "typescript-next";

/** Generation options for a target; the HTTP client applies only where the target uses one. */
export function optionsFor(target: TargetId, httpClient: HttpClient): GenerationOptions {
  switch (target) {
    case "typescript-next":
    case "typescript-nuxt":
      return { target, httpClient };
    case "csharp":
    case "typescript-angular":
      return { target };
  }
}
