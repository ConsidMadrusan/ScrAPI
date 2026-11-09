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

/** Every supported framework combination, in the order they are generated and shown. */
export const COMBINATIONS: readonly GenerationOptions[] = [
  { target: "typescript-next", httpClient: "axios" },
  { target: "typescript-next", httpClient: "fetch" },
  { target: "typescript-nuxt", httpClient: "axios" },
  { target: "typescript-nuxt", httpClient: "fetch" },
  { target: "typescript-angular" },
  { target: "csharp" },
];

const TARGET_SLUGS: Record<TargetId, string> = {
  "typescript-next": "nextjs",
  "typescript-nuxt": "nuxt",
  "typescript-angular": "angular",
  csharp: "csharp",
};

/**
 * Stable identifier of a framework combination, e.g. `nextjs-axios`. Also the
 * name of the combination's folder in the ZIP.
 */
export function combinationKey(options: GenerationOptions): string {
  const slug = TARGET_SLUGS[options.target];
  return "httpClient" in options ? `${slug}-${options.httpClient}` : slug;
}

/** Display name of a framework combination, e.g. `TypeScript for Next.js / React (axios)`. */
export function combinationLabel(options: GenerationOptions): string {
  const label = TARGETS.find((target) => target.id === options.target)?.label ?? options.target;
  return "httpClient" in options ? `${label} (${HTTP_CLIENT_LABELS[options.httpClient].label})` : label;
}

/** Combinations in the order of `COMBINATIONS`, without duplicates. */
export function sortCombinations(combinations: readonly GenerationOptions[]): GenerationOptions[] {
  const keys = new Set(combinations.map(combinationKey));
  return COMBINATIONS.filter((options) => keys.has(combinationKey(options)));
}
