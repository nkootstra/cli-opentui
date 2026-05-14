import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app.tsx";
import { parseArgs, type CliCommand } from "./commands/args.ts";
import { runInstallCommand } from "./commands/install.ts";
import { runUpdateCommand } from "./commands/update.ts";
import { runListCommand } from "./commands/list.ts";
import { runRemoveCommand } from "./commands/remove.ts";
import { runLoginCommand } from "./commands/login.ts";
import { runLogoutCommand } from "./commands/logout.ts";
import { runWhoamiCommand } from "./commands/whoami.ts";

export type CliDeps = {
  startTui?: () => Promise<void>;
  runSkillsCommand?: (command: Extract<CliCommand, { command: "skills" }>) => Promise<string>;
  runUpdateCommand?: (command: Extract<CliCommand, { command: "update" }>) => Promise<string>;
  runListCommand?: (command: Extract<CliCommand, { command: "list" }>) => Promise<string>;
  runRemoveCommand?: (command: Extract<CliCommand, { command: "remove" }>) => Promise<string>;
  runLoginCommand?: (command: Extract<CliCommand, { command: "login" }>) => Promise<string>;
  runLogoutCommand?: (command: Extract<CliCommand, { command: "logout" }>) => Promise<string>;
  runWhoamiCommand?: (
    command: Extract<CliCommand, { command: "whoami" }>,
  ) => Promise<{ kind: string; message: string }>;
};

export async function runCli(args: string[], deps: CliDeps = {}): Promise<string | null> {
  const command = parseArgs(args);
  if (command.command === "tui") {
    await (deps.startTui ?? startTui)();
    return null;
  }
  if (command.command === "skills") return (deps.runSkillsCommand ?? runInstallCommand)(command);
  if (command.command === "update") return (deps.runUpdateCommand ?? runUpdateCommand)(command);
  if (command.command === "list") return (deps.runListCommand ?? runListCommand)(command);
  if (command.command === "login") return (deps.runLoginCommand ?? runLoginCommand)(command);
  if (command.command === "logout") return (deps.runLogoutCommand ?? runLogoutCommand)(command);
  if (command.command === "whoami") {
    const doWhoami = deps.runWhoamiCommand ?? runWhoamiCommand;
    const result = await doWhoami(command);
    if (result.kind === "not-authenticated") {
      throw new Error(result.message);
    }
    return result.message;
  }
  return (deps.runRemoveCommand ?? runRemoveCommand)(command);
}

export async function runCliEntry(
  args: string[],
  deps: {
    runCli?: (args: string[]) => Promise<string | null>;
    writeStdout?: (message: string) => void;
    writeStderr?: (message: string) => void;
  } = {},
): Promise<number> {
  try {
    const output = await (deps.runCli ?? runCli)(args);
    if (output) (deps.writeStdout ?? console.log)(output);
    return 0;
  } catch (error) {
    (deps.writeStderr ?? ((message) => process.stderr.write(message)))(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

async function startTui(): Promise<void> {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App />);
}
