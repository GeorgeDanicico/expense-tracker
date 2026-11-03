import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import config from "../eslint.config.mjs";
import plugin from "./index.mjs";

const docs = readFileSync(new URL("../docs/lint-rules.md", import.meta.url), "utf8");
const ruleNames = Object.keys(plugin.rules);

const isOn = (setting) => {
  const severity = Array.isArray(setting) ? setting[0] : setting;
  return severity === "error" || severity === "warn" || severity === 1 || severity === 2;
};
const enabled = new Set(
  config.flatMap((entry) =>
    Object.entries(entry.rules ?? {})
      .filter(([name, setting]) => name.startsWith("local/") && isOn(setting))
      .map(([name]) => name.slice("local/".length)),
  ),
);

describe("the local lint plugin", () => {
  it("is registered as `local`", () => {
    expect(config.some((entry) => entry.plugins?.local === plugin)).toBe(true);
  });

  it.each(ruleNames)("%s is enabled in eslint.config.mjs", (name) => {
    expect(enabled.has(name)).toBe(true);
  });

  it.each(ruleNames)("%s has a section in docs/lint-rules.md", (name) => {
    expect(docs).toMatch(new RegExp(`^### \`${name}\`$`, "m"));
  });

  it.each(ruleNames)("%s points at its section and describes itself", (name) => {
    const { docs: ruleDocs } = plugin.rules[name].meta;
    expect(ruleDocs.description).toBeTruthy();
    expect(ruleDocs.url).toMatch(new RegExp(`/docs/lint-rules\\.md#${name}$`));
  });

  it.each(ruleNames)("%s has tests", (name) => {
    expect(existsSync(new URL(`./${name}.test.mjs`, import.meta.url))).toBe(true);
  });

  it("only configures rules the plugin has", () => {
    const configured = config.flatMap((entry) => Object.keys(entry.rules ?? {})).filter((name) => name.startsWith("local/"));
    for (const name of configured) expect(ruleNames).toContain(name.slice("local/".length));
  });

  it("documents no rule the plugin lacks", () => {
    const documented = [...docs.matchAll(/^### `([a-z-]+)`$/gm)].map((match) => match[1]);
    expect(documented.sort()).toEqual([...ruleNames].sort());
  });
});
