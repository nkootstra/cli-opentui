import { describe, expect, test } from "bun:test";
import { runListCommand } from "./list.ts";

const makeSkill = (
  destinationName: string,
  scope: "local" | "global" = "global",
  requestedRef: string | null = null,
) => ({
  destinationName,
  displayName: destinationName,
  source: `github.com/owner/repo`,
  requestedRef,
  installedAt: "2026-05-13T00:00:00.000Z",
  scope,
});

describe("runListCommand", () => {
  test("shows message when no skills installed", async () => {
    const output = await runListCommand(
      { command: "list", json: false, scope: null },
      { listInstalledSkills: async () => [] },
    );
    expect(output).toBe("No skills installed.");
  });

  test("shows scope-specific message when scope filter active and empty", async () => {
    const output = await runListCommand(
      { command: "list", json: false, scope: "global" },
      { listInstalledSkills: async () => [] },
    );
    expect(output).toBe("No skills installed in global skills.");
  });

  test("formats global skills section", async () => {
    const output = await runListCommand(
      { command: "list", json: false, scope: null },
      { listInstalledSkills: async () => [makeSkill("foo", "global")] },
    );
    expect(output).toContain("Global skills (1)");
    expect(output).toContain("foo");
    expect(output).toContain("github.com/owner/repo");
  });

  test("formats local skills section separately from global", async () => {
    const output = await runListCommand(
      { command: "list", json: false, scope: null },
      {
        listInstalledSkills: async () => [
          makeSkill("local-skill", "local"),
          makeSkill("global-skill", "global"),
        ],
      },
    );
    expect(output).toContain("Local skills (1)");
    expect(output).toContain("Global skills (1)");
    expect(output).toContain("local-skill");
    expect(output).toContain("global-skill");
  });

  test("includes ref in output when present", async () => {
    const output = await runListCommand(
      { command: "list", json: false, scope: null },
      { listInstalledSkills: async () => [makeSkill("foo", "global", "main")] },
    );
    expect(output).toContain("@main");
  });

  test("returns json with skills array", async () => {
    const output = await runListCommand(
      { command: "list", json: true, scope: null },
      { listInstalledSkills: async () => [makeSkill("foo", "global")] },
    );
    const parsed = JSON.parse(output);
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.skills[0].destinationName).toBe("foo");
    expect(parsed.skills[0].scope).toBe("global");
  });

  test("json empty returns empty skills array", async () => {
    const output = await runListCommand(
      { command: "list", json: true, scope: null },
      { listInstalledSkills: async () => [] },
    );
    expect(JSON.parse(output)).toEqual({ skills: [] });
  });

  test("passes scope filter through to listInstalledSkills", async () => {
    let capturedOptions: { scope?: string } = {};
    await runListCommand(
      { command: "list", json: false, scope: "local" },
      {
        listInstalledSkills: async (opts) => {
          capturedOptions = opts;
          return [];
        },
      },
    );
    expect(capturedOptions.scope).toBe("local");
  });
});
