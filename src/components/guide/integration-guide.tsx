"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { zipPath, type ChainedGuide, type GuideSection } from "@/lib/guides/chained";
import { renderTree } from "@/lib/guides/tree";
import type { GuideBlock } from "@/lib/guides/types";
import { CopyButton } from "./copy-button";
import { FileViewer } from "./file-viewer";
import { RichText } from "./rich-text";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

interface IntegrationGuideProps {
  guide: ChainedGuide;
  /** Called by "Finish" on the last step. Without it, the last step has no way forward. */
  onFinish?: () => void;
}

/**
 * The guide as an onboarding flow: one step at a time with a progress bar,
 * Back and Next. Steps of every section follow each other.
 */
export function IntegrationGuide({ guide, onFinish }: IntegrationGuideProps) {
  const [index, setIndex] = useState(0);
  const idPrefix = useId();
  const navigated = useRef(false);
  const reduceMotion = usePrefersReducedMotion();
  const steps = guide.sections.flatMap((section) => section.guide.steps.map((step) => ({ section, step })));
  const current = steps[index];
  const headingId = `${idPrefix}-step-${String(index)}`;
  const multiple = guide.sections.length > 1;

  if (!current) return null;
  const { section, step } = current;
  const isLast = index === steps.length - 1;
  const progress = ((index + 1) / steps.length) * 100;
  const goTo = (next: number) => {
    navigated.current = true;
    setIndex(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">{guide.title}</h2>

      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-label="Guide progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={index + 1}
          aria-valuetext={`Step ${String(index + 1)} of ${String(steps.length)}`}
          className="bg-muted h-2 overflow-hidden rounded-full"
        >
          <motion.div
            className="bg-primary h-full rounded-full"
            initial={false}
            animate={{ width: `${String(progress)}%` }}
            transition={{ duration: reduceMotion ? 0 : 0.25 }}
          />
        </div>
        <p className="text-muted-foreground text-sm">
          Step {index + 1} of {steps.length}
          {multiple ? ` · ${section.label}` : null}
        </p>
      </div>

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

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={index}
          aria-labelledby={headingId}
          initial={reduceMotion ? false : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -16 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          className="flex min-h-64 flex-col gap-4 rounded-lg border p-4 sm:p-6"
        >
          <h3
            id={headingId}
            // The heading mounts after the previous step has animated out; move
            // focus to it after navigation, but not on first render.
            ref={(element) => {
              if (element && navigated.current) element.focus();
            }}
            tabIndex={-1}
            className="text-lg font-semibold outline-none"
          >
            {step.title}
          </h3>
          {step.blocks.map((block, blockIndex) => (
            <Block key={blockIndex} block={block} section={section} />
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
          Back
        </Button>
        {isLast ? (
          <Button disabled={onFinish === undefined} onClick={onFinish}>
            Finish
          </Button>
        ) : (
          <Button
            onClick={() => {
              goTo(index + 1);
            }}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

function Block({ block, section }: { block: GuideBlock; section: GuideSection }) {
  const { result } = section;
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
                  <td className="py-1 pr-4 break-all">{zipPath(section, file.archivePath)}</td>
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
