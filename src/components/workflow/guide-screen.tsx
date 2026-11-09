"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { IntegrationGuide } from "@/components/guide/integration-guide";
import { renderChainedGuide } from "@/lib/guides/chained";
import { useRedirect } from "./use-redirect";
import { isSettled, successfulResults, useWorkflow } from "./workflow-context";

/** The step-by-step guide for every generated client, one step at a time. */
export function GuideScreen() {
  const router = useRouter();
  const { runs, project } = useWorkflow();
  const results = useMemo(() => successfulResults(runs), [runs]);
  // INTEGRATION.md in the ZIP (built on the server) is rendered from the same results.
  const guide = useMemo(
    () => (results.length > 0 ? renderChainedGuide(results, project) : undefined),
    [results, project],
  );

  const running = runs?.some((run) => !isSettled(run)) ?? false;
  useRedirect(runs === null || (results.length === 0 && !running), "/targets");
  if (guide === undefined) return null;

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Link
          href="/implement"
          className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
        >
          ← Back to options
        </Link>
      </div>
      <IntegrationGuide
        guide={guide}
        onFinish={() => {
          router.push("/implement");
        }}
      />
    </section>
  );
}
