"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { OperationSelector } from "./operation-selector";
import { StageHeader } from "./stage-header";
import { useRedirect } from "./use-redirect";
import { useWorkflow } from "./workflow-context";
import type { Conversion } from "@/lib/validation/responses";

/** Explains that the server converted the input before validating it. */
function conversionNote(conversions: readonly Conversion[]): string {
  const from = [
    conversions.includes("swagger-2") ? "Swagger 2.0" : undefined,
    conversions.includes("yaml") ? "YAML" : undefined,
  ].filter((part) => part !== undefined);
  return `Converted from ${from.join(" in ")} to OpenAPI JSON for generation. Your input is unchanged.`;
}

/** Stage 2: choose the operations to generate. */
export function SelectScreen() {
  const router = useRouter();
  const { validation, selected, setSelected } = useWorkflow();
  useRedirect(validation.status !== "valid", "/");
  if (validation.status !== "valid") return null;
  const result = validation.result;
  const { operations, groups } = result;

  return (
    <section className="flex flex-col gap-4">
      <StageHeader stage={1} title="Select endpoints" />
      {result.kind === "graphql" ? (
        <>
          <p className="text-sm">
            <span className="font-medium">{result.info.title}</span> · GraphQL · {result.info.typeCount} types ·{" "}
            {operations.length} operations
          </p>
          <p className="text-muted-foreground text-sm">
            Each selected field becomes one operation that selects its scalar fields two levels deep.
            {result.info.subscriptionCount > 0
              ? ` The schema's ${String(result.info.subscriptionCount)} subscription ${result.info.subscriptionCount === 1 ? "field is" : "fields are"} not generated.`
              : ""}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-medium">{result.info.title}</span> {result.info.version} · OpenAPI{" "}
            {result.info.openapi} · {operations.length} operations
          </p>
          {result.conversions.length > 0 ? (
            <p className="text-muted-foreground text-sm">{conversionNote(result.conversions)}</p>
          ) : null}
        </>
      )}
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
