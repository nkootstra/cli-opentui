import { fetchGitHubArchive, readLockfile, updateSkills, type Lockfile } from "@repo/skills";
import type { CliCommand } from "./args.ts";

type UpdateCommand = Extract<CliCommand, { command: "update" }>;

export type UpdateDeps = {
  readLockfile?: typeof readLockfile;
  updateSkills?: typeof updateSkills;
};

export async function runUpdateCommand(
  command: UpdateCommand,
  deps: UpdateDeps = {},
): Promise<string> {
  if (command.dryRun)
    return formatDryRun(await (deps.readLockfile ?? readLockfile)(), command.json);
  if (!command.yes)
    return "Update requires --yes. Run skills update --dry-run to preview, then skills update --yes to apply.";

  const result = await (deps.updateSkills ?? updateSkills)({ fetchSource: fetchGitHubArchive });
  if (result.failed.length > 0) {
    throw new Error(
      `Failed to update ${result.failed.length} skill${result.failed.length === 1 ? "" : "s"}: ${result.failed.map((entry) => `${entry.destinationName}: ${entry.message}`).join("; ")}`,
    );
  }
  if (command.json) return JSON.stringify(result);
  const updated =
    result.updated.length > 0 ? `Updated ${result.updated.join(", ")}.` : "No skills updated.";
  return updated;
}

function formatDryRun(lockfile: Lockfile, json: boolean): string {
  const entries = Object.values(lockfile.skills);
  if (json) {
    return JSON.stringify({
      updates: entries.map((entry) => ({
        destinationName: entry.destinationName,
        source: `${entry.sourceHost}/${entry.owner}/${entry.repo}`,
        requestedRef: entry.requestedRef,
      })),
    });
  }
  if (entries.length === 0) return "No Claude Code skills are recorded in the lockfile.";
  return entries
    .map(
      (entry) =>
        `Would update ${entry.destinationName} from ${entry.sourceHost}/${entry.owner}/${entry.repo}`,
    )
    .join("\n");
}
