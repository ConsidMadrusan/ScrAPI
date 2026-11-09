"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { OperationSelector } from "./operation-selector";
import { StageHeader } from "./stage-header";
import { useRedirect } from "./use-redirect";
import { useWorkflow } from "./workflow-context";

/** Stage 2: choose the operations to generate. */
export function SelectScreen() {
  const router = useRouter();
  const { validation, selected, setSelected } = useWorkflow();
  useRedirect(validation.status !== "valid", "/");
  if (validation.status !== "valid") return null;
  const { info, operations, groups } = validation.result;

  return (
    <section className="flex flex-col gap-4">
      <StageHeader stage={1} title="Select endpoints" />
      <p className="text-sm">
        <span className="font-medium">{info.title}</span> {info.version} · OpenAPI {info.openapi} ·{" "}
        {operations.length} operations
      </p>
      <OperationSelector
        operations={operations}
        groups={groups}
        selected={selected}
        onSelectedChange={setSelected}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Change specification
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {selected.size === 0 ? (
            <span className="text-muted-foreground text-sm">Select at least one operation.</span>
          ) : null}
          <Button
            disabled={selected.size === 0}
            onClick={() => {
              router.push("/targets");
            }}
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}
