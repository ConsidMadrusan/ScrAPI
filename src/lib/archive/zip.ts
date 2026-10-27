import "server-only";

import JSZip from "jszip";
import { isSafeArchivePath } from "./safe-path";

export interface ArchiveEntry {
  archivePath: string;
  content: string;
}

/** Fixed timestamp so the same files always produce the same archive. */
const ENTRY_DATE = new Date("1980-01-01T00:00:00Z");

/** Builds a ZIP from text files. Rejects any path that could escape the archive. */
export async function buildZip(entries: readonly ArchiveEntry[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const entry of entries) {
    if (!isSafeArchivePath(entry.archivePath)) {
      throw new Error(`Unsafe archive path: ${entry.archivePath}`);
    }
    zip.file(entry.archivePath, entry.content, { date: ENTRY_DATE, createFolders: false });
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
