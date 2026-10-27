import { describe, expect, it, vi } from "vitest";
import { failureResponseSchema } from "./responses";
import { failure, withProblemHandling } from "./route-handler";

const options = { logMessage: "Test crashed", userMessage: "Something went wrong. Try again." };
const request = new Request("http://localhost/api/test", { method: "POST" });

describe("failure", () => {
  it("returns the FailureResponse shape with the status", async () => {
    const response = failure(422, [{ code: "x", message: "Bad." }]);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, errors: [{ code: "x", message: "Bad." }] });
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
