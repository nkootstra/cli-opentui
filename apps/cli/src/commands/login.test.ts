import { describe, expect, it } from "bun:test";
import { runLoginCommand } from "./login.ts";
import type { LoginDeps } from "./login.ts";
import type * as oauth from "oauth4webapi";

const fakeAs: oauth.AuthorizationServer = {
  issuer: "http://localhost:8080",
  authorization_endpoint: "http://localhost:8080/authorize",
  token_endpoint: "http://localhost:8080/token",
  userinfo_endpoint: "http://localhost:8080/userinfo",
};

const fakeTokenResponse: oauth.TokenEndpointResponse = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  token_type: "bearer",
  expires_in: 3600,
};

function makeDeps(overrides: Partial<LoginDeps> = {}): LoginDeps {
  return {
    resolveAuthConfig: () => ({
      issuer: "http://localhost:8080",
      clientId: "test",
      callbackPort: 8765,
    }),
    readSession: async () => null,
    discoverAuthorizationServer: async (_issuer: string) => fakeAs,
    openBrowser: async (_url: string) => {},
    startCallbackServer: async (_port: number) => ({ code: "auth-code", state: "valid-state" }),
    exchangeCode: async (_params) => fakeTokenResponse,
    fetchUserinfo: async (_as, _client, _token) => ({
      sub: "user-123",
      email: "user@example.com",
    }),
    writeCredentials: async (_creds) => {},
    ...overrides,
  };
}

const loginCommand = { command: "login" as const };

describe("runLoginCommand", () => {
  it("happy path: calls openBrowser, exchanges code, writes credentials, returns success message", async () => {
    let opened = "";
    let written: unknown = null;

    // startCallbackServer is called before openBrowser in the real flow.
    // We use a deferred so the server only resolves after openBrowser fires.
    let resolveCallback!: (value: { code: string; state: string }) => void;
    const callbackReady = new Promise<{ code: string; state: string }>((res) => {
      resolveCallback = res;
    });

    const deps = makeDeps({
      openBrowser: async (url: string) => {
        opened = url;
        const state = new URL(url).searchParams.get("state") ?? "";
        resolveCallback({ code: "auth-code", state });
      },
      startCallbackServer: async (_port: number) => callbackReady,
      writeCredentials: async (creds) => {
        written = creds;
      },
    });

    const result = await runLoginCommand(loginCommand, deps);
    expect(result).toBe("Logged in as user@example.com");
    expect(opened).toContain("http://localhost:8080/authorize");
    expect(written).not.toBeNull();
    expect((written as { email: string }).email).toBe("user@example.com");
    expect((written as { access_token: string }).access_token).toBe("access-abc");
  });

  it("returns already-logged-in message without opening browser when session exists", async () => {
    let opened = false;
    const deps = makeDeps({
      readSession: async () => ({
        access_token: "existing",
        email: "already@example.com",
        expires_at: Date.now() + 3_600_000,
      }),
      openBrowser: async () => {
        opened = true;
      },
    });
    const result = await runLoginCommand(loginCommand, deps);
    expect(result).toContain("Already logged in");
    expect(result).toContain("already@example.com");
    expect(opened).toBe(false);
  });

  it("returns error message when exchangeCode throws", async () => {
    let resolveCallback!: (value: { code: string; state: string }) => void;
    const callbackReady = new Promise<{ code: string; state: string }>((res) => {
      resolveCallback = res;
    });
    const deps = makeDeps({
      openBrowser: async (url: string) => {
        const state = new URL(url).searchParams.get("state") ?? "";
        resolveCallback({ code: "code", state });
      },
      startCallbackServer: async () => callbackReady,
      exchangeCode: async () => {
        throw new Error("token exchange failed");
      },
    });
    const result = await runLoginCommand(loginCommand, deps);
    expect(result).toContain("Login failed");
    expect(result).toContain("token exchange failed");
  });

  it("returns error message when fetchUserinfo returns no email", async () => {
    let resolveCallback!: (value: { code: string; state: string }) => void;
    const callbackReady = new Promise<{ code: string; state: string }>((res) => {
      resolveCallback = res;
    });
    const deps = makeDeps({
      openBrowser: async (url: string) => {
        const state = new URL(url).searchParams.get("state") ?? "";
        resolveCallback({ code: "code", state });
      },
      startCallbackServer: async () => callbackReady,
      fetchUserinfo: async () => ({ sub: "user-123" }), // no email
    });
    const result = await runLoginCommand(loginCommand, deps);
    expect(result).toContain("no email claim");
  });

  it("returns config error when resolveAuthConfig throws", async () => {
    const deps = makeDeps({
      resolveAuthConfig: () => {
        throw new Error("SKILLS_AUTH_ISSUER environment variable is required");
      },
    });
    const result = await runLoginCommand(loginCommand, deps);
    expect(result).toContain("SKILLS_AUTH_ISSUER");
  });
});
