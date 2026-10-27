"use client";

import { useMemo, useState } from "react";
import { IntegrationGuide } from "@/components/guide/integration-guide";
import { Button } from "@/components/ui/button";
import { GUIDE_FILE_NAME } from "@/lib/guides/markdown";
import { renderGuide } from "@/lib/guides/render";
import { TARGETS } from "@/lib/targets/catalog";
import type { GenerateSuccess } from "@/lib/validation/responses";
import { requestArchive } from "./api";

interface GenerationResultProps {
  result: GenerateSuccess;
}

export function GenerationResult({ result }: GenerationResultProps) {
  const [downloadError, setDownloadError] = useState<string | undefined>();
  // The guide on the page and INTEGRATION.md in the ZIP (built on the server)
  // are both rendered from this result.
  const guide = useMemo(() => renderGuide(result), [result]);
  const targetLabel = TARGETS.find((target) => target.id === result.options.target)?.label;
  const client = "httpClient" in result.options ? ` (${result.options.httpClient})` : "";

  const download = async () => {
    try {
      const zip = await requestArchive(result);
      if (zip === undefined) {
        setDownloadError("The ZIP file could not be created.");
        return;
      }
      const url = URL.createObjectURL(zip);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${result.archiveRoot}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setDownloadError(undefined);
    } catch {
      setDownloadError("The ZIP file could not be created.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <p role="status">
        Generated {result.files.length} files for {targetLabel}
        {client} from {result.operations.length} selected operations.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void download()}>Download ZIP</Button>
        <span className="text-muted-foreground text-sm">
          Contains the <code className="font-mono">{result.archiveRoot}</code> folder and{" "}
          <code className="font-mono">{GUIDE_FILE_NAME}</code> with the steps below.
        </span>
      </div>
      {downloadError ? (
        <p role="alert" className="text-destructive text-sm">
          {downloadError}
        </p>
      ) : null}
      <IntegrationGuide guide={guide} result={result} />
    </div>
  );
}
