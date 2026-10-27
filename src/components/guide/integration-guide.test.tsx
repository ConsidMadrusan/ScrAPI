// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderGuide } from "@/lib/guides/render";
import { generationResult } from "@/test/generation-fixtures";
import { IntegrationGuide } from "./integration-guide";

const result = generationResult({ target: "typescript-next", httpClient: "fetch" });
const guide = renderGuide(result);

function setup() {
  const user = userEvent.setup();
  render(<IntegrationGuide guide={guide} result={result} />);
  return { user };
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
  it("shows a step indicator and moves between steps", async () => {
    const { user } = setup();
    const total = guide.steps.length;

    expect(screen.getByText(`Step 1 of ${String(total)}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^1\. Check your project setup/ })).toHaveAttribute(
      "aria-current",
      "step",
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(`Step 2 of ${String(total)}`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add the generated files" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: new RegExp(`^${String(total)}\\. `) }));
    expect(await screen.findByText(`Step ${String(total)} of ${String(total)}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
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
});
