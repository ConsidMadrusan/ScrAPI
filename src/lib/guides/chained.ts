import { combinationKey, combinationLabel, COMBINATIONS } from "@/lib/targets/catalog";
import type { ProjectMode } from "@/lib/validation/requests";
import type { GenerateSuccess } from "@/lib/validation/responses";
import { renderGuide } from "./render";
import type { Guide } from "./types";

/** One framework combination's part of a chained guide. */
export interface GuideSection {
  /** Combination key, e.g. `nextjs-axios`. Also the result's folder in the ZIP. */
  key: string;
  label: string;
  result: GenerateSuccess;
  guide: Guide;
}

/** The guides of several generation results, one after the other. */
export interface ChainedGuide {
  title: string;
  /** Whether the guide adds the clients to existing projects or creates new ones. */
  project: ProjectMode;
  /** Values the user must supply in any section, each listed once. */
  placeholders: Guide["placeholders"];
  sections: GuideSection[];
}

/**
 * Renders one guide covering every result, in the order of `COMBINATIONS`.
 * Each result's files are in the ZIP folder named after its combination key.
 * The page and INTEGRATION.md both render from this.
 */
export function renderChainedGuide(
  results: readonly GenerateSuccess[],
  project: ProjectMode = "existing",
): ChainedGuide {
  const order = COMBINATIONS.map(combinationKey);
  const sections = results
    .map((result) => {
      const key = combinationKey(result.options);
      return {
        key,
        label: combinationLabel(result.options),
        result,
        guide: renderGuide(result, { zipFolder: key, project }),
      };
    })
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  const placeholders = new Map<string, Guide["placeholders"][number]>();
  for (const section of sections) {
    for (const placeholder of section.guide.placeholders) {
      if (!placeholders.has(placeholder.token)) placeholders.set(placeholder.token, placeholder);
    }
  }

  const [only] = sections;
  const general =
    project === "new" ? "Create new projects with the generated clients" : "Add the generated clients to your projects";
  return {
    title: sections.length === 1 && only ? only.guide.title : general,
    project,
    placeholders: [...placeholders.values()],
    sections,
  };
}

/** Path of a result's file inside the ZIP. */
export function zipPath(section: Pick<GuideSection, "key">, archivePath: string): string {
  return `${section.key}/${archivePath}`;
}
