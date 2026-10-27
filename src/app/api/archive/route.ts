import { buildResultZip } from "@/lib/archive/result-zip";
import { isSafeArchivePath } from "@/lib/archive/safe-path";
import { renderGuide } from "@/lib/guides/render";
import { MAX_ARCHIVE_REQUEST_BYTES } from "@/lib/validation/limits";
import { problemsFromZod, type Problem } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { generateSuccessSchema, type FailureResponse } from "@/lib/validation/responses";

const SAFE_FILE_NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Builds the ZIP for a generation result on the server. The guide inside it is
 * rendered from the same result the page shows. Unsafe archive paths are rejected.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_ARCHIVE_REQUEST_BYTES);
  if (!body.ok) return failure(body.status, [body.problem]);

  const input = generateSuccessSchema.safeParse(body.value);
  if (!input.success) return failure(400, problemsFromZod(input.error));
  const result = input.data;

  if (!result.files.every((file) => isSafeArchivePath(file.archivePath))) {
    return failure(422, [
      { code: "unsafe-archive-path", message: "The result contains a file path that cannot be archived." },
    ]);
  }

  let zip: Uint8Array;
  try {
    zip = await buildResultZip(result, renderGuide(result));
  } catch (error) {
    // Unexpected server problem: report its type only, never details or content.
    console.error("Archiving crashed", { error: error instanceof Error ? error.name : typeof error });
    return failure(500, [{ code: "internal", message: "The ZIP file could not be created. Try again." }]);
  }

  const fileName = SAFE_FILE_NAME.test(result.archiveRoot) ? result.archiveRoot : "api-client";
  return new Response(zip.slice().buffer, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileName}.zip"`,
      "cache-control": "no-store",
    },
  });
}

function failure(status: number, errors: Problem[]): Response {
  const response: FailureResponse = { ok: false, errors };
  return Response.json(response, { status });
}
