import "server-only";

import { loadUrlSource, type UrlSourceKind } from "@/lib/source/load-url";
import type { Problem } from "@/lib/validation/problems";

export interface SourceInput {
  source?: string | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
  kind: UrlSourceKind;
}

/**
 * The API description text for a tool call: the given `source`, or the
 * document loaded from `url` by ScrAPI's server (see `loadUrlSource`).
 * The schemas guarantee exactly one of the two.
 */
export async function resolveSourceText(
  input: SourceInput,
  signal?: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; problems: Problem[] }> {
  if (input.source !== undefined) return { ok: true, text: input.source };
  if (input.url === undefined) {
    return { ok: false, problems: [{ code: "missing-source", message: "Give either source or url." }] };
  }
  const loaded = await loadUrlSource(input.url, input.headers ?? {}, input.kind, signal);
  return loaded.ok ? { ok: true, text: loaded.text } : { ok: false, problems: loaded.errors.map(forAgent) };
}

/**
 * The URL loader's messages are written for the web app ("upload the file");
 * an agent passes the contents as `source` instead.
 */
export function forAgent(problem: Problem): Problem {
  if (problem.code === "private-url") {
    return {
      ...problem,
      message:
        "ScrAPI's server only loads public internet addresses. Read the description yourself and pass its contents as source, or use a ScrAPI server in that network with SCRAPI_ALLOW_PRIVATE_URLS=true.",
    };
  }
  return {
    ...problem,
    message: problem.message
      .replace(/download the file and upload it/g, "read the description yourself and pass its contents as source")
      .replace(/Download the file and upload it instead\./g, "Read the description yourself and pass its contents as source instead."),
  };
}
