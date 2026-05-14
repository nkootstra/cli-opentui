import { describe, expect, test } from "bun:test";
import { runRemoveCommand } from "./remove.ts";

describe("runRemoveCommand", () => {
  test("prompts for confirmation when --yes not given", async () => {
    let removed = false;
    const output = await runRemoveCommand(
      { command: "remove", skill: "foo", yes: false, json: false, scope: null },
      {
        removeSkill: async () => {
          removed = true;
          return { removed: "foo", scope: "global" };
        },
      },
    );
    expect(output).toContain("foo");
    expect(output).toContain("--yes");
    expect(removed).toBe(false);
  });

  test("removes skill when --yes given", async () => {
    const output = await runRemoveCommand(
      { command: "remove", skill: "foo", yes: true, json: false, scope: null },
      { removeSkill: async () => ({ removed: "foo", scope: "global" }) },
    );
    expect(output).toContain("foo");
    expect(output).toContain("global agent skills");
  });

  test("removes local skill and labels correctly", async () => {
    const output = await runRemoveCommand(
      { command: "remove", skill: "bar", yes: true, json: false, scope: "local" },
      { removeSkill: async () => ({ removed: "bar", scope: "local" }) },
    );
    expect(output).toContain("bar");
    expect(output).toContain("local project skills");
  });

  test("passes scope to removeSkill", async () => {
    let capturedScope: string | undefined;
    await runRemoveCommand(
      { command: "remove", skill: "foo", yes: true, json: false, scope: "local" },
      {
        removeSkill: async (_name, opts) => {
          capturedScope = opts?.scope;
          return { removed: "foo", scope: "local" };
        },
      },
    );
    expect(capturedScope).toBe("local");
  });

  test("returns json result when --json given", async () => {
    const output = await runRemoveCommand(
      { command: "remove", skill: "foo", yes: true, json: true, scope: null },
      { removeSkill: async () => ({ removed: "foo", scope: "global" }) },
    );
    expect(JSON.parse(output)).toEqual({ removed: "foo", scope: "global" });
  });

  test("propagates error from removeSkill", async () => {
    await expect(
      runRemoveCommand(
        { command: "remove", skill: "missing", yes: true, json: false, scope: null },
        {
          removeSkill: async () => {
            throw new Error("Skill 'missing' is not installed in global skills.");
          },
        },
      ),
    ).rejects.toThrow("not installed");
  });
});
