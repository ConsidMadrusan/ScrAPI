// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@/lib/openapi/json";
import { groupByTag, listOperations } from "@/lib/selection/operations";
import { OperationSelector } from "./operation-selector";

const library = JSON.parse(
  readFileSync(join(process.cwd(), "samples/specs/library.json"), "utf8"),
) as JsonObject;
const operations = listOperations(library);
const groups = groupByTag(library, operations);

function Harness() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return (
    <OperationSelector
      operations={operations}
      groups={groups}
      selected={selected}
      onSelectedChange={setSelected}
    />
  );
}

function setup() {
  const user = userEvent.setup();
  render(<Harness />);
  return { user };
}

function operationBoxes(id: string) {
  return screen.getAllByRole("checkbox", { name: new RegExp(`^${escape(id)}( –|$)`) });
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function status() {
  return screen.getByRole("status");
}

describe("OperationSelector", () => {
  it("shows every group, with untagged operations under Other", () => {
    setup();
    expect(screen.getAllByRole("group")).toHaveLength(4);
    for (const name of ["books", "authors", "admin", "Other"]) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
    expect(status()).toHaveTextContent("0 of 7 operations selected");
  });

  it("selects a multi-tag operation in every group and counts it once", async () => {
    const { user } = setup();
    const [inBooks, inAdmin] = operationBoxes("POST /books");

    await user.click(inBooks as HTMLElement);

    expect(inBooks).toBeChecked();
    expect(inAdmin).toBeChecked();
    expect(status()).toHaveTextContent("1 of 7 operations selected");
  });

  it("selects methods on the same path independently", async () => {
    const { user } = setup();

    await user.click(operationBoxes("GET /books")[0] as HTMLElement);

    expect(operationBoxes("GET /books")[0]).toBeChecked();
    for (const box of operationBoxes("POST /books")) expect(box).not.toBeChecked();
  });

  it("selects a whole group and marks overlapping groups as partly selected", async () => {
    const { user } = setup();
    const adminGroup = screen.getByRole("checkbox", { name: "Select all in admin" });

    await user.click(adminGroup);

    expect(adminGroup).toBeChecked();
    expect(status()).toHaveTextContent("2 of 7 operations selected");
    const booksGroup = screen.getByRole<HTMLInputElement>("checkbox", { name: "Select all in books" });
    expect(booksGroup).not.toBeChecked();
    expect(booksGroup.indeterminate).toBe(true);

    await user.click(adminGroup);
    expect(status()).toHaveTextContent("0 of 7 operations selected");
  });

  it("selects and clears all operations", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(status()).toHaveTextContent("7 of 7 operations selected");
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(status()).toHaveTextContent("0 of 7 operations selected");
  });

  it("filters by path, summary, or operationId and keeps the selection", async () => {
    const { user } = setup();
    await user.click(operationBoxes("GET /health")[0] as HTMLElement);
    const search = screen.getByRole("searchbox", { name: "Search operations" });

    await user.type(search, "createbook");
    expect(operationBoxes("POST /books")).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: /^GET \/books/ })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "review");
    const other = screen.getByRole("group", { name: "Other" });
    expect(within(other).getAllByRole("checkbox", { name: /reviews/ })).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "books" })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "no such thing");
    expect(screen.getByText(/No operations match/)).toBeInTheDocument();
    expect(status()).toHaveTextContent("1 of 7 operations selected");
  });

  it("can be operated with the keyboard alone", async () => {
    const { user } = setup();

    await user.tab(); // search
    await user.tab(); // Select all
    await user.tab(); // Clear all
    await user.tab(); // first group checkbox (books)
    expect(screen.getByRole("checkbox", { name: "Select all in books" })).toHaveFocus();
    await user.tab(); // GET /books
    await user.keyboard(" ");

    expect(operationBoxes("GET /books")[0]).toBeChecked();
    expect(status()).toHaveTextContent("1 of 7 operations selected");

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    await user.keyboard(" ");
    expect(status()).toHaveTextContent("3 of 7 operations selected");
  });
});
