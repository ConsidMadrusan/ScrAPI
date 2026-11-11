import { fetchUrl } from "@/lib/source/fetch-url";
import { withFetchSlot } from "@/lib/source/fetch-slots";
import { MAX_FETCH_REQUEST_BYTES } from "@/lib/validation/limits";
import { failureResponse, internalErrorResponse } from "@/lib/validation/http";
import { problemsFromZod } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { fetchSourceRequestSchema } from "@/lib/validation/requests";
import type { FetchSourceSuccess } from "@/lib/validation/responses";

/**
 * Loads a URL for the browser when the browser cannot (CORS). Public
 * addresses only, unless SCRAPI_ALLOW_PRIVATE_URLS=true (see fetch-url.ts).
 * The URL, headers, and response are never logged or stored.
 */
export async function POST(request: Request): Promise<Response> {
  const response = await withFetchSlot(async () => {
    try {
      const body = await readJsonBody(request, MAX_FETCH_REQUEST_BYTES);
      if (!body.ok) return failureResponse(body.status, [body.problem]);

      const input = fetchSourceRequestSchema.safeParse(body.value);
      if (!input.success) return failureResponse(400, problemsFromZod(input.error));

      const result = await fetchUrl(input.data.url, input.data.kind, input.data.headers, request.signal);
      if (!result.ok) return failureResponse(422, result.errors);
      const success: FetchSourceSuccess = { ok: true, ...result.value };
      return Response.json(success, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return internalErrorResponse("URL loading crashed", error, "Something went wrong while loading the URL. Try again.");
    }
  });
  if (response === "busy") {
    return failureResponse(503, [{ code: "fetch-busy", message: "The server is busy loading other URLs. Try again in a moment." }]);
  }
  return response;
}
