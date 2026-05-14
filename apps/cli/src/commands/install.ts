import {
  buildInstallPlan,
  discoverSkills,
  fetchGitHubArchive,
  installSkills,
  parseSourceSpec,
  type DiscoveredSkill,
  type InstallPlan,
  type SourceSpec,
} from "@repo/skills";
import type { CliCommand } from "./args.ts";
import {
  confirmInstallPlan,
  formatDiscoveredSkills,
  promptForScope,
  promptForSkillSelection,
} from "../prompts/installer-prompts.ts";

type InstallCommand = Extract<CliCommand, { command: "skills" }>;

export type InstallDeps = {
  fetchSource?: (source: SourceSpec) => Promise<string>;
  discoverSkills?: (root: string) => Promise<DiscoveredSkill[]>;
  buildInstallPlan?: typeof buildInstallPlan;
  installSkills?: typeof installSkills;
  confirmInstall?: (plan: InstallPlan) => Promise<boolean>;
  selectSkills?: (skills: DiscoveredSkill[]) => Promise<string[] | null>;
  selectScope?: () => Promise<"local" | "global" | null>;
  isInteractive?: boolean;
};

export async function runInstallCommand(
  command: InstallCommand,
  deps: InstallDeps = {},
): Promise<string> {
  const local = isLocalSource(command.source);
  const source = local ? localSourceSpec(command.source) : parseSourceSpec(command.source);
  const fetchSource = deps.fetchSource ?? fetchGitHubArchive;
  const sourceRoot = local ? command.source : await fetchSource(source);
  const skills = await (deps.discoverSkills ?? discoverSkills)(sourceRoot);

  if (command.list)
    return command.json
      ? JSON.stringify({ skills: publicSkills(skills) })
      : formatDiscoveredSkills(skills);

  const canPrompt =
    deps.isInteractive ??
    Boolean(deps.selectSkills || deps.selectScope || (process.stdin.isTTY && process.stdout.isTTY));
  const selectedNames = command.all
    ? skills.map((skill) => skill.name)
    : command.skills.length > 0
      ? command.skills
      : command.json || !canPrompt
        ? []
        : await (deps.selectSkills ?? promptForSkillSelection)(skills);
  if (selectedNames === null) return "Install cancelled. No files were written.";
  if (selectedNames.length === 0) {
    return `${formatDiscoveredSkills(skills)}\nRun again with --skill <name>, --all, or --list.`;
  }

  const scope =
    command.scope ??
    (command.json || !canPrompt ? "global" : await (deps.selectScope ?? promptForScope)());
  if (scope === null) return "Install cancelled. No files were written.";
  const plan = await (deps.buildInstallPlan ?? buildInstallPlan)({
    source,
    skills,
    selectedNames,
    scope,
  });
  if (command.json && command.dryRun) {
    return JSON.stringify({
      operations: plan.operations.map((operation) => ({
        destinationName: operation.destinationName,
        destinationPath: operation.destinationPath,
        exists: operation.exists,
        sourceSkillPath: operation.skill.relativePath,
      })),
    });
  }
  const summary = `${formatDiscoveredSkills(skills)}\n${formatPlan(plan, command.dryRun ? "Would install" : "Install")}`;

  if (command.dryRun) return summary;
  if (!command.yes) {
    const confirmed = await (deps.confirmInstall ?? confirmInstallPlan)(plan);
    if (!confirmed) return "Install cancelled. No files were written.";
  }

  const result = await (deps.installSkills ?? installSkills)(plan, { force: command.force });
  return command.json
    ? JSON.stringify(result)
    : `Installed ${result.installed.join(", ")} to ${scopeLabel(plan.scope)}.`;
}

function isLocalSource(source: string): boolean {
  return source.startsWith(".") || source.startsWith("/") || source.startsWith("file://");
}

function localSourceSpec(source: string): SourceSpec {
  const repo = source.replace(/^file:\/\//, "");
  return { host: "local", owner: "", repo, requestedRef: null };
}

function publicSkills(
  skills: DiscoveredSkill[],
): Array<Pick<DiscoveredSkill, "name" | "description" | "relativePath">> {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    relativePath: skill.relativePath,
  }));
}

function formatPlan(plan: InstallPlan, prefix: string): string {
  return plan.operations
    .map(
      (operation) =>
        `${prefix} ${operation.destinationName} to ${scopeLabel(plan.scope)}${operation.exists ? " (overwrite)" : ""}`,
    )
    .join("\n");
}

function scopeLabel(scope: InstallPlan["scope"]): string {
  return scope === "local" ? "local project skills" : "global agent skills";
}
