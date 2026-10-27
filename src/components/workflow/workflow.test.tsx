// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { JsonObject } from "@/lib/openapi/json";
import { groupByTag, listOperations } from "@/lib/selection/operations";
import type { FailureResponse, ValidateSuccess } from "@/lib/validation/responses";
import { Workflow } from "./workflow";

const todoText = readFileSync(join(process.cwd(), "samples/specs/todo.json"), "utf8");
const todo = JSON.parse(todoText) as JsonObject;
const operations = listOperations(todo);

const success: ValidateSuccess = {
  ok: true,
  info: { title: "Todo API", version: "1.0.0", openapi: "3.0.3" },
  operations,
  groups: groupByTag(todo, operations),
};

function mockFetch(body: ValidateSuccess | FailureResponse, status = 200) {
  const fetchMock = vi.fn(() => Promise.resolve(Response.json(body, { status })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function specBox() {
  return screen.getByRole("textbox", { name: "OpenAPI specification (JSON)" });
}

/** Typing a whole specification key by key is slow; paste-like input is enough. */
function enterSpec(text: string) {
  fireEvent.change(specBox(), { target: { value: text } });
}

async function validate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Validate specification" }));
}

describe("Workflow", () => {
  it("reports local problems without calling the server", async () => {
    const fetchMock = mockFetch(success);
    const user = userEvent.setup();
    render(<Workflow />);

    enterSpec("openapi: 3.0.3");
    await validate(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/accepts OpenAPI specifications in JSON only/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows server-side validation problems", async () => {
    mockFetch(
      { ok: false, errors: [{ code: "invalid-spec", message: "Must have required property 'version'.", location: "info" }] },
      422,
    );
    const user = userEvent.setup();
    render(<Workflow />);

    enterSpec(todoText);
    await validate(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Must have required property 'version'. (info)");
    expect(screen.queryByRole("heading", { name: "3. Select operations" })).not.toBeInTheDocument();
  });

  it("shows targets and operations after validation, and clears the selection when the specification changes", async () => {
    const fetchMock = mockFetch(success);
    const user = userEvent.setup();
    render(<Workflow />);

    enterSpec(todoText);
    await validate(user);

    expect(await screen.findByRole("heading", { name: "3. Select operations" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/validate",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ spec: todoText }) }),
    );
    await user.click(screen.getByRole("checkbox", { name: "GET /todos – List todos" }));
    expect(screen.getByText("1 of 5 operations selected")).toBeInTheDocument();

    enterSpec(`${todoText} `);
    expect(screen.queryByRole("heading", { name: "3. Select operations" })).not.toBeInTheDocument();

    await validate(user);
    expect(await screen.findByText("0 of 5 operations selected")).toBeInTheDocument();
  });

  it("offers an HTTP client only for the Next.js and Nuxt targets and keeps the choice", async () => {
    mockFetch(success);
    const user = userEvent.setup();
    render(<Workflow />);
    enterSpec(todoText);
    await validate(user);
    await screen.findByRole("heading", { name: "2. Choose a target" });

    expect(screen.getByRole("radio", { name: /TypeScript for Next\.js/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^axios/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /^fetch/ }));

    await user.click(screen.getByRole("radio", { name: /C# \/ \.NET/ }));
    expect(screen.queryByRole("group", { name: "HTTP client" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /TypeScript for Nuxt/ }));
    expect(screen.getByRole("radio", { name: /^fetch/ })).toBeChecked();
  });

  it("explains when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const user = userEvent.setup();
    render(<Workflow />);

    enterSpec(todoText);
    await validate(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be reached/);
  });
});
