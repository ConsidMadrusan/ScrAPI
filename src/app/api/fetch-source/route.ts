import { fetchUrl } from "@/lib/source/fetch-url";
import { MAX_CONCURRENT_URL_FETCHES } from "@/lib/validation/limits";
import { problemsFromZod, type Problem } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { fetchSourceRequestSchema } from "@/lib/validation/requests";
import type { FailureResponse, FetchSourceSuccess } from "@/lib/validation/responses";

/** Process-wide resource counter (not request state): server-side URL loads in progress. */
let runningFetches = 0;

/** Small request bodies only: a URL and a few headers. */
const MAX_FETCH_REQUEST_BYTES = 64 * 1024;

/**
 * Loads a URL for the browser when the browser cannot (CORS). Public
 * addresses only, unless SCRAPI_ALLOW_PRIVATE_URLS=true (see fetch-url.ts).
 * The URL, headers, and response are never logged or stored.
 */
export async function POST(request: Request): Promise<Response> {
  if (runningFetches >= MAX_CONCURRENT_URL_FETCHES) {
    return failure(503, [{ code: "fetch-busy", message: "The server is busy loading other URLs. Try again in a moment." }]);
  }
  runningFetches += 1;
  try {
    const body = await readJsonBody(request, MAX_FETCH_REQUEST_BYTES);
    if (!body.ok) return failure(body.status, [body.problem]);

    const input = fetchSourceRequestSchema.safeParse(body.value);
    if (!input.success) return failure(400, problemsFromZod(input.error));

    const result = await fetchUrl(input.data.url, input.data.kind, input.data.headers, request.signal);
    if (!result.ok) return failure(422, result.errors);
    const response: FetchSourceSuccess = { ok: true, ...result.value };
    return Response.json(response, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // Unexpected server problem: report its type only, never the URL or content.
    console.error("URL loading crashed", { error: error instanceof Error ? error.name : typeof error });
    return failure(500, [{ code: "internal", message: "Something went wrong while loading the URL. Try again." }]);
  } finally {
    runningFetches -= 1;
  }
}

function failure(status: number, errors: Problem[]): Response {
  const response: FailureResponse = { ok: false, errors };
  return Response.json(response, { status });
}
