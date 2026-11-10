import { formatMegabytes } from "./limits";
import type { Problem } from "./problems";

export type ReadBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; problem: Problem };

/** Reads a JSON request body, rejecting bodies over `maxBytes` before parsing. */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<ReadBodyResult> {
  const tooLarge: ReadBodyResult = {
    ok: false,
    status: 413,
    problem: {
      code: "too-large",
      message: `The request is larger than ${formatMegabytes(maxBytes)}.`,
    },
  };

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return tooLarge;

  let text: string | undefined;
  try {
    text = await readTextUpTo(request.body, maxBytes);
  } catch {
    // The client disconnected or the connection failed while sending the body.
    return {
      ok: false,
      status: 400,
      problem: {
        code: "request-interrupted",
        message: "The request was interrupted before it was fully received. Try again.",
      },
    };
  }
  if (text === undefined) return tooLarge;

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      status: 400,
      problem: { code: "invalid-request", message: "The request body must be JSON." },
    };
  }
}

/**
 * Streams a request or response body as UTF-8 text and stops reading as soon
 * as it exceeds `maxBytes`, so a body without (or with a false) Content-Length
 * is never buffered beyond the limit. Returns undefined when the body is too
 * large. Used on the server for requests and in the browser for loaded URLs.
 */
export async function readTextUpTo(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | undefined> {
  if (body === null) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
}
