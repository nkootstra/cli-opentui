import { describe, expect, it } from "bun:test";
import { runWhoamiCommand } from "./whoami.ts";

const whoamiCommand = { command: "whoami" as const };

describe("runWhoamiCommand", () => {
  it("returns not-authenticated when readSession returns null", async () => {
    const result = await runWhoamiCommand(whoamiCommand, {
      readSession: async () => null,
    });
    expect(result.kind).toBe("not-authenticated");
    expect(result.message).toContain("Not logged in");
  });

  it("returns authenticated with email and expiry when session exists", async () => {
    const expires = Date.now() + 3_600_000;
    const result = await runWhoamiCommand(whoamiCommand, {
      readSession: async () => ({
        access_token: "tok",
        email: "user@example.com",
        expires_at: expires,
      }),
    });
    expect(result.kind).toBe("authenticated");
    expect(result.message).toContain("user@example.com");
    expect(result.message).toContain("Token expires");
  });

  it("returns not-authenticated when session is null (refresh failed)", async () => {
    const result = await runWhoamiCommand(whoamiCommand, {
      readSession: async () => null,
    });
    expect(result.kind).toBe("not-authenticated");
  });
});
