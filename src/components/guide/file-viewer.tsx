"use client";

import { useId, useState } from "react";
import type { GeneratedFile } from "@/lib/validation/responses";
import { CopyButton } from "./copy-button";

interface FileViewerProps {
  files: readonly GeneratedFile[];
}

/** Shows one generated file at a time, with its project path and a copy button. */
export function FileViewer({ files }: FileViewerProps) {
  const selectId = useId();
  const [selectedPath, setSelectedPath] = useState(files[0]?.destinationPath ?? "");
  const file = files.find((candidate) => candidate.destinationPath === selectedPath) ?? files[0];
  if (!file) return null;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={selectId} className="text-sm font-medium">
        View a file
      </label>
      <select
        id={selectId}
        value={file.destinationPath}
        onChange={(event) => {
          setSelectedPath(event.target.value);
        }}
        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border px-2 font-mono text-sm outline-none focus-visible:ring-3"
      >
        {files.map((candidate) => (
          <option key={candidate.destinationPath} value={candidate.destinationPath}>
            {candidate.destinationPath}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs break-all">{file.destinationPath}</span>
        <CopyButton text={file.content} label={`Copy ${file.destinationPath}`} />
      </div>
      <pre
        tabIndex={0}
        aria-label={`Contents of ${file.destinationPath}`}
        className="bg-muted focus-visible:ring-ring/50 max-h-96 overflow-auto rounded-lg p-3 text-xs outline-none focus-visible:ring-3"
      >
        <code>{file.content}</code>
      </pre>
    </div>
  );
}
