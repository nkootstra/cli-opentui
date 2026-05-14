import { describe, expect, it } from "bun:test";
import { runLogoutCommand } from "./logout.ts";

const logoutCommand = { command: "logout" as const };

describe("runLogoutCommand", () => {
  it("calls deleteCredentials and returns confirmation message", async () => {
    let deleted = false;
    const result = await runLogoutCommand(logoutCommand, {
      readCredentials: async () => ({ email: "user@example.com" }),
      deleteCredentials: async () => {
        deleted = true;
      },
    });
    expect(result).toContain("Logged out");
    expect(deleted).toBe(true);
  });

  it("returns not-logged-in message without throwing when no credentials exist", async () => {
    const result = await runLogoutCommand(logoutCommand, {
      readCredentials: async () => null,
      deleteCredentials: async () => {},
    });
    expect(result).toContain("Not logged in");
  });
});
