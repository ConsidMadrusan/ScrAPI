import "server-only";

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isSafeArchivePath } from "@/lib/archive/safe-path";
import { toArchivePath, toDestinationPath, type TargetConfig } from "@/lib/targets/config";
import type { GeneratedFile } from "@/lib/validation/responses";

/** Most files, and bytes, kept from one generation. */
export const MAX_OUTPUT_FILES = 2_000;
export const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

/**
 * Most files, and bytes, the generator may write in total, including the
 * scaffolding ScrAPI leaves out. Enforced while the generator runs, so a
 * large output cannot fill the temporary folder (often a memory-backed tmpfs)
 * before the run ends.
 */
export const MAX_GENERATOR_OUTPUT_FILES = 2 * MAX_OUTPUT_FILES;
export const MAX_GENERATOR_OUTPUT_BYTES = 2 * MAX_OUTPUT_BYTES;

export class OutputLimitError extends Error {
  override name = "OutputLimitError";
}

/**
 * Whether the generator output folder holds more than the generator output
 * limits. Stops counting as soon as a limit is passed. Meant to be polled
 * while the generator runs, so a folder that does not exist yet, or entries
 * that disappear while it is read, are not an error.
 */
export async function exceedsGeneratorOutputLimits(outputDir: string): Promise<boolean> {
  let files = 0;
  let bytes = 0;
  try {
    for await (const outputPath of walkFiles(outputDir)) {
      files += 1;
      bytes += (await stat(join(outputDir, ...outputPath.split("/")))).size;
      if (files > MAX_GENERATOR_OUTPUT_FILES || bytes > MAX_GENERATOR_OUTPUT_BYTES) return true;
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  return false;
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

/**
 * Regular files below `root`, as relative `/`-separated paths. Stops listing
 * once there are more than the generator may write.
 */
async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for await (const path of walkFiles(root)) {
    files.push(path);
    if (files.length > MAX_GENERATOR_OUTPUT_FILES) {
      throw new OutputLimitError("Generated output exceeds the size limits.");
    }
  }
  return files;
}

/** Yields the regular files below `root` one at a time, as relative `/`-separated paths. */
async function* walkFiles(root: string, relative = ""): AsyncGenerator<string> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) yield* walkFiles(root, path);
    else if (entry.isFile()) yield path;
    // Symbolic links and other special files are ignored.
  }
}
