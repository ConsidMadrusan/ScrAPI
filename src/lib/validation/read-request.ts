import { formatMegabytes, utf8ByteLength } from "./limits";
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

  const text = await request.text();
  if (utf8ByteLength(text) > maxBytes) return tooLarge;

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
