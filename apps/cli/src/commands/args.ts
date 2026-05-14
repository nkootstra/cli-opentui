export type CliCommand =
  | { command: "tui" }
  | {
      command: "skills";
      source: string;
      skills: string[];
      yes: boolean;
      force: boolean;
      dryRun: boolean;
      list: boolean;
      all: boolean;
      json: boolean;
      scope: "local" | "global" | null;
    }
  | { command: "update"; yes: boolean; dryRun: boolean; json: boolean };

export function parseArgs(args: string[]): CliCommand {
  const [command, ...rest] = args;
  if (!command) return { command: "tui" };
  if (command === "skills") {
    if (rest[0] === "update") return parseUpdate(rest.slice(1));
    return parseSkills(rest);
  }
  if (command === "update") return parseUpdate(rest);
  throw new Error(
    `Unknown command '${command}'. Usage: skills <source> [skill] [--skill <name>] [--all] [--list] [--yes] [--force] [--dry-run] | update [--yes] [--dry-run]`,
  );
}

function parseSkills(args: string[]): Extract<CliCommand, { command: "skills" }> {
  const source = args.shift();
  if (!source || source.startsWith("--"))
    throw new Error(
      "Usage: skills <source> [skill] [--skill <name>] [--all] [--list] [--yes] [--force] [--dry-run]",
    );

  const skills: string[] = [];
  let yes = false;
  let force = false;
  let dryRun = false;
  let list = false;
  let all = false;
  let json = false;
  let scope: "local" | "global" | null = null;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--yes" || arg === "-y") yes = true;
    else if (arg === "--force") force = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--list" || arg === "-l") list = true;
    else if (arg === "--all") all = true;
    else if (arg === "--json") json = true;
    else if (arg === "--local") {
      if (scope === "global") throw new Error("Choose either --local or --global");
      scope = "local";
    } else if (arg === "--global" || arg === "-g") {
      if (scope === "local") throw new Error("Choose either --local or --global");
      scope = "global";
    } else if (arg === "--skill" || arg === "-s") {
      const value = args[++index];
      if (!value) throw new Error(`Expected value after ${arg}`);
      skills.push(value);
    } else if (!arg.startsWith("--") && skills.length === 0) skills.push(arg);
    else throw new Error(`Unknown install argument '${arg}'`);
  }

  return { command: "skills", source, skills, yes, force, dryRun, list, all, json, scope };
}

function parseUpdate(args: string[]): Extract<CliCommand, { command: "update" }> {
  let yes = false;
  let dryRun = false;
  let json = false;
  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") yes = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--json") json = true;
    else throw new Error(`Unknown update argument '${arg}'`);
  }
  return { command: "update", yes, dryRun, json };
}
