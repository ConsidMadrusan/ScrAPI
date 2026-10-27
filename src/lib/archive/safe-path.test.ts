import { describe, expect, it } from "vitest";
import { isSafeArchivePath } from "./safe-path";

describe("isSafeArchivePath", () => {
  it.each(["api-client/index.ts", "ApiClient/Api/TodosApi.cs", "a/b-c_d.e/f.ts", "ApiClient/Client/ApiResponse`1.cs"])(
    "accepts %s",
    (path) => {
      expect(isSafeArchivePath(path)).toBe(true);
    },
  );

  it.each([
    ["empty", ""],
    ["absolute", "/etc/passwd"],
    ["parent segment", "api-client/../../evil.ts"],
    ["leading parent", "../evil.ts"],
    ["current segment", "api-client/./x.ts"],
    ["empty segment", "api-client//x.ts"],
    ["trailing slash", "api-client/"],
    ["backslash", "api-client\\..\\evil.ts"],
    ["drive letter", "C:/evil.ts"],
    ["control character", "api-client/x\u0000.ts"],
    ["newline", "api-client/x\n.ts"],
    ["too long", `a/${"b".repeat(600)}`],
  ])("rejects %s", (_reason, path) => {
    expect(isSafeArchivePath(path)).toBe(false);
  });
});
