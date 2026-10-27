"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { renderTree } from "@/lib/guides/tree";
import type { Guide, GuideBlock } from "@/lib/guides/types";
import type { GenerateSuccess } from "@/lib/validation/responses";
import { CopyButton } from "./copy-button";
import { FileViewer } from "./file-viewer";
import { RichText } from "./rich-text";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

interface IntegrationGuideProps {
  guide: Guide;
  result: GenerateSuccess;
}

export function IntegrationGuide({ guide, result }: IntegrationGuideProps) {
  const [index, setIndex] = useState(0);
  const idPrefix = useId();
  const navigated = useRef(false);
  const reduceMotion = usePrefersReducedMotion();
  const step = guide.steps[index];
  const headingId = `${idPrefix}-step-${String(index)}`;

  if (!step) return null;
  const goTo = (next: number) => {
    navigated.current = true;
    setIndex(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-lg font-semibold">{guide.title}</h3>

      {guide.placeholders.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium">Values you must supply</p>
          <ul className="mt-1 list-disc pl-5">
            {guide.placeholders.map((placeholder) => (
              <li key={placeholder.token}>
                <code className="font-mono">{placeholder.token}</code>: {placeholder.description}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <nav aria-label="Guide steps">
        <ol className="flex flex-wrap gap-2">
          {guide.steps.map((candidate, candidateIndex) => (
            <li key={candidate.title}>
              <Button
                variant={candidateIndex === index ? "default" : "outline"}
                size="sm"
                aria-current={candidateIndex === index ? "step" : undefined}
                onClick={() => {
                  goTo(candidateIndex);
                }}
              >
                {candidateIndex + 1}. {candidate.title}
              </Button>
            </li>
          ))}
        </ol>
      </nav>

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={index}
          aria-labelledby={headingId}
          initial={reduceMotion ? false : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -16 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          className="flex flex-col gap-4"
        >
          <p className="text-muted-foreground text-sm">
            Step {index + 1} of {guide.steps.length}
          </p>
          <h4
            id={headingId}
            // The heading mounts after the previous step has animated out; move
            // focus to it after navigation, but not on first render.
            ref={(element) => {
              if (element && navigated.current) element.focus();
            }}
            tabIndex={-1}
            className="text-base font-semibold outline-none"
          >
            {step.title}
          </h4>
          {step.blocks.map((block, blockIndex) => (
            <Block key={blockIndex} block={block} result={result} />
          ))}
        </motion.section>
      </AnimatePresence>

      <div className="flex justify-between gap-2">
        <Button
          variant="outline"
          disabled={index === 0}
          onClick={() => {
            goTo(index - 1);
          }}
        >
          Previous
        </Button>
        <Button
          disabled={index === guide.steps.length - 1}
          onClick={() => {
            goTo(index + 1);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function Block({ block, result }: { block: GuideBlock; result: GenerateSuccess }) {
  switch (block.kind) {
    case "text":
      return (
        <p className="text-sm">
          <RichText text={block.text} />
        </p>
      );
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {block.items.map((item) => (
            <li key={item}>
              <RichText text={item} />
            </li>
          ))}
        </ul>
      );
    case "command":
      return (
        <div className="flex items-start gap-2">
          <pre className="bg-muted flex-1 overflow-x-auto rounded-lg p-3 text-xs">
            <code>{block.command}</code>
          </pre>
          <CopyButton text={block.command} label={`Copy command ${block.command}`} />
        </div>
      );
    case "code":
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <span className="font-medium">{block.action === "create" ? "New file" : "Edit existing file"}</span>{" "}
              <code className="font-mono text-xs">{block.file}</code>
            </span>
            <CopyButton text={block.code} label={`Copy code for ${block.file}`} />
          </div>
          <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs">
            <code>{block.code}</code>
          </pre>
        </div>
      );
    case "tree":
      return (
        <pre
          aria-label="Folder tree of the generated files in your project"
          className="bg-muted overflow-x-auto rounded-lg p-3 text-xs"
        >
          {renderTree(result.destinationRoot, result.files.map((file) => file.destinationPath))}
        </pre>
      );
    case "mapping":
      return (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Where each file from the ZIP goes ({result.files.length} files)
          </summary>
          <table className="mt-2 w-full text-left">
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-1 pr-4 font-medium">
                  In the ZIP
                </th>
                <th scope="col" className="py-1 font-medium">
                  In your project
                </th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {result.files.map((file) => (
                <tr key={file.archivePath} className="border-b last:border-0">
                  <td className="py-1 pr-4 break-all">{file.archivePath}</td>
                  <td className="py-1 break-all">{file.destinationPath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      );
    case "files":
      return <FileViewer files={result.files} />;
  }
}
