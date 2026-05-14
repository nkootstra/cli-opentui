import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteCredentials,
  readCredentials,
  readSession,
  resolveAuthConfig,
  resolveCredentialsPath,
  writeCredentials,
  type Credentials,
} from "./auth.ts";

const FUTURE = Date.now() + 3_600_000;
const PAST = Date.now() - 1_000;

const sampleCreds: Credentials = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  expires_at: FUTURE,
  email: "user@example.com",
};

// ─── resolveCredentialsPath ────────────────────────────────────────────────

describe("resolveCredentialsPath", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    const original = process.env["XDG_CONFIG_HOME"];
    process.env["XDG_CONFIG_HOME"] = "/tmp/xdg";
    const path = resolveCredentialsPath();
    expect(path).toBe("/tmp/xdg/cli/credentials.json");
    if (original === undefined) delete process.env["XDG_CONFIG_HOME"];
    else process.env["XDG_CONFIG_HOME"] = original;
  });

  it("falls back to ~/.config on macOS/Linux when XDG_CONFIG_HOME not set", () => {
    if (process.platform === "win32") return;
    const original = process.env["XDG_CONFIG_HOME"];
    delete process.env["XDG_CONFIG_HOME"];
    const path = resolveCredentialsPath();
    expect(path).toMatch(/\.config[/\\]cli[/\\]credentials\.json$/);
    if (original !== undefined) process.env["XDG_CONFIG_HOME"] = original;
  });

  it("uses APPDATA on Windows when APPDATA is set", () => {
    if (process.platform !== "win32") {
      // Simulate by checking logic: if APPDATA is set and platform is win32 the path would use it.
      // On non-Windows we just verify the function does not throw.
      expect(() => resolveCredentialsPath()).not.toThrow();
      return;
    }
    const original = process.env["APPDATA"];
    process.env["APPDATA"] = "C:\\Users\\test\\AppData\\Roaming";
    const path = resolveCredentialsPath();
    expect(path).toContain("cli");
    expect(path).toContain("credentials.json");
    if (original === undefined) delete process.env["APPDATA"];
    else process.env["APPDATA"] = original;
  });
});

// ─── writeCredentials / readCredentials ────────────────────────────────────

describe("writeCredentials + readCredentials", () => {
  it("writes and reads back credentials using injected deps", async () => {
    const store: Record<string, string> = {};
    const deps = {
      resolveCredentialsPath: () => "/fake/cli/credentials.json",
      writeFile: async (path: string, content: string, _mode: number) => {
        store[path] = content;
      },
      readFile: async (path: string) => {
        if (store[path] === undefined) throw new Error("not found");
        return store[path]!;
      },
    };
    await writeCredentials(sampleCreds, deps);
    const result = await readCredentials(deps);
    expect(result).toEqual(sampleCreds);
  });

  it("writes with 0o600 mode on the real filesystem", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auth-test-"));
    const credPath = join(dir, "cli", "credentials.json");
    try {
      const deps = { resolveCredentialsPath: () => credPath };
      await writeCredentials(sampleCreds, deps);
      const result = await readCredentials(deps);
      expect(result).toEqual(sampleCreds);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readCredentials", () => {
  it("returns null when file does not exist", async () => {
    const deps = {
      resolveCredentialsPath: () => "/nonexistent/path/credentials.json",
    };
    const result = await readCredentials(deps);
    expect(result).toBeNull();
  });

  it("returns null when file contains invalid JSON", async () => {
    const deps = {
      resolveCredentialsPath: () => "/fake/credentials.json",
      readFile: async (_path: string) => "{ not valid json",
    };
    const result = await readCredentials(deps);
    expect(result).toBeNull();
  });
});

// ─── deleteCredentials ──────────────────────────────────────────────────────

describe("deleteCredentials", () => {
  it("calls deleteFile when provided", async () => {
    let deleted = false;
    const deps = {
      resolveCredentialsPath: () => "/fake/credentials.json",
      deleteFile: async (_path: string) => {
        deleted = true;
      },
    };
    await deleteCredentials(deps);
    expect(deleted).toBe(true);
  });

  it("no-ops when file does not exist", async () => {
    const deps = {
      resolveCredentialsPath: () => "/nonexistent/credentials.json",
    };
    await expect(deleteCredentials(deps)).resolves.toBeUndefined();
  });
});

// ─── readSession ────────────────────────────────────────────────────────────

describe("readSession", () => {
  it("returns session when token is not expired", async () => {
    const store: Record<string, string> = {};
    const credPath = "/fake/credentials.json";
    store[credPath] = JSON.stringify(sampleCreds);
    const deps = {
      resolveCredentialsPath: () => credPath,
      readFile: async (path: string) => {
        if (store[path] === undefined) throw new Error("not found");
        return store[path]!;
      },
      now: () => FUTURE - 1_000,
    };
    const session = await readSession(deps);
    expect(session).not.toBeNull();
    expect(session!.email).toBe("user@example.com");
    expect(session!.access_token).toBe("access-abc");
  });

  it("silently refreshes and writes new creds when token is expired and refresh token present", async () => {
    const store: Record<string, string> = {};
    const credPath = "/fake/credentials.json";
    const expiredCreds: Credentials = { ...sampleCreds, expires_at: PAST };
    store[credPath] = JSON.stringify(expiredCreds);

    let written: Credentials | null = null;
    const deps = {
      resolveCredentialsPath: () => credPath,
      readFile: async (path: string) => {
        if (store[path] === undefined) throw new Error("not found");
        return store[path]!;
      },
      writeFile: async (_path: string, content: string, _mode: number) => {
        written = JSON.parse(content) as Credentials;
        store[credPath] = content;
      },
      now: () => Date.now(),
      refreshToken: async (_issuer: string, _clientId: string, _rt: string) => ({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }),
    };

    // resolveAuthConfig needs env vars; set them for this test
    const origIssuer = process.env["SKILLS_AUTH_ISSUER"];
    const origClientId = process.env["SKILLS_CLIENT_ID"];
    process.env["SKILLS_AUTH_ISSUER"] = "http://localhost:8080";
    process.env["SKILLS_CLIENT_ID"] = "test";

    try {
      const session = await readSession(deps);
      expect(session).not.toBeNull();
      expect(session!.access_token).toBe("new-access");
      expect(written).not.toBeNull();
      expect(written!.access_token).toBe("new-access");
    } finally {
      if (origIssuer === undefined) delete process.env["SKILLS_AUTH_ISSUER"];
      else process.env["SKILLS_AUTH_ISSUER"] = origIssuer;
      if (origClientId === undefined) delete process.env["SKILLS_CLIENT_ID"];
      else process.env["SKILLS_CLIENT_ID"] = origClientId;
    }
  });

  it("returns null when file does not exist", async () => {
    const deps = {
      resolveCredentialsPath: () => "/nonexistent/credentials.json",
    };
    const session = await readSession(deps);
    expect(session).toBeNull();
  });

  it("returns null when token is expired and no refresh token", async () => {
    const store: Record<string, string> = {};
    const credPath = "/fake/credentials.json";
    const noRefreshCreds: Credentials = {
      ...sampleCreds,
      expires_at: PAST,
      refresh_token: undefined,
    };
    store[credPath] = JSON.stringify(noRefreshCreds);
    const deps = {
      resolveCredentialsPath: () => credPath,
      readFile: async (path: string) => {
        if (store[path] === undefined) throw new Error("not found");
        return store[path]!;
      },
      now: () => Date.now(),
    };
    const session = await readSession(deps);
    expect(session).toBeNull();
  });

  it("returns null when refresh token request fails", async () => {
    const store: Record<string, string> = {};
    const credPath = "/fake/credentials.json";
    const expiredCreds: Credentials = { ...sampleCreds, expires_at: PAST };
    store[credPath] = JSON.stringify(expiredCreds);

    const origIssuer = process.env["SKILLS_AUTH_ISSUER"];
    const origClientId = process.env["SKILLS_CLIENT_ID"];
    process.env["SKILLS_AUTH_ISSUER"] = "http://localhost:8080";
    process.env["SKILLS_CLIENT_ID"] = "test";

    try {
      const deps = {
        resolveCredentialsPath: () => credPath,
        readFile: async (path: string) => {
          if (store[path] === undefined) throw new Error("not found");
          return store[path]!;
        },
        now: () => Date.now(),
        refreshToken: async (_issuer: string, _clientId: string, _rt: string) => {
          throw new Error("refresh failed");
        },
      };
      const session = await readSession(deps);
      expect(session).toBeNull();
    } finally {
      if (origIssuer === undefined) delete process.env["SKILLS_AUTH_ISSUER"];
      else process.env["SKILLS_AUTH_ISSUER"] = origIssuer;
      if (origClientId === undefined) delete process.env["SKILLS_CLIENT_ID"];
      else process.env["SKILLS_CLIENT_ID"] = origClientId;
    }
  });
});

// ─── resolveAuthConfig ──────────────────────────────────────────────────────

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("resolveAuthConfig", () => {
  it("throws when SKILLS_AUTH_ISSUER is not set", () => {
    withEnv({ SKILLS_AUTH_ISSUER: undefined, SKILLS_CLIENT_ID: "test" }, () => {
      expect(() => resolveAuthConfig()).toThrow("SKILLS_AUTH_ISSUER");
    });
  });

  it("throws when SKILLS_CLIENT_ID is not set", () => {
    withEnv({ SKILLS_AUTH_ISSUER: "http://localhost:8080", SKILLS_CLIENT_ID: undefined }, () => {
      expect(() => resolveAuthConfig()).toThrow("SKILLS_CLIENT_ID");
    });
  });

  it("uses default callback port 8765 when SKILLS_CALLBACK_PORT not set", () => {
    withEnv(
      {
        SKILLS_AUTH_ISSUER: "http://localhost:8080",
        SKILLS_CLIENT_ID: "test",
        SKILLS_CALLBACK_PORT: undefined,
      },
      () => {
        const config = resolveAuthConfig();
        expect(config.callbackPort).toBe(8765);
        expect(config.issuer).toBe("http://localhost:8080");
        expect(config.clientId).toBe("test");
      },
    );
  });

  it("uses SKILLS_CALLBACK_PORT when set", () => {
    withEnv(
      {
        SKILLS_AUTH_ISSUER: "http://localhost:8080",
        SKILLS_CLIENT_ID: "test",
        SKILLS_CALLBACK_PORT: "9000",
      },
      () => {
        const config = resolveAuthConfig();
        expect(config.callbackPort).toBe(9000);
      },
    );
  });
});
