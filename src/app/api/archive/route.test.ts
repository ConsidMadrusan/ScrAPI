import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { GUIDE_FILE_NAME, renderGuideMarkdown } from "@/lib/guides/markdown";
import { renderGuide } from "@/lib/guides/render";
import { MAX_ARCHIVE_REQUEST_BYTES } from "@/lib/validation/limits";
import { failureResponseSchema } from "@/lib/validation/responses";
import { generationResult } from "@/test/generation-fixtures";
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

describe("POST /api/archive", () => {
  it("returns a ZIP with the result's files and the guide rendered from the same result", async () => {
    const response = await post(JSON.stringify(result));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${result.archiveRoot}.zip"`,
    );
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    for (const file of result.files) {
      expect(await zip.file(file.archivePath)?.async("string")).toBe(file.content);
    }
    expect(await zip.file(GUIDE_FILE_NAME)?.async("string")).toBe(
      renderGuideMarkdown(renderGuide(result), result),
    );
  });

  it("rejects bodies that are not a generation result", async () => {
    const response = await post(JSON.stringify({ ...result, files: [] }));

    expect(response.status).toBe(400);
    expect(failureResponseSchema.parse(await response.json()).errors[0]?.code).toBe("invalid-request");
  });

  it.each(["../escape.ts", "/etc/passwd", "api-client\\evil.ts"])(
    "rejects the unsafe archive path %s",
    async (archivePath) => {
      const unsafe = { ...result, files: [{ archivePath, destinationPath: "x", content: "" }] };

      const response = await post(JSON.stringify(unsafe));

      expect(response.status).toBe(422);
      expect(failureResponseSchema.parse(await response.json()).errors[0]?.code).toBe(
        "unsafe-archive-path",
      );
    },
  );

  it("uses a fixed file name when the archive root is not a plain name", async () => {
    const response = await post(JSON.stringify({ ...result, archiveRoot: 'a"; b' }));

    expect(response.headers.get("content-disposition")).toBe('attachment; filename="api-client.zip"');
  });

  it("rejects bodies over the size limit before reading them", async () => {
    const response = await post("{}", { "content-length": String(MAX_ARCHIVE_REQUEST_BYTES + 1) });
    expect(response.status).toBe(413);
  });
});
