import { deleteCredentials, readCredentials } from "@repo/skills/auth";
import type { CliCommand } from "./args.ts";

export type LogoutDeps = {
  deleteCredentials?: () => Promise<void>;
  readCredentials?: () => Promise<unknown>;
};

export async function runLogoutCommand(
  _command: Extract<CliCommand, { command: "logout" }>,
  deps: LogoutDeps = {},
): Promise<string> {
  const doRead = deps.readCredentials ?? readCredentials;
  const doDelete = deps.deleteCredentials ?? deleteCredentials;

  const existing = await doRead();
  if (!existing) {
    return "Not logged in";
  }

  await doDelete();
  return "Logged out";
}
