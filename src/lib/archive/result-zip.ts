import "server-only";

import { GUIDE_FILE_NAME, renderGuideMarkdown } from "@/lib/guides/markdown";
import type { Guide } from "@/lib/guides/types";
import type { GenerateSuccess } from "@/lib/validation/responses";
import { buildZip, type ArchiveEntry } from "./zip";

/** ZIP entries for a result: its files plus the guide, from the same result. */
export function resultEntries(result: GenerateSuccess, guide: Guide): ArchiveEntry[] {
  return [
    ...result.files.map(({ archivePath, content }) => ({ archivePath, content })),
    { archivePath: GUIDE_FILE_NAME, content: renderGuideMarkdown(guide, result) },
  ];
}

export function buildResultZip(result: GenerateSuccess, guide: Guide): Promise<Uint8Array> {
  return buildZip(resultEntries(result, guide));
}
