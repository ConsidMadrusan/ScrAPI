interface Folder {
  folders: Map<string, Folder>;
  files: string[];
}

/**
 * Renders paths as a folder tree, folders before files, both sorted:
 *
 * ```
 * src/lib/api-client/
 * ├── apis/
 * │   └── TodosApi.ts
 * └── index.ts
 * ```
 */
export function renderTree(root: string, paths: readonly string[]): string {
  const top: Folder = { folders: new Map(), files: [] };
  const prefix = `${root}/`;

  for (const path of paths) {
    const segments = (path.startsWith(prefix) ? path.slice(prefix.length) : path).split("/");
    const fileName = segments.pop();
    if (fileName === undefined) continue;
    let folder = top;
    for (const segment of segments) {
      const next = folder.folders.get(segment) ?? { folders: new Map(), files: [] };
      folder.folders.set(segment, next);
      folder = next;
    }
    folder.files.push(fileName);
  }

  return [`${root}/`, ...renderFolder(top, "")].join("\n");
}

function renderFolder(folder: Folder, indent: string): string[] {
  const entries = [
    ...[...folder.folders.keys()].sort().map((name) => ({ name, folder: folder.folders.get(name) })),
    ...[...folder.files].sort().map((name) => ({ name, folder: undefined })),
  ];
  return entries.flatMap((entry, index) => {
    const last = index === entries.length - 1;
    const line = `${indent}${last ? "└── " : "├── "}${entry.name}${entry.folder ? "/" : ""}`;
    const children = entry.folder ? renderFolder(entry.folder, `${indent}${last ? "    " : "│   "}`) : [];
    return [line, ...children];
  });
}
