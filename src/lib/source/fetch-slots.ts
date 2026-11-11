import "server-only";

import { MAX_CONCURRENT_URL_FETCHES } from "@/lib/validation/limits";

/**
 * Process-wide resource counter (not request state): server-side URL loads in
 * progress, shared by `/api/fetch-source` and the MCP tools so together they
 * never exceed `MAX_CONCURRENT_URL_FETCHES`.
 */
let runningFetches = 0;

/** Runs `load` in a fetch slot, or returns `"busy"` without running it when all slots are taken. */
export async function withFetchSlot<T>(load: () => Promise<T>): Promise<T | "busy"> {
  if (runningFetches >= MAX_CONCURRENT_URL_FETCHES) return "busy";
  runningFetches += 1;
  try {
    return await load();
  } finally {
    runningFetches -= 1;
  }
}
