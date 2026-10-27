const MAX_PATH_LENGTH = 512;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * True for relative, `/`-separated paths that stay inside the archive root:
 * no absolute paths, drive letters, backslashes, empty, `.` or `..` segments,
 * or control characters.
 */
export function isSafeArchivePath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (path.startsWith("/") || path.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  if (CONTROL_CHARACTERS.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
