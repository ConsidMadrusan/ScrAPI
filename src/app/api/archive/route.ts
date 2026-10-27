import { buildResultZip, checkArchivable } from "@/lib/archive/result-zip";
import { renderGuide } from "@/lib/guides/render";
import { MAX_ARCHIVE_REQUEST_BYTES, MAX_CONCURRENT_ARCHIVES } from "@/lib/validation/limits";
import { problemsFromZod, type Problem } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { generateSuccessSchema, type FailureResponse } from "@/lib/validation/responses";

/** Process-wide resource counter (not request state): ZIP requests in progress. */
let runningArchives = 0;

/**
 * Builds the ZIP for a generation result on the server. The guide inside it is
 * rendered from the same result the page shows. Results that generation could
 * not have produced (unsafe paths, other roots, over the output limits) are
 * rejected, and at most MAX_CONCURRENT_ARCHIVES requests are handled at once.
 */
export async function POST(request: Request): Promise<Response> {
  if (runningArchives >= MAX_CONCURRENT_ARCHIVES) {
    return failure(503, [
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
  if (!body.ok) return failure(body.status, [body.problem]);

  const input = generateSuccessSchema.safeParse(body.value);
  if (!input.success) return failure(400, problemsFromZod(input.error));
  const result = input.data;

  const rejection = checkArchivable(result);
  if (rejection !== undefined) return failure(rejection.status, [rejection.problem]);

  let zip: Uint8Array;
  try {
    zip = await buildResultZip(result, renderGuide(result));
  } catch (error) {
    // Unexpected server problem: report its type only, never details or content.
    console.error("Archiving crashed", { error: error instanceof Error ? error.name : typeof error });
    return failure(500, [{ code: "internal", message: "The ZIP file could not be created. Try again." }]);
  }

  // checkArchivable ensured the root comes from target configuration.
  return new Response(zip.slice().buffer, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${result.archiveRoot}.zip"`,
      "cache-control": "no-store",
    },
  });
}

function failure(status: number, errors: Problem[]): Response {
  const response: FailureResponse = { ok: false, errors };
  return Response.json(response, { status });
}
