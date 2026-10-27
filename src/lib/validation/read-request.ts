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

  const text = await readTextWithin(request, maxBytes);
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
 * Reads the body as UTF-8 text, counting bytes as they arrive. Stops and
 * cancels the stream as soon as the total passes `maxBytes`, so bodies sent
 * without (or with a wrong) Content-Length are never buffered in full.
 * Returns `undefined` when the body is too large.
 */
async function readTextWithin(
  request: Request,
  maxBytes: number,
): Promise<string | undefined> {
  if (request.body === null) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
