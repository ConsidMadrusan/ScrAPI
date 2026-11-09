// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { GenerationOptions } from "@/lib/validation/requests";
import { TargetPicker } from "./target-picker";

let latest: GenerationOptions[] = [];

function Harness({ initial = [] }: { initial?: GenerationOptions[] }) {
  const [value, setValue] = useState<GenerationOptions[]>(initial);
  return (
    <TargetPicker
      value={value}
      onChange={(next) => {
        latest = next;
        setValue(next);
      }}
    />
  );
}

function setup(initial: GenerationOptions[] = []) {
  latest = initial;
  const user = userEvent.setup();
  render(<Harness initial={initial} />);
  return { user };
}

function clients(name: RegExp) {
  return screen.getByRole("group", { name });
}

describe("TargetPicker", () => {
  it("allows several targets at once", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("checkbox", { name: /^TypeScript for Angular/ }));
    await user.click(screen.getByRole("checkbox", { name: /^C# \/ \.NET/ }));

    expect(latest).toEqual([{ target: "typescript-angular" }, { target: "csharp" }]);
  });

  it("shows the HTTP clients of a checked TypeScript target, with axios preselected", async () => {
    const { user } = setup();
    expect(screen.queryByRole("group", { name: /HTTP client for/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /^TypeScript for Nuxt/ }));

    const group = clients(/HTTP client for TypeScript for Nuxt/);
    expect(within(group).getByRole("checkbox", { name: /^axios/ })).toBeChecked();
    expect(within(group).getByRole("checkbox", { name: /^fetch/ })).not.toBeChecked();
    expect(latest).toEqual([{ target: "typescript-nuxt", httpClient: "axios" }]);
  });

  it("makes each checked HTTP client its own combination", async () => {
    const { user } = setup([{ target: "typescript-next", httpClient: "axios" }]);

    await user.click(within(clients(/Next\.js/)).getByRole("checkbox", { name: /^fetch/ }));

    expect(latest).toEqual([
      { target: "typescript-next", httpClient: "axios" },
      { target: "typescript-next", httpClient: "fetch" },
    ]);
  });

  it("unchecks the target when its last HTTP client is unchecked", async () => {
    const { user } = setup([{ target: "typescript-next", httpClient: "fetch" }]);

    await user.click(within(clients(/Next\.js/)).getByRole("checkbox", { name: /^fetch/ }));

    expect(latest).toEqual([]);
    expect(screen.getByRole("checkbox", { name: /^TypeScript for Next\.js/ })).not.toBeChecked();
    expect(screen.queryByRole("group", { name: /HTTP client for/ })).not.toBeInTheDocument();
  });

  it("removes every combination of an unchecked target", async () => {
    const { user } = setup([
      { target: "typescript-next", httpClient: "axios" },
      { target: "typescript-next", httpClient: "fetch" },
      { target: "csharp" },
    ]);

    await user.click(screen.getByRole("checkbox", { name: /^TypeScript for Next\.js/ }));

    expect(latest).toEqual([{ target: "csharp" }]);
  });
});
