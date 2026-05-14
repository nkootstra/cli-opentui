import { describe, expect, test } from "bun:test";
import { runInstallCommand } from "./install.ts";

describe("runInstallCommand", () => {
  test("dry-run reports the plan without writing", async () => {
    const writes: string[] = [];
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "owner/repo",
        skills: ["foo"],
        yes: false,
        force: false,
        dryRun: true,
        list: false,
        all: false,
        json: false,
        scope: "global",
      },
      {
        fetchSource: async () => "/repo",
        isInteractive: false,
        discoverSkills: async () => [
          {
            name: "foo",
            description: "Foo",
            relativePath: "skills/foo",
            absolutePath: "/repo/skills/foo",
          },
        ],
        buildInstallPlan: async () => ({
          scope: "global",
          claudeHome: "/claude",
          lockfileRoot: "/claude",
          source: { host: "github.com", owner: "owner", repo: "repo", requestedRef: null },
          operations: [
            {
              skill: {
                name: "foo",
                description: "Foo",
                relativePath: "skills/foo",
                absolutePath: "/repo/skills/foo",
              },
              destinationName: "foo",
              destinationPath: "/claude/skills/foo",
              exists: false,
            },
          ],
        }),
        installSkills: async () => {
          writes.push("write");
          return { installed: ["foo"] };
        },
      },
    );

    expect(output).toContain("Would install foo to global agent skills");
    expect(writes).toEqual([]);
  });

  test("requires confirmation before writing unless --yes is used", async () => {
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "owner/repo",
        skills: ["foo"],
        yes: false,
        force: false,
        dryRun: false,
        list: false,
        all: false,
        json: false,
        scope: "global",
      },
      {
        fetchSource: async () => "/repo",
        discoverSkills: async () => [
          {
            name: "foo",
            description: "Foo",
            relativePath: "skills/foo",
            absolutePath: "/repo/skills/foo",
          },
        ],
        confirmInstall: async () => false,
      },
    );

    expect(output).toBe("Install cancelled. No files were written.");
  });

  test("lists discovered skills and exits before planning", async () => {
    let planned = false;
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "owner/repo",
        skills: [],
        yes: false,
        force: false,
        dryRun: false,
        list: true,
        all: false,
        json: false,
        scope: "global",
      },
      {
        fetchSource: async () => "/repo",
        discoverSkills: async () => [
          {
            name: "foo",
            description: "Foo",
            relativePath: "skills/foo",
            absolutePath: "/repo/skills/foo",
          },
          {
            name: "bar",
            description: "Bar",
            relativePath: "skills/bar",
            absolutePath: "/repo/skills/bar",
          },
        ],
        buildInstallPlan: async () => {
          planned = true;
          throw new Error("should not plan");
        },
      },
    );

    expect(output).toContain("foo - Foo (skills/foo)");
    expect(output).toContain("bar - Bar (skills/bar)");
    expect(planned).toBe(false);
  });

  test("requires explicit selection instead of prompting when no selector is provided", async () => {
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "owner/repo",
        skills: [],
        yes: false,
        force: false,
        dryRun: true,
        list: false,
        all: false,
        json: false,
        scope: "global",
      },
      {
        fetchSource: async () => "/repo",
        discoverSkills: async () => [
          {
            name: "foo",
            description: "Foo",
            relativePath: "skills/foo",
            absolutePath: "/repo/skills/foo",
          },
        ],
      },
    );

    expect(output).toContain("Run again with --skill <name>, --all, or --list.");
  });

  test("selects all discovered skills with --all", async () => {
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "owner/repo",
        skills: [],
        yes: true,
        force: false,
        dryRun: true,
        list: false,
        all: true,
        json: false,
        scope: "global",
      },
      {
        fetchSource: async () => "/repo",
        discoverSkills: async () => [
          {
            name: "foo",
            description: "Foo",
            relativePath: "skills/foo",
            absolutePath: "/repo/skills/foo",
          },
          {
            name: "bar",
            description: "Bar",
            relativePath: "skills/bar",
            absolutePath: "/repo/skills/bar",
          },
        ],
      },
    );

    expect(output).toContain("Would install foo to global agent skills");
    expect(output).toContain("Would install bar to global agent skills");
  });

  test("lists discovered skills as json", async () => {
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "owner/repo",
        skills: [],
        yes: false,
        force: false,
        dryRun: false,
        list: true,
        all: false,
        json: true,
        scope: "global",
      },
      {
        fetchSource: async () => "/repo",
        discoverSkills: async () => [
          {
            name: "foo",
            description: "Foo",
            relativePath: "skills/foo",
            absolutePath: "/repo/skills/foo",
          },
        ],
      },
    );

    expect(JSON.parse(output)).toEqual({
      skills: [{ name: "foo", description: "Foo", relativePath: "skills/foo" }],
    });
  });

  test("uses local source paths without archive fetching", async () => {
    let fetched = false;
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "./local-skills",
        skills: [],
        yes: false,
        force: false,
        dryRun: false,
        list: true,
        all: false,
        json: false,
        scope: "global",
      },
      {
        fetchSource: async () => {
          fetched = true;
          return "/remote";
        },
        discoverSkills: async (root) => {
          expect(root).toBe("./local-skills");
          return [
            {
              name: "local",
              description: "Local",
              relativePath: ".",
              absolutePath: "./local-skills",
            },
          ];
        },
      },
    );

    expect(output).toContain("local - Local (.)");
    expect(fetched).toBe(false);
  });

  test("confirmed installs pass force and skip confirmation", async () => {
    let confirmed = false;
    let installedForce: boolean | undefined;
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "owner/repo",
        skills: ["foo"],
        yes: true,
        force: true,
        dryRun: false,
        list: false,
        all: false,
        json: false,
        scope: "global",
      },
      {
        fetchSource: async () => "/repo",
        discoverSkills: async () => [
          {
            name: "foo",
            description: "Foo",
            relativePath: "skills/foo",
            absolutePath: "/repo/skills/foo",
          },
        ],
        confirmInstall: async () => {
          confirmed = true;
          return false;
        },
        installSkills: async (_plan, options) => {
          installedForce = options?.force;
          return { installed: ["foo"] };
        },
      },
    );

    expect(output).toBe("Installed foo to global agent skills.");
    expect(confirmed).toBe(false);
    expect(installedForce).toBe(true);
  });

  test("passes explicit local scope into install planning", async () => {
    let plannedScope: string | undefined;
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "owner/repo",
        skills: ["foo"],
        yes: false,
        force: false,
        dryRun: true,
        list: false,
        all: false,
        json: false,
        scope: "local",
      },
      {
        fetchSource: async () => "/repo",
        discoverSkills: async () => [
          {
            name: "foo",
            description: "Foo",
            relativePath: "skills/foo",
            absolutePath: "/repo/skills/foo",
          },
        ],
        buildInstallPlan: async (options) => {
          plannedScope = options.scope;
          return {
            scope: "local",
            lockfileRoot: "/project/.agents",
            claudeHome: "/project/.agents",
            source: { host: "github.com", owner: "owner", repo: "repo", requestedRef: null },
            operations: [
              {
                skill: {
                  name: "foo",
                  description: "Foo",
                  relativePath: "skills/foo",
                  absolutePath: "/repo/skills/foo",
                },
                destinationName: "foo",
                destinationPath: "/project/.agents/skills/foo",
                claudeSymlinkPath: "/project/.claude/skills/foo",
                exists: false,
              },
            ],
          };
        },
      },
    );

    expect(plannedScope).toBe("local");
    expect(output).toContain("Would install foo to local project skills");
  });

  test("interactive mode selects skills and local scope", async () => {
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "owner/repo",
        skills: [],
        yes: false,
        force: false,
        dryRun: true,
        list: false,
        all: false,
        json: false,
        scope: null,
      },
      {
        fetchSource: async () => "/repo",
        discoverSkills: async () => [
          {
            name: "foo",
            description: "Foo",
            relativePath: "skills/foo",
            absolutePath: "/repo/skills/foo",
          },
          {
            name: "bar",
            description: "Bar",
            relativePath: "skills/bar",
            absolutePath: "/repo/skills/bar",
          },
        ],
        selectSkills: async () => ["bar"],
        selectScope: async () => "local",
      },
    );

    expect(output).toContain("Would install bar to local project skills");
    expect(output).not.toContain("Would install foo");
  });

  test("interactive skill selection cancellation does not print discovered skills", async () => {
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "owner/repo",
        skills: [],
        yes: false,
        force: false,
        dryRun: true,
        list: false,
        all: false,
        json: false,
        scope: null,
      },
      {
        fetchSource: async () => "/repo",
        discoverSkills: async () => [
          {
            name: "foo",
            description: "Foo",
            relativePath: "skills/foo",
            absolutePath: "/repo/skills/foo",
          },
          {
            name: "bar",
            description: "Bar",
            relativePath: "skills/bar",
            absolutePath: "/repo/skills/bar",
          },
        ],
        selectSkills: async () => null,
      },
    );

    expect(output).toBe("Install cancelled. No files were written.");
  });

  test("interactive scope cancellation does not print discovered skills", async () => {
    const output = await runInstallCommand(
      {
        command: "skills",
        source: "owner/repo",
        skills: ["foo"],
        yes: false,
        force: false,
        dryRun: true,
        list: false,
        all: false,
        json: false,
        scope: null,
      },
      {
        fetchSource: async () => "/repo",
        discoverSkills: async () => [
          {
            name: "foo",
            description: "Foo",
            relativePath: "skills/foo",
            absolutePath: "/repo/skills/foo",
          },
        ],
        selectScope: async () => null,
      },
    );

    expect(output).toBe("Install cancelled. No files were written.");
  });
});
