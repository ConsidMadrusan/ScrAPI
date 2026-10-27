import { describe, expect, it, vi } from "vitest";
import { failureResponseSchema } from "./responses";
import {
  createConcurrencyLimiter,
  failure,
  withConcurrencyLimit,
  withProblemHandling,
} from "./route-handler";

const options = { logMessage: "Test crashed", userMessage: "Something went wrong. Try again." };
const request = new Request("http://localhost/api/test", { method: "POST" });

describe("failure", () => {
  it("returns the FailureResponse shape with the status", async () => {
    const response = failure(422, [{ code: "x", message: "Bad." }]);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, errors: [{ code: "x", message: "Bad." }] });
  });
});

describe("createConcurrencyLimiter", () => {
  it("hands out at most `max` slots and frees each slot once", () => {
    const limiter = createConcurrencyLimiter(2);
    const first = limiter.tryAcquire();
    const second = limiter.tryAcquire();

    expect(first).toBeTypeOf("function");
    expect(second).toBeTypeOf("function");
    expect(limiter.tryAcquire()).toBeUndefined();

    first?.();
    first?.();
    const third = limiter.tryAcquire();
    expect(third).toBeTypeOf("function");
    // Freeing `first` twice must not create an extra slot.
    expect(limiter.tryAcquire()).toBeUndefined();
  });
});

describe("withConcurrencyLimit", () => {
  const busy = { code: "busy", message: "Busy." };

  it("answers 503 without calling the handler while every slot is taken", async () => {
    let finish: () => void = () => undefined;
    const handler = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = () => {
            resolve(new Response("ok"));
          };
        }),
    );
    const limited = withConcurrencyLimit(createConcurrencyLimiter(1), busy, handler);

    const running = limited(request);
    const rejected = await limited(request);

    expect(rejected.status).toBe(503);
    expect(failureResponseSchema.parse(await rejected.json()).errors).toEqual([busy]);
    expect(handler).toHaveBeenCalledTimes(1);

    finish();
    expect(await (await running).text()).toBe("ok");
    // The slot is free again.
    const next = limited(request);
    finish();
    expect((await next).status).toBe(200);
  });

  it("frees the slot when the handler throws", async () => {
    const limiter = createConcurrencyLimiter(1);
    const limited = withConcurrencyLimit(limiter, busy, () => Promise.reject(new Error("boom")));

    await expect(limited(request)).rejects.toThrow("boom");
    expect(limiter.tryAcquire()).toBeTypeOf("function");
  });
});

describe("withProblemHandling", () => {
  it("returns the handler's response when it succeeds", async () => {
    const handler = withProblemHandling(() => Promise.resolve(new Response("ok")), options);
    expect(await (await handler(request)).text()).toBe("ok");
  });

  it("turns a thrown error into a generic 500 and logs only its type", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = withProblemHandling(
      () => Promise.reject(new TypeError("/tmp/scrapi-abc: secret details")),
      options,
    );

    const response = await handler(request);

    expect(response.status).toBe(500);
    const body = failureResponseSchema.parse(await response.json());
    expect(body.errors).toEqual([{ code: "internal", message: options.userMessage }]);
    expect(log).toHaveBeenCalledWith("Test crashed", { error: "TypeError" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    log.mockRestore();
  });
});
