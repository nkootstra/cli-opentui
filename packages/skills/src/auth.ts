import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as oauth from "oauth4webapi";

export type Credentials = {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // Unix timestamp in ms
  email: string;
};

export type Session = {
  access_token: string;
  email: string;
  expires_at: number;
};

export type AuthConfig = {
  issuer: string;
  clientId: string;
  callbackPort: number;
};

export type AuthDeps = {
  resolveCredentialsPath?: () => string;
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, content: string, mode: number) => Promise<void>;
  deleteFile?: (path: string) => Promise<void>;
  now?: () => number;
  refreshToken?: (
    issuer: string,
    clientId: string,
    refreshToken: string,
  ) => Promise<{ access_token: string; refresh_token?: string; expires_in?: number }>;
};

export function resolveCredentialsPath(): string {
  const base =
    process.platform === "win32"
      ? (process.env["APPDATA"] ?? join(homedir(), ".config"))
      : (process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"));
  return join(base, "cli", "credentials.json");
}

export async function writeCredentials(creds: Credentials, deps: AuthDeps = {}): Promise<void> {
  const path = (deps.resolveCredentialsPath ?? resolveCredentialsPath)();
  const content = JSON.stringify(creds, null, 2);
  if (deps.writeFile) {
    await deps.writeFile(path, content, 0o600);
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { mode: 0o600, encoding: "utf8" });
  }
}

export async function readCredentials(deps: AuthDeps = {}): Promise<Credentials | null> {
  const path = (deps.resolveCredentialsPath ?? resolveCredentialsPath)();
  try {
    const raw = deps.readFile ? await deps.readFile(path) : await readFile(path, "utf8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export async function deleteCredentials(deps: AuthDeps = {}): Promise<void> {
  const path = (deps.resolveCredentialsPath ?? resolveCredentialsPath)();
  try {
    if (deps.deleteFile) {
      await deps.deleteFile(path);
    } else {
      await unlink(path);
    }
  } catch {
    // no-op if file doesn't exist
  }
}

export async function readSession(deps: AuthDeps = {}): Promise<Session | null> {
  const creds = await readCredentials(deps);
  if (!creds) return null;

  const now = (deps.now ?? Date.now)();

  if (creds.expires_at > now) {
    return { access_token: creds.access_token, email: creds.email, expires_at: creds.expires_at };
  }

  if (!creds.refresh_token) return null;

  try {
    const config = resolveAuthConfig();
    const refresher = deps.refreshToken ?? defaultRefreshToken;
    const result = await refresher(config.issuer, config.clientId, creds.refresh_token);
    const expiresIn = result.expires_in ?? 3600;
    const newCreds: Credentials = {
      access_token: result.access_token,
      refresh_token: result.refresh_token ?? creds.refresh_token,
      expires_at: now + expiresIn * 1000,
      email: creds.email,
    };
    await writeCredentials(newCreds, deps);
    return {
      access_token: newCreds.access_token,
      email: newCreds.email,
      expires_at: newCreds.expires_at,
    };
  } catch {
    return null;
  }
}

async function defaultRefreshToken(
  issuer: string,
  clientId: string,
  refreshToken: string,
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const issuerUrl = new URL(issuer);
  const insecure = issuerUrl.protocol === "http:";
  const requestOptions = insecure ? { [oauth.allowInsecureRequests]: true } : undefined;
  const as = await oauth
    .discoveryRequest(issuerUrl, requestOptions)
    .then((r) => oauth.processDiscoveryResponse(issuerUrl, r));
  const client: oauth.Client = { client_id: clientId };
  const response = await oauth.refreshTokenGrantRequest(
    as,
    client,
    oauth.None(),
    refreshToken,
    requestOptions,
  );
  const result = await oauth.processRefreshTokenResponse(as, client, response);
  return {
    access_token: result.access_token,
    refresh_token: typeof result.refresh_token === "string" ? result.refresh_token : undefined,
    expires_in: typeof result.expires_in === "number" ? result.expires_in : undefined,
  };
}

export function resolveAuthConfig(): AuthConfig {
  const issuer = process.env["SKILLS_AUTH_ISSUER"];
  const clientId = process.env["SKILLS_CLIENT_ID"];
  if (!issuer) throw new Error("SKILLS_AUTH_ISSUER environment variable is required");
  if (!clientId) throw new Error("SKILLS_CLIENT_ID environment variable is required");
  const port = process.env["SKILLS_CALLBACK_PORT"];
  return {
    issuer,
    clientId,
    callbackPort: port ? Number(port) : 8765,
  };
}
