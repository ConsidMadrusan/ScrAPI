import "server-only";

import { GUIDE_FILE_NAME, renderGuideMarkdown } from "@/lib/guides/markdown";
import type { Guide } from "@/lib/guides/types";
import { resolveTarget, toDestinationPath } from "@/lib/targets/config";
import { formatMegabytes, MAX_OUTPUT_BYTES, utf8ByteLength } from "@/lib/validation/limits";
import type { Problem } from "@/lib/validation/problems";
import type { GenerateSuccess } from "@/lib/validation/responses";
import { isSafeArchivePath } from "./safe-path";
import { buildZip, type ArchiveEntry } from "./zip";

export interface ArchiveRejection {
  status: 413 | 422;
  problem: Problem;
}

/**
 * Checks a submitted result against what generation can produce: safe paths,
 * the roots of its target configuration, and the generation output limits.
 */
export function checkArchivable(result: GenerateSuccess): ArchiveRejection | undefined {
  if (!result.files.every((file) => isSafeArchivePath(file.archivePath))) {
    return {
      status: 422,
      problem: { code: "unsafe-archive-path", message: "The result contains a file path that cannot be archived." },
    };
  }

  const target = resolveTarget(result.options);
  const matchesTarget =
    result.archiveRoot === target.archiveRoot &&
    result.destinationRoot === target.destinationRoot &&
    result.files.every(
      (file) =>
        file.archivePath.startsWith(`${target.archiveRoot}/`) &&
        file.destinationPath === toDestinationPath(target, file.archivePath),
    );
  if (!matchesTarget) {
    return {
      status: 422,
      problem: {
        code: "result-mismatch",
        message: "The result does not match the selected target. Generate the client again.",
      },
    };
  }

  let totalBytes = 0;
  for (const file of result.files) {
    totalBytes += utf8ByteLength(file.content);
    if (totalBytes > MAX_OUTPUT_BYTES) {
      return {
        status: 413,
        problem: {
          code: "too-large",
          message: `The generated files are larger than ${formatMegabytes(MAX_OUTPUT_BYTES)}.`,
        },
      };
    }
  }
  return undefined;
}

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
