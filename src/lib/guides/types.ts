/** Content blocks a guide step is made of. Text may contain `inline code`. */
export type GuideBlock =
  | { kind: "text"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "command"; command: string }
  | {
      kind: "code";
      language: "ts" | "csharp";
      /** The project file this code belongs in. */
      file: string;
      /** `create`: a new file. `edit`: a small change to an existing file. */
      action: "create" | "edit";
      code: string;
    }
  /** The destination folder tree of the generated files. */
  | { kind: "tree" }
  /** The ZIP path → project path mapping of every generated file. */
  | { kind: "mapping" }
  /** The file viewer with every generated file's contents. */
  | { kind: "files" };

export interface GuideStep {
  title: string;
  blocks: GuideBlock[];
}

export interface Guide {
  title: string;
  /** Values the user must supply, as they appear in the code (e.g. `<YOUR_API_BASE_URL>`). */
  placeholders: { token: string; description: string }[];
  steps: GuideStep[];
}
