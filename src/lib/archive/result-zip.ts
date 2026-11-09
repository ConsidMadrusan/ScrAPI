import "server-only";

import { zipPath, type ChainedGuide } from "@/lib/guides/chained";
import { GUIDE_FILE_NAME, renderGuideMarkdown } from "@/lib/guides/markdown";
import { combinationKey } from "@/lib/targets/catalog";
import { resolveTarget, toDestinationPath } from "@/lib/targets/config";
import {
  formatMegabytes,
  MAX_COMBINED_OUTPUT_BYTES,
  MAX_OUTPUT_BYTES,
  utf8ByteLength,
} from "@/lib/validation/limits";
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

/**
 * Checks the results of one generation run before they are combined into a
 * ZIP: each must pass `checkArchivable`, no framework combination may appear
 * twice (they would share a folder), and their combined size stays within limits.
 */
export function checkArchivableAll(results: readonly GenerateSuccess[]): ArchiveRejection | undefined {
  const keys = results.map((result) => combinationKey(result.options));
  if (new Set(keys).size !== keys.length) {
    return {
      status: 422,
      problem: {
        code: "duplicate-combination",
        message: "A framework combination appears more than once. Generate the clients again.",
      },
    };
  }

  for (const result of results) {
    const rejection = checkArchivable(result);
    if (rejection !== undefined) return rejection;
  }

  const totalBytes = results
    .flatMap((result) => result.files)
    .reduce((sum, file) => sum + utf8ByteLength(file.content), 0);
  if (totalBytes > MAX_COMBINED_OUTPUT_BYTES) {
    return {
      status: 413,
      problem: {
        code: "too-large",
        message: `The generated files are larger than ${formatMegabytes(MAX_COMBINED_OUTPUT_BYTES)} together. Select fewer framework combinations.`,
      },
    };
  }
  return undefined;
}

/**
 * ZIP entries for a chained guide: each section's files in the folder named
 * after its combination, plus the guide, all from the same results.
 */
export function resultEntries(guide: ChainedGuide): ArchiveEntry[] {
  return [
    ...guide.sections.flatMap((section) =>
      section.result.files.map(({ archivePath, content }) => ({
        archivePath: zipPath(section, archivePath),
        content,
      })),
    ),
    { archivePath: GUIDE_FILE_NAME, content: renderGuideMarkdown(guide) },
  ];
}

export function buildResultZip(guide: ChainedGuide): Promise<Uint8Array> {
  return buildZip(resultEntries(guide));
}
