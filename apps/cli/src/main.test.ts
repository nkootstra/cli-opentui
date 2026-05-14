import { describe, expect, test } from "bun:test";
import { runCli, runCliEntry } from "./main.tsx";

describe("runCli", () => {
  test("starts OpenTUI when no command arguments are provided", async () => {
    let rendered = false;
    const output = await runCli([], {
      startTui: async () => {
        rendered = true;
      },
    });

    expect(output).toBeNull();
    expect(rendered).toBe(true);
  });

  test("routes skills commands without starting OpenTUI", async () => {
    let rendered = false;
    const output = await runCli(["skills", "owner/repo", "--dry-run"], {
      startTui: async () => {
        rendered = true;
      },
      runSkillsCommand: async () => "skills output",
    });

    expect(output).toBe("skills output");
    expect(rendered).toBe(false);
  });

  test("routes nested skills update without starting OpenTUI", async () => {
    let rendered = false;
    const output = await runCli(["skills", "update", "--dry-run"], {
      startTui: async () => {
        rendered = true;
      },
      runUpdateCommand: async (command) => {
        expect(command).toEqual({ command: "update", yes: false, dryRun: true, json: false });
        return "update output";
      },
    });

    expect(output).toBe("update output");
    expect(rendered).toBe(false);
  });

  test("entrypoint converts command errors to stderr and exit code", async () => {
    const writes: string[] = [];
    const exitCode = await runCliEntry(["wat"], {
      runCli: async () => {
        throw new Error("Unknown command 'wat'. Usage: skills <source>");
      },
      writeStdout: () => {
        throw new Error("should not write stdout");
      },
      writeStderr: (message) => writes.push(message),
    });

    expect(exitCode).toBe(1);
    expect(writes.join("")).toContain("Unknown command 'wat'");
    expect(writes.join("")).not.toContain("at ");
  });
});
