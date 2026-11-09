import "server-only";

import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isSafeArchivePath } from "@/lib/archive/safe-path";
import { toArchivePath, toDestinationPath, withoutGenericArity, type TargetConfig } from "@/lib/targets/config";
import { MAX_OUTPUT_BYTES, MAX_OUTPUT_FILES } from "@/lib/validation/limits";
import type { GeneratedFile } from "@/lib/validation/responses";

export { MAX_OUTPUT_BYTES, MAX_OUTPUT_FILES };

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

  const kept = (await listFiles(outputDir)).flatMap((outputPath) => {
    const archivePath = toArchivePath(target, outputPath);
    return archivePath === undefined || !isSafeArchivePath(archivePath) ? [] : [{ outputPath, archivePath }];
  });
  const rename = renamer(target, kept.map((file) => file.archivePath));

  for (const { outputPath, archivePath: generatedPath } of kept) {
    const archivePath = rename(generatedPath);

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

/**
 * Final archive path of each kept file: generic-type names lose their arity
 * suffix where the target asks for it, unless that would clash with another file.
 */
function renamer(target: TargetConfig, archivePaths: readonly string[]): (archivePath: string) => string {
  if (target.dropGenericArity !== true) return (archivePath) => archivePath;
  const counts = new Map<string, number>();
  for (const path of archivePaths) {
    const renamed = withoutGenericArity(path);
    counts.set(renamed, (counts.get(renamed) ?? 0) + 1);
  }
  return (archivePath) => {
    const renamed = withoutGenericArity(archivePath);
    return counts.get(renamed) === 1 ? renamed : archivePath;
  };
}

/**
 * Disk limits for the raw generator output while the generator runs. They are
 * above the result limits because scaffolding the targets drop also lands on disk.
 */
export const MAX_RAW_OUTPUT_ENTRIES = 2 * MAX_OUTPUT_FILES;
export const MAX_RAW_OUTPUT_BYTES = 2 * MAX_OUTPUT_BYTES;

/**
 * Whether the folder below `root` holds more entries or bytes than the raw
 * output limits. Symbolic links are not followed; a missing folder (not
 * created yet) or entries removed while reading count as empty.
 */
export async function exceedsRawOutputLimits(root: string): Promise<boolean> {
  let entries = 0;
  let bytes = 0;
  const pending = [root];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      const path = join(dir, name);
      const stats = await lstat(path).catch(() => undefined);
      if (stats === undefined) continue;
      entries += 1;
      bytes += stats.size;
      if (entries > MAX_RAW_OUTPUT_ENTRIES || bytes > MAX_RAW_OUTPUT_BYTES) return true;
      if (stats.isDirectory()) pending.push(path);
    }
  }
  return false;
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
