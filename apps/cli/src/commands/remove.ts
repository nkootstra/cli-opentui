import { removeSkill } from "@repo/skills";
import type { CliCommand } from "./args.ts";

type RemoveCommand = Extract<CliCommand, { command: "remove" }>;

export type RemoveDeps = {
  removeSkill?: typeof removeSkill;
};

export async function runRemoveCommand(
  command: RemoveCommand,
  deps: RemoveDeps = {},
): Promise<string> {
  const scope = command.scope ?? "global";

  if (!command.yes) {
    return `Remove '${command.skill}' from ${scopeLabel(scope)}? Run again with --yes to confirm.`;
  }

  const result = await (deps.removeSkill ?? removeSkill)(command.skill, { scope });

  if (command.json) return JSON.stringify(result);
  return `Removed '${result.removed}' from ${scopeLabel(result.scope)}.`;
}

function scopeLabel(scope: "local" | "global"): string {
  return scope === "local" ? "local project skills" : "global agent skills";
}
