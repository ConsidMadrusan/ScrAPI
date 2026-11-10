/**
 * Input checks shared by the browser and the server. YAML and Swagger 2.0 are
 * converted on the server only (see normalize.ts), so the browser's quick
 * checks skip such input and leave it to the server.
 */

/** JSON documents start with `{` or `[` (after a BOM and whitespace); anything else is read as YAML. */
export function looksLikeJson(text: string): boolean {
  return /^﻿?\s*[{[]/.test(text);
}

/** True for input the server converts before validating: YAML, or Swagger 2.0 JSON. */
export function needsServerConversion(text: string): boolean {
  if (text.trim() === "") return false;
  if (!looksLikeJson(text)) return true;
  // A cheap textual check; the server decides on the parsed document.
  return /"swagger"\s*:\s*"2\.0"/.test(text);
}
