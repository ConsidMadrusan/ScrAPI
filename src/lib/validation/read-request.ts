import { formatMegabytes } from "./limits";
import type { Problem } from "./problems";

export type ReadBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 408 | 413; problem: Problem };

/**
 * Reads a JSON request body, rejecting bodies over `maxBytes` before parsing.
 * Gives up with 408 when the whole body has not arrived within `timeoutMs`,
 * so a client that sends its body slowly cannot hold the caller's
 * concurrency slot for long.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
  timeoutMs: number,
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

  const read = await readTextWithin(request, maxBytes, timeoutMs);
  if (read.kind === "too-large") return tooLarge;
  if (read.kind === "timeout") {
    return {
      ok: false,
      status: 408,
      problem: {
        code: "request-timeout",
        message: "The request body took too long to arrive. Try again.",
      },
    };
  }

  try {
    return { ok: true, value: JSON.parse(read.text) as unknown };
  } catch {
    return {
      ok: false,
      status: 400,
      problem: { code: "invalid-request", message: "The request body must be JSON." },
    };
  }
}

type ReadTextResult =
  | { kind: "text"; text: string }
  | { kind: "too-large" }
  | { kind: "timeout" };

/**
 * Reads the body as UTF-8 text, counting bytes as they arrive. Stops and
 * cancels the stream as soon as the total passes `maxBytes`, so bodies sent
 * without (or with a wrong) Content-Length are never buffered in full. Also
 * cancels the stream when the body is not complete after `timeoutMs`.
 */
async function readTextWithin(
  request: Request,
  maxBytes: number,
  timeoutMs: number,
): Promise<ReadTextResult> {
  if (request.body === null) return { kind: "text", text: "" };

  const reader = request.body.getReader();
  // An object, so the check after `await` is not narrowed to its initial value.
  const deadline = { passed: false };
  // Cancelling the reader settles a pending read() with `done`, which ends the loop.
  const timer = setTimeout(() => {
    deadline.passed = true;
    reader.cancel().catch(() => undefined);
  }, timeoutMs);

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (deadline.passed) return { kind: "timeout" };
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { kind: "too-large" };
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "text", text: new TextDecoder().decode(bytes) };
}
