import "server-only";

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isSafeArchivePath } from "@/lib/archive/safe-path";
import { toArchivePath, toDestinationPath, type TargetConfig } from "@/lib/targets/config";
import type { GeneratedFile } from "@/lib/validation/responses";

export const MAX_OUTPUT_FILES = 2_000;
export const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export class OutputLimitError extends Error {
  override name = "OutputLimitError";
}

/**
 * Reads the files a target keeps from the generator output folder, sorted by
 * archive path. Symbolic links and unsafe paths are never followed or kept.
 */
export async function collectOutput(outputDir: string, target: TargetConfig): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  let totalBytes = 0;

  for (const outputPath of await listFiles(outputDir)) {
    const archivePath = toArchivePath(target, outputPath);
    if (archivePath === undefined || !isSafeArchivePath(archivePath)) continue;

    const absolutePath = join(outputDir, ...outputPath.split("/"));
    totalBytes += (await stat(absolutePath)).size;
    if (files.length + 1 > MAX_OUTPUT_FILES || totalBytes > MAX_OUTPUT_BYTES) {
      throw new OutputLimitError("Generated output exceeds the size limits.");
    }
    files.push({
      archivePath,
      destinationPath: toDestinationPath(target, archivePath),
      content: await readFile(absolutePath, "utf8"),
    });
  }

  return files.sort((a, b) => (a.archivePath < b.archivePath ? -1 : 1));
}

/** Regular files below `root`, as relative `/`-separated paths. */
async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
    // Symbolic links and other special files are ignored.
  }
  return files;
}
