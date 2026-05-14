import { describe, expect, test } from "bun:test";
import { runUpdateCommand } from "./update.ts";

describe("runUpdateCommand", () => {
  test("dry-run reports lockfile entries without updating", async () => {
    let updated = false;
    const output = await runUpdateCommand(
      { command: "update", yes: false, dryRun: true, json: false },
      {
        readLockfile: async () => ({
          version: 1,
          skills: {
            foo: {
              sourceHost: "github.com",
              owner: "owner",
              repo: "repo",
              requestedRef: null,
              resolvedCommit: null,
              sourceSkillPath: "skills/foo",
              displayName: "foo",
              destinationName: "foo",
              installedAt: "2026-05-13T00:00:00.000Z",
            },
          },
        }),
        updateSkills: async () => {
          updated = true;
          return { updated: ["foo"], failed: [] };
        },
      },
    );

    expect(output).toContain("Would update foo from github.com/owner/repo");
    expect(updated).toBe(false);
  });

  test("update uses the package updater when confirmed", async () => {
    const output = await runUpdateCommand(
      { command: "update", yes: true, dryRun: false, json: false },
      {
        updateSkills: async () => ({ updated: ["foo"], failed: [] }),
      },
    );

    expect(output).toBe("Updated foo.");
  });

  test("dry-run reports lockfile entries as json", async () => {
    const output = await runUpdateCommand(
      { command: "update", yes: false, dryRun: true, json: true },
      {
        readLockfile: async () => ({
          version: 1,
          skills: {
            foo: {
              sourceHost: "github.com",
              owner: "owner",
              repo: "repo",
              requestedRef: null,
              resolvedCommit: null,
              sourceSkillPath: "skills/foo",
              displayName: "foo",
              destinationName: "foo",
              installedAt: "2026-05-13T00:00:00.000Z",
            },
          },
        }),
      },
    );

    expect(JSON.parse(output)).toEqual({
      updates: [
        {
          destinationName: "foo",
          source: "github.com/owner/repo",
          requestedRef: null,
        },
      ],
    });
  });

  test("plain update refuses to mutate without yes", async () => {
    let updated = false;
    const output = await runUpdateCommand(
      { command: "update", yes: false, dryRun: false, json: false },
      {
        updateSkills: async () => {
          updated = true;
          return { updated: ["foo"], failed: [] };
        },
      },
    );

    expect(output).toBe(
      "Update requires --yes. Run skills update --dry-run to preview, then skills update --yes to apply.",
    );
    expect(updated).toBe(false);
  });

  test("partial update failures are exposed for non-zero exit handling", async () => {
    await expect(
      runUpdateCommand(
        { command: "update", yes: true, dryRun: false, json: false },
        {
          updateSkills: async () => ({
            updated: ["foo"],
            failed: [{ destinationName: "bar", message: "missing" }],
          }),
        },
      ),
    ).rejects.toThrow("Failed to update 1 skill");
  });
});
