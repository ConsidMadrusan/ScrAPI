import { describe, expect, it } from "vitest";
import { MAX_CONCURRENT_URL_FETCHES } from "@/lib/validation/limits";
import { withFetchSlot } from "./fetch-slots";

describe("withFetchSlot", () => {
  it("refuses a load while every slot is taken and frees slots afterwards", async () => {
    const releases: (() => void)[] = [];
    const running = Array.from({ length: MAX_CONCURRENT_URL_FETCHES }, () =>
      withFetchSlot(
        () =>
          new Promise<string>((resolve) => {
            releases.push(() => {
              resolve("done");
            });
          }),
      ),
    );

    await expect(withFetchSlot(() => Promise.resolve("extra"))).resolves.toBe("busy");

    for (const release of releases) release();
    await expect(Promise.all(running)).resolves.toEqual(Array<string>(MAX_CONCURRENT_URL_FETCHES).fill("done"));
    await expect(withFetchSlot(() => Promise.resolve("next"))).resolves.toBe("next");
  });

  it("frees the slot when the load fails", async () => {
    for (let attempt = 0; attempt <= MAX_CONCURRENT_URL_FETCHES; attempt += 1) {
      await expect(withFetchSlot(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    }
    await expect(withFetchSlot(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});
