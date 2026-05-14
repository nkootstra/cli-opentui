import { listInstalledSkills, type InstalledSkill } from "@repo/skills";
import type { CliCommand } from "./args.ts";

type ListCommand = Extract<CliCommand, { command: "list" }>;

export type ListDeps = {
  listInstalledSkills?: typeof listInstalledSkills;
};

export async function runListCommand(command: ListCommand, deps: ListDeps = {}): Promise<string> {
  const skills = await (deps.listInstalledSkills ?? listInstalledSkills)({
    scope: command.scope ?? undefined,
  });

  if (command.json) {
    return JSON.stringify({ skills: skills.map(publicSkill) });
  }

  if (skills.length === 0) {
    return command.scope
      ? `No skills installed in ${command.scope} skills.`
      : "No skills installed.";
  }

  return formatInstalledSkills(skills);
}

function formatInstalledSkills(skills: InstalledSkill[]): string {
  const local = skills.filter((s) => s.scope === "local");
  const global = skills.filter((s) => s.scope === "global");
  const sections: string[] = [];

  if (local.length > 0) {
    sections.push(`Local skills (${local.length}):\n${local.map(formatSkillLine).join("\n")}`);
  }
  if (global.length > 0) {
    sections.push(`Global skills (${global.length}):\n${global.map(formatSkillLine).join("\n")}`);
  }

  return sections.join("\n\n");
}

function formatSkillLine(skill: InstalledSkill): string {
  const ref = skill.requestedRef ? `@${skill.requestedRef}` : "";
  return `  ${skill.destinationName}  (${skill.source}${ref})`;
}

function publicSkill(skill: InstalledSkill): object {
  return {
    destinationName: skill.destinationName,
    displayName: skill.displayName,
    source: skill.source,
    requestedRef: skill.requestedRef,
    installedAt: skill.installedAt,
    scope: skill.scope,
  };
}
