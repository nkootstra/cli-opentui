import type { DiscoveredSkill, InstallPlan } from "@repo/skills";
import { isCancel, multiselect, select } from "@clack/prompts";

type ChoicePromptOptions<T extends string> = Parameters<typeof select<T>>[0];
type MultiChoicePromptOptions<T extends string> = Parameters<typeof multiselect<T>>[0];

export function formatDiscoveredSkills(skills: DiscoveredSkill[]): string {
  return skills
    .map(
      (skill) => `${skill.name} - ${skill.description ?? "No description"} (${skill.relativePath})`,
    )
    .join("\n");
}

export async function promptForConfirmation(options: {
  question: string;
  readLine?: (question: string) => Promise<string>;
}): Promise<boolean> {
  const answer = (await (options.readLine ?? defaultReadLine)(`${options.question} [y/N] `))
    .trim()
    .toLowerCase();
  return answer === "y" || answer === "yes";
}

export async function promptForSkillSelection(
  skills: DiscoveredSkill[],
  options: {
    readLine?: (question: string) => Promise<string>;
    multiselect?: (options: MultiChoicePromptOptions<string>) => Promise<string[] | symbol>;
  } = {},
): Promise<string[] | null> {
  if (skills.length === 1) return [skills[0]!.name];
  if (!options.readLine) {
    const selected = await (options.multiselect ?? defaultMultiselect)({
      message: "Select skills to install",
      required: false,
      options: skills.map((skill) => ({
        value: skill.name,
        label: skill.name,
        hint: `${skill.description ?? "No description"} (${skill.relativePath})`,
      })),
    });
    if (isCancel(selected)) return null;
    return selected;
  }
  const answer = (
    await options.readLine(
      `${formatNumberedSkills(skills)}\nSelect skills by number/name, "all", or empty to cancel: `,
    )
  ).trim();
  if (!answer) return [];
  if (answer.toLowerCase() === "all") return skills.map((skill) => skill.name);

  const selected = answer.split(/[\s,]+/).filter(Boolean);
  return selected.map((value) => {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= skills.length)
      return skills[numeric - 1]!.name;
    const skill = skills.find((candidate) => candidate.name === value);
    if (!skill) throw new Error(`Unknown skill '${value}'`);
    return skill.name;
  });
}

export async function promptForScope(
  options: {
    readLine?: (question: string) => Promise<string>;
    select?: (
      options: ChoicePromptOptions<"local" | "global">,
    ) => Promise<"local" | "global" | symbol>;
  } = {},
): Promise<"local" | "global" | null> {
  if (!options.readLine) {
    const scope = await (options.select ?? defaultSelect)({
      message: "Install location",
      initialValue: "local",
      options: [
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
      ],
    });
    if (isCancel(scope)) return null;
    return scope;
  }
  const answer = (
    await options.readLine(
      "Install locally to .agents/skills or globally to Claude Code? [local/global] ",
    )
  )
    .trim()
    .toLowerCase();
  if (!answer || answer === "local" || answer === "l") return "local";
  if (answer === "global" || answer === "g") return "global";
  throw new Error(`Unknown install scope '${answer}'`);
}

export async function confirmInstallPlan(plan: InstallPlan): Promise<boolean> {
  const names = plan.operations.map((operation) => operation.destinationName).join(", ");
  const target = plan.scope === "local" ? "local project skills" : "global agent skills";
  return promptForConfirmation({ question: `Install ${names} to ${target}?` });
}

function formatNumberedSkills(skills: DiscoveredSkill[]): string {
  return skills
    .map(
      (skill, index) =>
        `${index + 1}. ${skill.name} - ${skill.description ?? "No description"} (${skill.relativePath})`,
    )
    .join("\n");
}

async function defaultReadLine(question: string): Promise<string> {
  process.stdout.write(question);
  for await (const line of console) return String(line);
  return "";
}

async function defaultSelect<T extends string>(
  options: ChoicePromptOptions<T>,
): Promise<T | symbol> {
  return select(options);
}

async function defaultMultiselect<T extends string>(
  options: MultiChoicePromptOptions<T>,
): Promise<T[] | symbol> {
  return multiselect(options);
}
