import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildZip } from "./zip";

const entries = [
  { archivePath: "api-client/index.ts", content: "export * from './runtime';\n" },
  { archivePath: "api-client/apis/TodosApi.ts", content: "export class TodosApi {}\n" },
];

describe("buildZip", () => {
  it("contains exactly the given files with their contents", async () => {
    const zip = await JSZip.loadAsync(await buildZip(entries));

    const files = Object.values(zip.files).filter((file) => !file.dir);
    expect(files.map((file) => file.name).sort()).toEqual(
      entries.map((entry) => entry.archivePath).sort(),
    );
    for (const entry of entries) {
      expect(await zip.file(entry.archivePath)?.async("string")).toBe(entry.content);
    }
  });

  it("is deterministic for the same input", async () => {
    expect(await buildZip(entries)).toEqual(await buildZip(entries));
  });

  it.each(["../evil.ts", "/abs.ts", "a\\b.ts"])("refuses unsafe path %s", async (archivePath) => {
    await expect(buildZip([{ archivePath, content: "" }])).rejects.toThrow("Unsafe archive path");
  });
});
