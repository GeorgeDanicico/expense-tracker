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

// U8 to U10 converted expenses, investments, net worth, reminders, to-dos and the calendar (audit D6): their components and pages make no request of their own.
describe("no-fetch-in-components in eslint.config.mjs", () => {
  const options = config
    .filter((entry) => entry.rules?.["local/no-fetch-in-components"])
    .map((entry) => entry.rules["local/no-fetch-in-components"][1]);

  it("is on for the converted modules' components and pages", () => {
    expect(options).toHaveLength(1);
    expect(options[0].modules).toEqual(expect.arrayContaining([
      "src/components/expenses", "src/app/(app)/expenses",
      "src/components/investments", "src/app/(app)/investments",
      "src/components/net-worth", "src/app/(app)/net-worth",
      "src/components/reminders", "src/app/(app)/reminders",
      "src/components/todos", "src/app/(app)/todos",
      "src/components/family-calendar", "src/app/(app)/calendar",
    ]));
  });

  it.each(["investments", "net-worth", "reminders", "todos", "family-calendar"])("reports a request in a %s component", async (module) => {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: new URL("..", import.meta.url).pathname });
    const [result] = await eslint.lintText(`export async function f() { await fetch("/api/x"); }\n`, {
      filePath: `src/components/${module}/some-panel.tsx`,
    });
    expect(result.messages.map((message) => message.ruleId)).toContain("local/no-fetch-in-components");
  }, 60_000);

  it("reports a request in an expenses component through the project config", async () => {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: new URL("..", import.meta.url).pathname });
    const [result] = await eslint.lintText(`export async function f() { await fetch("/api/expenses"); }\n`, {
      filePath: "src/components/expenses/some-panel.tsx",
    });
    expect(result.messages.map((message) => message.ruleId)).toContain("local/no-fetch-in-components");
  }, 60_000);
});
