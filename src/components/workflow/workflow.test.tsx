// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonObject } from "@/lib/openapi/json";
import { groupByTag, listOperations } from "@/lib/selection/operations";
import { combinationKey } from "@/lib/targets/catalog";
import type { GenerateRequest } from "@/lib/validation/requests";
import type { ArchiveRequest, FailureResponse, ValidateSuccess } from "@/lib/validation/responses";
import { generationResult } from "@/test/generation-fixtures";
import { GeneratingScreen } from "./generating-screen";
import { GuideScreen } from "./guide-screen";
import { ImplementScreen } from "./implement-screen";
import { SelectScreen } from "./select-screen";
import { SpecScreen } from "./spec-screen";
import { TargetsScreen } from "./targets-screen";
import { WorkflowProvider } from "./workflow-context";

/** A stand-in for the App Router: the current path, and push/replace that change it. */
const navigation = vi.hoisted(() => {
  let path = "/";
  const listeners = new Set<() => void>();
  const go = (to: string) => {
    path = to;
    for (const listener of listeners) listener();
  };
  return {
    getPath: () => path,
    reset: (to = "/") => {
      path = to;
    },
    go,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    router: { push: vi.fn(go), replace: vi.fn(go) },
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => navigation.router }));
vi.mock("next/link", () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        navigation.go(href);
      }}
    >
      {children}
    </a>
  ),
}));

const SCREENS: Record<string, () => ReactNode> = {
  "/": SpecScreen,
  "/select": SelectScreen,
  "/targets": TargetsScreen,
  "/generating": GeneratingScreen,
  "/implement": ImplementScreen,
  "/implement/guide": GuideScreen,
};

/** The workflow layout: one provider that stays mounted while the screen follows the path. */
function App() {
  const path = useSyncExternalStore(navigation.subscribe, navigation.getPath);
  const Screen = SCREENS[path];
  return <WorkflowProvider>{Screen ? <Screen /> : null}</WorkflowProvider>;
}

const todoText = readFileSync(join(process.cwd(), "samples/specs/todo.json"), "utf8");
const todo = JSON.parse(todoText) as JsonObject;
const operations = listOperations(todo);

const valid: ValidateSuccess = {
  ok: true,
  info: { title: "Todo API", version: "1.0.0", openapi: "3.0.3" },
  operations,
  groups: groupByTag(todo, operations),
};

const generatorFailure: FailureResponse = {
  ok: false,
  errors: [{ code: "generator-failed", message: "The generator could not process the specification." }],
};

interface Replies {
  validate?: ValidateSuccess | FailureResponse;
  /** Combination keys whose generation fails. */
  failing?: Set<string>;
  /** Whether /api/archive answers with a ZIP; read at request time. */
  archive?: { ok: boolean };
}

/** The JSON body of a recorded request; every API call in the workflow sends a string. */
function jsonBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === "string" ? JSON.parse(init.body) : null;
}

/** Answers the API routes like the server would, and records every request. */
function mockFetch({ validate = valid, failing = new Set(), archive = { ok: true } }: Replies = {}) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) => {
    const body = jsonBody(init);
    switch (url) {
      case "/api/validate":
        return Promise.resolve(Response.json(validate, { status: validate.ok ? 200 : 422 }));
      case "/api/generate": {
        const { options } = body as GenerateRequest;
        return Promise.resolve(
          failing.has(combinationKey(options))
            ? Response.json(generatorFailure, { status: 422 })
            : Response.json(generationResult(options, valid.operations)),
        );
      }
      case "/api/archive":
        return Promise.resolve(
          archive.ok
            ? new Response(new Uint8Array([0x50, 0x4b]), { headers: { "content-type": "application/zip" } })
            : Response.json(generatorFailure, { status: 500 }),
        );
      default:
        return Promise.reject(new Error(`unexpected request to ${url}`));
    }
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestsTo(fetchMock: ReturnType<typeof mockFetch>, url: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([calledUrl]) => calledUrl === url)
    .map(([, init]) => jsonBody(init));
}

function specBox() {
  return screen.getByRole("textbox", { name: "OpenAPI specification (JSON)" });
}

async function pasteSpec(user: ReturnType<typeof userEvent.setup>, text = todoText) {
  await user.click(specBox());
  await user.paste(text);
}

/** Pastes the sample, selects every operation, and opens the framework screen. */
async function reachTargets(user: ReturnType<typeof userEvent.setup>) {
  await pasteSpec(user);
  await screen.findByRole("heading", { name: "Select endpoints" });
  await user.click(screen.getByRole("button", { name: "Select all" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Choose frameworks" });
}

function frameworkBox(name: RegExp) {
  return screen.getByRole("checkbox", { name });
}

/** Generates Angular and C# from the sample and waits for the implementation landing screen. */
async function reachImplement(user: ReturnType<typeof userEvent.setup>) {
  await reachTargets(user);
  await user.click(frameworkBox(/^TypeScript for Angular/));
  await user.click(frameworkBox(/^C# \/ \.NET/));
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await screen.findByRole("heading", { name: "Implement" });
}

beforeEach(() => {
  navigation.reset();
  navigation.router.push.mockClear();
  navigation.router.replace.mockClear();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:zip"), revokeObjectURL: vi.fn() }));
});

describe("specification stage", () => {
  it("validates a pasted specification and opens endpoint selection", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<App />);

    await pasteSpec(user);

    expect(await screen.findByRole("heading", { name: "Select endpoints" })).toBeInTheDocument();
    expect(navigation.router.push).toHaveBeenCalledWith("/select");
    expect(requestsTo(fetchMock, "/api/validate")).toEqual([{ spec: todoText }]);
    expect(screen.getByText(/Todo API/)).toBeInTheDocument();
  });

  it("validates an uploaded file and opens endpoint selection", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.upload(
      screen.getByLabelText("or upload a file:"),
      new File([todoText], "todo.json", { type: "application/json" }),
    );

    expect(await screen.findByRole("heading", { name: "Select endpoints" })).toBeInTheDocument();
  });

  it("checks typed input only when Continue is pressed", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.type(specBox(), "{{");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The specification cannot be used");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigation.router.push).not.toHaveBeenCalled();
  });

  it("stays on the specification stage when the server rejects it", async () => {
    mockFetch({
      validate: { ok: false, errors: [{ code: "unsupported-version", message: "Only OpenAPI 3.0.x is supported." }] },
    });
    const user = userEvent.setup();
    render(<App />);

    await pasteSpec(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Only OpenAPI 3.0.x is supported.");
    expect(navigation.router.push).not.toHaveBeenCalled();
  });
});

describe("endpoint and framework stages", () => {
  it.each(["/implement", "/implement/guide"])("sends a reloaded %s back to the start", (path) => {
    mockFetch();
    navigation.reset(path);
    render(<App />);

    expect(navigation.router.replace).toHaveBeenCalledWith("/targets");
    expect(navigation.router.replace).toHaveBeenLastCalledWith("/");
    expect(screen.getByRole("heading", { name: "Provide a specification" })).toBeInTheDocument();
  });

  it("needs at least one operation and one framework", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<App />);
    await pasteSpec(user);
    await screen.findByRole("heading", { name: "Select endpoints" });

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("button", { name: "Generate" })).toBeDisabled();
    await user.click(frameworkBox(/^C# \/ \.NET/));
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("keeps the selection when going back from the framework stage", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<App />);
    await reachTargets(user);

    await user.click(screen.getByRole("link", { name: "Back" }));

    expect(await screen.findByRole("button", { name: "Next" })).toBeEnabled();
  });
});

describe("generation and implementation stages", () => {
  it("generates every chosen combination in order and opens the implementation stage", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<App />);
    await reachTargets(user);

    await user.click(frameworkBox(/^C# \/ \.NET/));
    await user.click(frameworkBox(/^TypeScript for Next\.js/));
    const clients = screen.getByRole("group", { name: /HTTP client for TypeScript for Next\.js/ });
    await user.click(within(clients).getByRole("checkbox", { name: /^fetch/ }));
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(navigation.router.push).toHaveBeenCalledWith("/generating");
    expect(await screen.findByRole("heading", { name: "Implement" })).toBeInTheDocument();
    expect(navigation.router.replace).toHaveBeenCalledWith("/implement");

    const requests = requestsTo(fetchMock, "/api/generate") as GenerateRequest[];
    expect(requests.map((request) => request.options)).toEqual([
      { target: "typescript-next", httpClient: "axios" },
      { target: "typescript-next", httpClient: "fetch" },
      { target: "csharp" },
    ]);
    for (const request of requests) expect(request.selection).toHaveLength(operations.length);
    expect(screen.getByText(/for 3 framework combinations/)).toBeInTheDocument();
  });

  it("downloads one ZIP with every result and marks the card as downloaded", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<App />);
    await reachImplement(user);

    await user.click(screen.getByRole("button", { name: /^Download ZIP/ }));

    expect(await screen.findByText("ZIP downloaded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download ZIP/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("ZIP downloaded.");
    const [archive] = requestsTo(fetchMock, "/api/archive") as ArchiveRequest[];
    expect(archive?.results.map((result) => result.options)).toEqual([
      { target: "typescript-angular" },
      { target: "csharp" },
    ]);

    await user.click(screen.getByRole("button", { name: "Download again" }));
    await vi.waitFor(() => {
      expect(requestsTo(fetchMock, "/api/archive")).toHaveLength(2);
    });
    expect(await screen.findByText("ZIP downloaded")).toBeInTheDocument();
  });

  it("lets the download be tried again when the ZIP cannot be created", async () => {
    const archive = { ok: false };
    mockFetch({ archive });
    const user = userEvent.setup();
    render(<App />);
    await reachImplement(user);

    await user.click(screen.getByRole("button", { name: /^Download ZIP/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The ZIP file could not be created.");

    archive.ok = true;
    await user.click(screen.getByRole("button", { name: /^Download ZIP/ }));
    expect(await screen.findByText("ZIP downloaded")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens the guide as a step-by-step flow and returns to the options when finished", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<App />);
    await reachImplement(user);
    await user.click(screen.getByRole("button", { name: /^Download ZIP/ }));
    await screen.findByText("ZIP downloaded");

    await user.click(screen.getByRole("link", { name: /^Step-by-step guide/ }));

    expect(navigation.getPath()).toBe("/implement/guide");
    const bar = screen.getByRole("progressbar", { name: "Guide progress" });
    const total = Number(bar.getAttribute("aria-valuemax"));
    expect(screen.getByText(`Step 1 of ${String(total)} · TypeScript for Angular`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    for (let step = 2; step <= total; step += 1) {
      await user.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByText(new RegExp(`^Step ${String(step)} of ${String(total)}`));
    }
    expect(screen.getByText(new RegExp(`^Step ${String(total)} of ${String(total)} · C# / \\.NET`))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(navigation.router.push).toHaveBeenCalledWith("/implement");
    expect(await screen.findByRole("heading", { name: "Implement" })).toBeInTheDocument();
    expect(screen.getByText("ZIP downloaded")).toBeInTheDocument();
  });

  it("builds the guide and the ZIP for new projects when that is chosen", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<App />);
    await reachTargets(user);

    expect(screen.getByRole("radio", { name: /^Existing project/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /^New project/ }));
    await user.click(frameworkBox(/^C# \/ \.NET/));
    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByRole("heading", { name: "Implement" });

    await user.click(screen.getByRole("button", { name: /^Download ZIP/ }));
    await screen.findByText("ZIP downloaded");
    const [archive] = requestsTo(fetchMock, "/api/archive") as ArchiveRequest[];
    expect(archive?.project).toBe("new");

    await user.click(screen.getByRole("link", { name: /^Step-by-step guide/ }));
    expect(screen.getByRole("heading", { name: "Create a .NET solution with the C# client" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create the solution and the Web API project" })).toBeInTheDocument();
    expect(screen.getByText("dotnet new sln -n MyApp -o MyApp")).toBeInTheDocument();
  });

  it("returns from the guide to the options with the back link", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<App />);
    await reachImplement(user);
    await user.click(screen.getByRole("link", { name: /^Step-by-step guide/ }));

    await user.click(screen.getByRole("link", { name: "← Back to options" }));

    expect(await screen.findByRole("heading", { name: "Implement" })).toBeInTheDocument();
  });

  it("continues with the successful combinations and retries a failed one", async () => {
    const failing = new Set(["csharp"]);
    const fetchMock = mockFetch({ failing });
    const user = userEvent.setup();
    render(<App />);
    await reachTargets(user);
    await user.click(frameworkBox(/^TypeScript for Angular/));
    await user.click(frameworkBox(/^C# \/ \.NET/));
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await screen.findByRole("heading", { name: "Implement" });
    expect(screen.getByRole("alert")).toHaveTextContent("C# / .NET could not be generated");
    await user.click(screen.getByRole("button", { name: /^Download ZIP/ }));
    await screen.findByText("ZIP downloaded");

    failing.clear();
    await user.click(screen.getByRole("button", { name: "Retry C# / .NET" }));

    await vi.waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/for 2 framework combinations/)).toBeInTheDocument();
    expect(requestsTo(fetchMock, "/api/generate")).toHaveLength(3);
    // The ZIP changed with the results, so it must be downloaded again.
    expect(screen.getByRole("button", { name: /^Download ZIP/ })).toBeInTheDocument();
    expect(screen.queryByText("ZIP downloaded")).not.toBeInTheDocument();
  });

  it("stays on the loading stage when every combination fails", async () => {
    mockFetch({ failing: new Set(["csharp"]) });
    const user = userEvent.setup();
    render(<App />);
    await reachTargets(user);
    await user.click(frameworkBox(/^C# \/ \.NET/));
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByRole("heading", { name: "Generation failed" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The generator could not process the specification.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(navigation.router.replace).not.toHaveBeenCalledWith("/implement");
  });
});
