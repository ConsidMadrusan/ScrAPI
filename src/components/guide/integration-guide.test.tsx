// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderChainedGuide, type ChainedGuide } from "@/lib/guides/chained";
import { generationResult } from "@/test/generation-fixtures";
import { IntegrationGuide } from "./integration-guide";

const result = generationResult({ target: "typescript-next", httpClient: "fetch" });
const guide = renderChainedGuide([result]);
const steps = guide.sections.flatMap((section) => section.guide.steps);

function setup(chained: ChainedGuide = guide, onFinish?: () => void) {
  const user = userEvent.setup();
  render(onFinish ? <IntegrationGuide guide={chained} onFinish={onFinish} /> : <IntegrationGuide guide={chained} />);
  return { user };
}

/** Clicks Next and waits for the step after it; the previous step animates out first. */
async function next(user: ReturnType<typeof userEvent.setup>, to: number, total: number) {
  await user.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText(new RegExp(`^Step ${String(to)} of ${String(total)}`));
}

function progress() {
  return screen.getByRole("progressbar", { name: "Guide progress" });
}

function preferReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("IntegrationGuide", () => {
  it("shows one step at a time with a progress bar, Back, and Next", async () => {
    const { user } = setup();
    const total = steps.length;

    expect(screen.getByText(`Step 1 of ${String(total)}`)).toBeInTheDocument();
    expect(progress()).toHaveAttribute("aria-valuenow", "1");
    expect(progress()).toHaveAttribute("aria-valuemax", String(total));
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(1);

    await next(user, 2, total);
    expect(await screen.findByRole("heading", { name: "Add the generated files" })).toBeInTheDocument();
    expect(progress()).toHaveAttribute("aria-valuenow", "2");

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText(`Step 1 of ${String(total)}`)).toBeInTheDocument();
    expect(progress()).toHaveAttribute("aria-valuenow", "1");
  });

  it("offers Finish on the last step and calls onFinish", async () => {
    const onFinish = vi.fn();
    const { user } = setup(guide, onFinish);
    const total = steps.length;

    for (let step = 2; step <= total; step += 1) await next(user, step, total);

    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("disables Finish when there is nowhere to go", async () => {
    const { user } = setup();
    const total = steps.length;

    for (let step = 2; step <= total; step += 1) await next(user, step, total);

    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
  });

  it("lists the values the user must supply", () => {
    setup();
    expect(screen.getByText("Values you must supply")).toBeInTheDocument();
    expect(screen.getByText("<YOUR_API_BASE_URL>")).toBeInTheDocument();
  });

  it("copies the exact contents of the selected file", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    const file = result.files[0];
    if (!file) throw new Error("fixture has no files");

    await user.click(await screen.findByRole("button", { name: `Copy ${file.destinationPath}` }));

    expect(await navigator.clipboard.readText()).toBe(file.content);
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("switches the file viewer between files", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    const second = result.files[1];
    if (!second) throw new Error("fixture needs two files");

    await user.selectOptions(await screen.findByRole("combobox", { name: "View a file" }), second.destinationPath);

    expect(screen.getByLabelText(`Contents of ${second.destinationPath}`)).toHaveTextContent(second.content.trim());
  });

  it("can be used with the keyboard and moves focus to the new step", async () => {
    const { user } = setup();
    screen.getByRole("button", { name: "Next" }).focus();

    await user.keyboard("{Enter}");

    const heading = await screen.findByRole("heading", { name: "Add the generated files" });
    await vi.waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  it("switches steps without animation when reduced motion is preferred", async () => {
    preferReducedMotion(true);
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Next" }));

    const section = await screen.findByRole("region", { name: "Add the generated files" });
    expect(section.style.transform).not.toContain("translate");
    expect(section.style.opacity).not.toBe("0");
  });

  it("chains the steps of every combination and crosses from one to the next", async () => {
    const csharp = generationResult({ target: "csharp" });
    const chained = renderChainedGuide([result, csharp]);
    const [first, second] = chained.sections;
    if (!first || !second) throw new Error("expected two sections");
    const firstCount = first.guide.steps.length;
    const total = firstCount + second.guide.steps.length;
    const { user } = setup(chained);

    expect(screen.getByText(`Step 1 of ${String(total)} · ${first.label}`)).toBeInTheDocument();

    for (let step = 2; step <= firstCount + 1; step += 1) await next(user, step, total);

    expect(screen.getByText(`Step ${String(firstCount + 1)} of ${String(total)} · ${second.label}`)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: second.guide.steps[0]?.title ?? "" })).toBeInTheDocument();
  });

  it("shows ZIP paths inside the combination's folder", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    const file = result.files[0];
    if (!file) throw new Error("fixture has no files");

    expect(await screen.findByText(`nextjs-fetch/${file.archivePath}`)).toBeInTheDocument();
    expect(screen.getByText("nextjs-fetch/api-client")).toBeInTheDocument();
  });
});
