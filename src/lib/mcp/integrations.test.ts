import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { version } from "../../../package.json";
import { TOOL_NAMES } from "./server";

/** The agent plugins and skills in `integrations/` must match the MCP server they describe. */
const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;

const CANONICAL_SKILL = "integrations/skill/SKILL.md";
const SKILL_COPIES = [
  "integrations/claude-code/scrapi/skills/scrapi/SKILL.md",
  "integrations/codex/scrapi/skills/scrapi/SKILL.md",
  "integrations/opencode/skills/scrapi/SKILL.md",
];

describe("agent integrations", () => {
  it.each(SKILL_COPIES)("%s is a copy of the canonical skill", (path) => {
    expect(read(path)).toBe(read(CANONICAL_SKILL));
  });

  it("names exactly the tools the MCP server registers", () => {
    const mentioned = new Set(read(CANONICAL_SKILL).match(/\bscrapi_[a-z_]+/g));

    expect([...mentioned].sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("has the skill frontmatter every agent reads", () => {
    expect(read(CANONICAL_SKILL)).toMatch(/^---\nname: scrapi\ndescription: .+\n---\n/);
  });

  it.each(["integrations/claude-code/scrapi/.claude-plugin/plugin.json", "integrations/codex/scrapi/plugin.json"])(
    "%s has the app's version",
    (path) => {
      expect(readJson(path)).toMatchObject({ name: "scrapi", version });
    },
  );

  it("points every MCP configuration at the /api/mcp endpoint", () => {
    const urls = [
      read("integrations/claude-code/scrapi/.mcp.json"),
      read("integrations/codex/scrapi/mcp.json"),
      read("integrations/opencode/opencode.json"),
    ].map((text) => /"url": "([^"]+)"/.exec(text)?.[1]);

    expect(urls).toEqual([
      "${user_config.scrapi_mcp_url}",
      "http://localhost:13000/api/mcp",
      "http://localhost:13000/api/mcp",
    ]);
  });

  it("defaults the Claude Code plugin's URL option to the local server", () => {
    expect(readJson("integrations/claude-code/scrapi/.claude-plugin/plugin.json")).toMatchObject({
      userConfig: { scrapi_mcp_url: { type: "string", default: "http://localhost:13000/api/mcp" } },
    });
  });

  it("lists plugins in the marketplaces that exist in the repository", () => {
    const claude = readJson(".claude-plugin/marketplace.json") as { plugins: { source: string }[] };
    const codex = readJson(".agents/plugins/marketplace.json") as { plugins: { source: { path: string } }[] };

    const paths = [...claude.plugins.map((plugin) => plugin.source), ...codex.plugins.map((plugin) => plugin.source.path)];
    for (const path of paths) expect(existsSync(join(root, path))).toBe(true);
  });
});
