import { readSession, type Session } from "@repo/skills/auth";
import type { CliCommand } from "./args.ts";

export const NOT_AUTHENTICATED = "not-authenticated";

export type WhoamiDeps = {
  readSession?: () => Promise<Session | null>;
};

export type WhoamiResult =
  | { kind: "authenticated"; message: string }
  | { kind: "not-authenticated"; message: string };

export async function runWhoamiCommand(
  _command: Extract<CliCommand, { command: "whoami" }>,
  deps: WhoamiDeps = {},
): Promise<WhoamiResult> {
  const getSession = deps.readSession ?? readSession;
  const session = await getSession();

  if (!session) {
    return { kind: "not-authenticated", message: "Not logged in" };
  }

  const expiryDate = new Date(session.expires_at);
  const message = `Logged in as ${session.email}\nToken expires: ${expiryDate.toLocaleString()}`;
  return { kind: "authenticated", message };
}
