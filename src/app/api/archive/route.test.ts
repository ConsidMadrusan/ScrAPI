import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ARCHIVE_FILE_NAME } from "@/lib/archive/names";
import { renderChainedGuide } from "@/lib/guides/chained";
import { GUIDE_FILE_NAME, renderGuideMarkdown } from "@/lib/guides/markdown";
import {
  MAX_ARCHIVE_REQUEST_BYTES,
  MAX_COMBINATIONS,
  MAX_CONCURRENT_ARCHIVES,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_FILES,
} from "@/lib/validation/limits";
import { failureResponseSchema } from "@/lib/validation/responses";
import type { GenerateSuccess } from "@/lib/validation/responses";
import { ALL_OPTIONS, generationResult } from "@/test/generation-fixtures";
import { POST } from "./route";

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/archive", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );
}

const result = generationResult({ target: "typescript-next", httpClient: "axios" });

/** A ZIP request body with the given results (by default only `result`). */
function body(...results: unknown[]): string {
  return JSON.stringify({ results: results.length > 0 ? results : [result], project: "existing" });
}

describe("POST /api/archive", () => {
  it("returns one ZIP with a folder per combination and the guide rendered from the same results", async () => {
    const results: GenerateSuccess[] = [result, generationResult({ target: "csharp" })];

    const response = await post(body(...results));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${ARCHIVE_FILE_NAME}"`);
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    for (const [folder, item] of [["nextjs-axios", result], ["csharp", results[1]]] as const) {
      for (const file of item?.files ?? []) {
        expect(await zip.file(`${folder}/${file.archivePath}`)?.async("string")).toBe(file.content);
      }
    }
    expect(await zip.file(GUIDE_FILE_NAME)?.async("string")).toBe(
      renderGuideMarkdown(renderChainedGuide(results, "existing")),
    );
  });

  it("puts the guide for new projects in the ZIP when asked", async () => {
    const response = await post(JSON.stringify({ results: [result], project: "new" }));

    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const guide = await zip.file(GUIDE_FILE_NAME)?.async("string");
    expect(guide).toBe(renderGuideMarkdown(renderChainedGuide([result], "new")));
    expect(guide).toContain("npx create-next-app@16");
  });

  it("accepts every combination at once", async () => {
    const response = await post(body(...ALL_OPTIONS.map((options) => generationResult(options))));

    expect(response.status).toBe(200);
  });

  it.each([
    ["no results", JSON.stringify({ results: [] })],
    ["too many results", JSON.stringify({ results: Array.from({ length: MAX_COMBINATIONS + 1 }, () => result) })],
    ["a bare result", JSON.stringify(result)],
    ["no project mode", JSON.stringify({ results: [result] })],
    ["an unknown project mode", JSON.stringify({ results: [result], project: "template" })],
  ])("rejects a body with %s", async (_name, invalid) => {
    const response = await post(invalid);

    expect(response.status).toBe(400);
    expect(failureResponseSchema.parse(await response.json()).errors[0]?.code).toBe("invalid-request");
  });

  it("rejects the same combination twice", async () => {
    const response = await post(body(result, result));

    expect(response.status).toBe(422);
    expect(failureResponseSchema.parse(await response.json()).errors[0]?.code).toBe("duplicate-combination");
  });

  it("rejects bodies that are not a generation result", async () => {
    const response = await post(body({ ...result, files: [] }));

    expect(response.status).toBe(400);
    expect(failureResponseSchema.parse(await response.json()).errors[0]?.code).toBe("invalid-request");
  });

  it.each(["../escape.ts", "/etc/passwd", "api-client\\evil.ts"])(
    "rejects the unsafe archive path %s",
    async (archivePath) => {
      const unsafe = { ...result, files: [{ archivePath, destinationPath: "x", content: "" }] };

      const response = await post(body(unsafe));

      expect(response.status).toBe(422);
      expect(failureResponseSchema.parse(await response.json()).errors[0]?.code).toBe(
        "unsafe-archive-path",
      );
    },
  );

  it.each([
    ["archive root", { ...result, archiveRoot: 'a"; b' }],
    ["destination root", { ...result, destinationRoot: "somewhere/else" }],
    [
      "file archive path",
      { ...result, files: [{ archivePath: "other/x.ts", destinationPath: "src/lib/api-client/x.ts", content: "" }] },
    ],
    [
      "file destination path",
      { ...result, files: [{ archivePath: "api-client/x.ts", destinationPath: "elsewhere/x.ts", content: "" }] },
    ],
  ])("rejects a result whose %s does not match the target configuration", async (_name, mismatched) => {
    const response = await post(body(mismatched));

    expect(response.status).toBe(422);
    expect(failureResponseSchema.parse(await response.json()).errors[0]?.code).toBe("result-mismatch");
  });

  it("rejects results with more files than generation may produce", async () => {
    const files = Array.from({ length: MAX_OUTPUT_FILES + 1 }, (_, index) => ({
      archivePath: `api-client/f${String(index)}.ts`,
      destinationPath: `src/lib/api-client/f${String(index)}.ts`,
      content: "",
    }));

    const response = await post(body({ ...result, files }));

    expect(response.status).toBe(400);
  });

  it("rejects results whose contents exceed the generation output limit", async () => {
    const half = "x".repeat(MAX_OUTPUT_BYTES / 2 + 1);
    const files = ["a", "b"].map((name) => ({
      archivePath: `api-client/${name}.ts`,
      destinationPath: `src/lib/api-client/${name}.ts`,
      content: half,
    }));

    const response = await post(body({ ...result, files }));

    expect(response.status).toBe(413);
    expect(failureResponseSchema.parse(await response.json()).errors[0]?.code).toBe("too-large");
  });

  it("rejects requests beyond the concurrency limit and frees slots afterwards", async () => {
    const encoder = new TextEncoder();
    const open = Array.from({ length: MAX_CONCURRENT_ARCHIVES }, () => {
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      });
      const response = POST(
        new Request("http://localhost/api/archive", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          duplex: "half",
        } as RequestInit),
      );
      return { response, controller };
    });

    const busy = await post(body());
    expect(busy.status).toBe(503);
    expect(failureResponseSchema.parse(await busy.json()).errors[0]?.code).toBe("archive-busy");

    for (const { controller } of open) {
      controller?.enqueue(encoder.encode(body()));
      controller?.close();
    }
    for (const { response } of open) expect((await response).status).toBe(200);
    expect((await post(body())).status).toBe(200);
  });

  it("rejects bodies over the size limit before reading them", async () => {
    const response = await post("{}", { "content-length": String(MAX_ARCHIVE_REQUEST_BYTES + 1) });
    expect(response.status).toBe(413);
  });
});
