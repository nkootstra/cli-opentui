import { describe, expect, test } from "bun:test";
import {
  formatDiscoveredSkills,
  promptForConfirmation,
  promptForScope,
  promptForSkillSelection,
} from "./installer-prompts.ts";

describe("installer prompts", () => {
  test("formats discovered skills before installation", () => {
    expect(
      formatDiscoveredSkills([
        {
          name: "foo",
          description: "Foo skill",
          relativePath: "skills/foo",
          absolutePath: "/repo/skills/foo",
        },
      ]),
    ).toContain("foo - Foo skill (skills/foo)");
  });

  test("accepts y/yes confirmation only", async () => {
    expect(await promptForConfirmation({ question: "Install?", readLine: async () => "yes" })).toBe(
      true,
    );
    expect(await promptForConfirmation({ question: "Install?", readLine: async () => "no" })).toBe(
      false,
    );
  });

  test("selects skills by number, name, or all", async () => {
    const skills = [
      { name: "foo", description: "Foo", relativePath: "skills/foo", absolutePath: "/repo/foo" },
      { name: "bar", description: "Bar", relativePath: "skills/bar", absolutePath: "/repo/bar" },
    ];

    expect(await promptForSkillSelection(skills, { readLine: async () => "2" })).toEqual(["bar"]);
    expect(await promptForSkillSelection(skills, { readLine: async () => "foo bar" })).toEqual([
      "foo",
      "bar",
    ]);
    expect(await promptForSkillSelection(skills, { readLine: async () => "all" })).toEqual([
      "foo",
      "bar",
    ]);
  });

  test("uses an injected multiselect prompt for skill selection", async () => {
    const skills = [
      { name: "foo", description: "Foo", relativePath: "skills/foo", absolutePath: "/repo/foo" },
      { name: "bar", description: "Bar", relativePath: "skills/bar", absolutePath: "/repo/bar" },
    ];

    const selected = await promptForSkillSelection(skills, {
      multiselect: async (options) => {
        expect(options.message).toBe("Select skills to install");
        expect(options.options).toEqual([
          { value: "foo", label: "foo", hint: "Foo (skills/foo)" },
          { value: "bar", label: "bar", hint: "Bar (skills/bar)" },
        ]);
        return ["bar"];
      },
    });

    expect(selected).toEqual(["bar"]);
  });

  test("selects local scope by default and global explicitly", async () => {
    expect(await promptForScope({ readLine: async () => "" })).toBe("local");
    expect(await promptForScope({ readLine: async () => "global" })).toBe("global");
  });

  test("uses an injected select prompt for install scope", async () => {
    const scope = await promptForScope({
      select: async (options) => {
        expect(options.message).toBe("Install location");
        expect(options.initialValue).toBe("local");
        expect(options.options).toEqual([
          {
            value: "local",
            label: "Local",
            hint: "copy to .agents/skills, symlink from .claude/skills",
          },
          {
            value: "global",
            label: "Global",
            hint: "copy to ~/.agents/skills, symlink from ~/.claude/skills",
          },
        ]);
        return "global";
      },
    });

    expect(scope).toBe("global");
  });
});
