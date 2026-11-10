import { ARCHIVE_FILE_NAME } from "@/lib/archive/names";
import { buildResultZip, checkArchivableAll } from "@/lib/archive/result-zip";
import { renderChainedGuide } from "@/lib/guides/chained";
import { MAX_ARCHIVE_REQUEST_BYTES, MAX_CONCURRENT_ARCHIVES } from "@/lib/validation/limits";
import { failureResponse, internalErrorResponse } from "@/lib/validation/http";
import { problemsFromZod } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { archiveRequestSchema } from "@/lib/validation/responses";

/** Process-wide resource counter (not request state): ZIP requests in progress. */
let runningArchives = 0;

/**
 * Builds one ZIP for the results of a generation run on the server, with one
 * folder per framework combination. The guide inside it is rendered from the
 * same results the page shows. Results that generation could not have produced
 * (unsafe paths, other roots, duplicate combinations, over the output limits)
 * are rejected, and at most MAX_CONCURRENT_ARCHIVES requests are handled at once.
 */
export async function POST(request: Request): Promise<Response> {
  if (runningArchives >= MAX_CONCURRENT_ARCHIVES) {
    return failureResponse(503, [
      { code: "archive-busy", message: "The server is busy creating other ZIP files. Try again in a moment." },
    ]);
  }
  runningArchives += 1;
  try {
    return await archive(request);
  } finally {
    runningArchives -= 1;
  }
}

async function archive(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_ARCHIVE_REQUEST_BYTES);
  if (!body.ok) return failureResponse(body.status, [body.problem]);

  const input = archiveRequestSchema.safeParse(body.value);
  if (!input.success) return failureResponse(400, problemsFromZod(input.error));
  const { results, project } = input.data;

  const rejection = checkArchivableAll(results);
  if (rejection !== undefined) return failureResponse(rejection.status, [rejection.problem]);

  let zip: Uint8Array;
  try {
    // Folder names come from the combination keys, never from the request.
    zip = await buildResultZip(renderChainedGuide(results, project));
  } catch (error) {
    return internalErrorResponse("Archiving crashed", error, "The ZIP file could not be created. Try again.");
  }

  return new Response(zip.slice().buffer, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${ARCHIVE_FILE_NAME}"`,
      "cache-control": "no-store",
    },
  });
}
