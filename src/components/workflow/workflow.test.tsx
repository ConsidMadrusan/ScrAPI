// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { JsonObject } from "@/lib/openapi/json";
import { groupByTag, listOperations } from "@/lib/selection/operations";
import type { FailureResponse, GenerateSuccess, ValidateSuccess } from "@/lib/validation/responses";
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

interface Reply {
  body: ValidateSuccess | GenerateSuccess | FailureResponse;
  status?: number;
}

/** Answers /api/validate, /api/generate, and /api/archive with fixed replies and records requests. */
function mockFetch(validate: Reply["body"], validateStatus = 200, generate?: Reply) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url) => {
    if (url === "/api/archive") {
      return Promise.resolve(
        new Response(new Uint8Array([0x50, 0x4b]), { headers: { "content-type": "application/zip" } }),
      );
    }
    const reply: Reply =
      url === "/api/generate" && generate ? generate : { body: validate, status: validateStatus };
    return Promise.resolve(Response.json(reply.body, { status: reply.status ?? 200 }));
  });
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

  describe("generation", () => {
    const generated: GenerateSuccess = {
      ok: true,
      options: { target: "typescript-next", httpClient: "axios" },
      archiveRoot: "api-client",
      destinationRoot: "src/lib/api-client",
      operations: operations.slice(0, 1),
      files: [
        {
          archivePath: "api-client/api/todos-api.ts",
          destinationPath: "src/lib/api-client/api/todos-api.ts",
          content: "export class TodosApi {}",
        },
      ],
    };

    async function validatedWorkflow(generate: Reply) {
      const fetchMock = mockFetch(success, 200, generate);
      const user = userEvent.setup();
      render(<Workflow />);
      enterSpec(todoText);
      await validate(user);
      await screen.findByRole("heading", { name: "4. Generate" });
      return { fetchMock, user };
    }

    it("is only possible with at least one selected operation", async () => {
      const { user } = await validatedWorkflow({ body: generated });
      const generateButton = screen.getByRole("button", { name: "Generate code" });

      expect(generateButton).toBeDisabled();
      expect(screen.getByText("Select at least one operation.")).toBeInTheDocument();

      await user.click(screen.getByRole("checkbox", { name: "GET /todos – List todos" }));
      expect(generateButton).toBeEnabled();
    });

    it("sends the target, client, and selected operations and shows the result", async () => {
      const { fetchMock, user } = await validatedWorkflow({ body: generated });
      await user.click(screen.getByRole("radio", { name: /^fetch/ }));
      await user.click(screen.getByRole("checkbox", { name: "DELETE /todos/{todoId} – Delete a todo" }));
      await user.click(screen.getByRole("checkbox", { name: "GET /todos – List todos" }));

      await user.click(screen.getByRole("button", { name: "Generate code" }));

      expect(await screen.findByText(/Generated 1 files for/)).toBeInTheDocument();
      const generateCall = fetchMock.mock.calls.find(([url]) => url === "/api/generate");
      const sentBody = generateCall?.[1]?.body;
      expect(typeof sentBody === "string" ? JSON.parse(sentBody) : undefined).toEqual({
        spec: todoText,
        options: { target: "typescript-next", httpClient: "fetch" },
        selection: [
          { method: "get", path: "/todos" },
          { method: "delete", path: "/todos/{todoId}" },
        ],
      });
      expect(
        screen.getByRole("heading", { name: "Add the TypeScript client to your Next.js project" }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Next" }));
      await user.click(await screen.findByText(/Where each file from the ZIP goes/));
      const table = screen.getByRole("table");
      expect(within(table).getByText("src/lib/api-client/api/todos-api.ts")).toBeInTheDocument();
    });

    it("clears the result when the selection or target changes", async () => {
      const { user } = await validatedWorkflow({ body: generated });
      const operation = screen.getByRole("checkbox", { name: "GET /todos – List todos" });
      await user.click(operation);
      await user.click(screen.getByRole("button", { name: "Generate code" }));
      await screen.findByRole("button", { name: "Download ZIP" });

      await user.click(screen.getByRole("checkbox", { name: "POST /todos – Create a todo" }));
      expect(screen.queryByRole("button", { name: "Download ZIP" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Generate code" }));
      await screen.findByRole("button", { name: "Download ZIP" });
      await user.click(screen.getByRole("radio", { name: /C# \/ \.NET/ }));
      expect(screen.queryByRole("button", { name: "Download ZIP" })).not.toBeInTheDocument();
    });

    it("downloads a ZIP the server built from the shown result", async () => {
      const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:scrapi");
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
      const { fetchMock, user } = await validatedWorkflow({ body: generated });
      await user.click(screen.getByRole("checkbox", { name: "GET /todos – List todos" }));
      await user.click(screen.getByRole("button", { name: "Generate code" }));

      await user.click(await screen.findByRole("button", { name: "Download ZIP" }));

      await vi.waitFor(() => {
        expect(click).toHaveBeenCalledOnce();
      });
      const archiveCall = fetchMock.mock.calls.find(([url]) => url === "/api/archive");
      const sentBody = archiveCall?.[1]?.body;
      expect(typeof sentBody === "string" ? JSON.parse(sentBody) : undefined).toEqual(generated);
      const blob = createObjectURL.mock.calls[0]?.[0];
      expect(blob?.type).toBe("application/zip");
      expect(click.mock.contexts[0]).toHaveProperty("download", "api-client.zip");
    });

    it("shows an error when the server cannot build the ZIP", async () => {
      const { fetchMock, user } = await validatedWorkflow({ body: generated });
      await user.click(screen.getByRole("checkbox", { name: "GET /todos – List todos" }));
      await user.click(screen.getByRole("button", { name: "Generate code" }));
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(Response.json({ ok: false, errors: [{ code: "internal", message: "x" }] }, { status: 500 })),
      );

      await user.click(await screen.findByRole("button", { name: "Download ZIP" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("The ZIP file could not be created.");
    });

    it("shows generation problems", async () => {
      const { user } = await validatedWorkflow({
        body: { ok: false, errors: [{ code: "generation-timeout", message: "Generation took too long and was stopped." }] },
        status: 422,
      });
      await user.click(screen.getByRole("checkbox", { name: "GET /todos – List todos" }));
      await user.click(screen.getByRole("button", { name: "Generate code" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Generation took too long and was stopped.");
    });
  });
});
