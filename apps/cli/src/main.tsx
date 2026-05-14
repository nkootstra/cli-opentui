import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app.tsx";
import { parseArgs, type CliCommand } from "./commands/args.ts";
import { runInstallCommand } from "./commands/install.ts";
import { runUpdateCommand } from "./commands/update.ts";

export type CliDeps = {
  startTui?: () => Promise<void>;
  runSkillsCommand?: (command: Extract<CliCommand, { command: "skills" }>) => Promise<string>;
  runUpdateCommand?: (command: Extract<CliCommand, { command: "update" }>) => Promise<string>;
};

export async function runCli(args: string[], deps: CliDeps = {}): Promise<string | null> {
  const command = parseArgs(args);
  if (command.command === "tui") {
    await (deps.startTui ?? startTui)();
    return null;
  }
  if (command.command === "skills") return (deps.runSkillsCommand ?? runInstallCommand)(command);
  return (deps.runUpdateCommand ?? runUpdateCommand)(command);
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
