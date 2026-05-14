import * as oauth from "oauth4webapi";
import {
  resolveAuthConfig,
  readSession,
  writeCredentials,
  type AuthConfig,
  type Credentials,
  type Session,
} from "@repo/skills/auth";
import type { CliCommand } from "./args.ts";

export type LoginDeps = {
  resolveAuthConfig?: () => AuthConfig;
  readSession?: () => Promise<Session | null>;
  discoverAuthorizationServer?: (issuer: string) => Promise<oauth.AuthorizationServer>;
  openBrowser?: (url: string) => Promise<void>;
  startCallbackServer?: (port: number) => Promise<{ code: string; state: string }>;
  exchangeCode?: (params: {
    authorizationServer: oauth.AuthorizationServer;
    client: oauth.Client;
    codeVerifier: string;
    code: string;
    state: string;
    redirectUri: string;
  }) => Promise<oauth.TokenEndpointResponse>;
  fetchUserinfo?: (
    authorizationServer: oauth.AuthorizationServer,
    client: oauth.Client,
    accessToken: string,
  ) => Promise<oauth.UserInfoResponse>;
  writeCredentials?: (creds: Credentials) => Promise<void>;
};

export async function runLoginCommand(
  _command: Extract<CliCommand, { command: "login" }>,
  deps: LoginDeps = {},
): Promise<string> {
  const getConfig = deps.resolveAuthConfig ?? resolveAuthConfig;
  const getSession = deps.readSession ?? readSession;
  const doWrite = deps.writeCredentials ?? writeCredentials;

  let config: AuthConfig;
  try {
    config = getConfig();
  } catch (err) {
    return `Login failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  const existing = await getSession();
  if (existing) {
    return `Already logged in as ${existing.email}`;
  }

  const doDiscover = deps.discoverAuthorizationServer ?? defaultDiscover;
  const as = await doDiscover(config.issuer);

  const client: oauth.Client = { client_id: config.clientId };
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const state = oauth.generateRandomState();
  const redirectUri = `http://localhost:${config.callbackPort}/callback`;

  if (!as.authorization_endpoint) {
    return "Login failed: authorization_endpoint not found in OIDC discovery document";
  }

  const authUrl = new URL(as.authorization_endpoint);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  const doOpen = deps.openBrowser ?? defaultOpenBrowser;
  const doListen = deps.startCallbackServer ?? defaultCallbackServer;
  const doExchange = deps.exchangeCode ?? defaultExchangeCode;
  const doFetchUserinfo = deps.fetchUserinfo ?? defaultFetchUserinfo;

  // Start callback server BEFORE opening the browser so it's ready when the
  // authorization server redirects back.
  const callbackPromise = doListen(config.callbackPort).catch((err: unknown) => {
    throw new Error(`callback server error — ${err instanceof Error ? err.message : String(err)}`);
  });

  await doOpen(authUrl.toString());
  console.log(`Opening browser to:\n  ${authUrl.toString()}\n\nWaiting for callback...`);

  let callbackResult: { code: string; state: string };
  try {
    callbackResult = await callbackPromise;
  } catch (err) {
    return `Login failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Validate state
  if (callbackResult.state !== state) {
    return "Login failed: state mismatch (possible CSRF)";
  }

  let tokenResponse: oauth.TokenEndpointResponse;
  try {
    tokenResponse = await doExchange({
      authorizationServer: as,
      client,
      codeVerifier,
      code: callbackResult.code,
      state: callbackResult.state,
      redirectUri,
    });
  } catch (err) {
    return `Login failed: token exchange error — ${err instanceof Error ? err.message : String(err)}`;
  }

  let userInfo: oauth.UserInfoResponse;
  try {
    userInfo = await doFetchUserinfo(as, client, tokenResponse.access_token);
  } catch (err) {
    return `Login failed: userinfo error — ${err instanceof Error ? err.message : String(err)}`;
  }

  const email = userInfo.email;
  if (typeof email !== "string" || !email) {
    return "Login failed: no email claim in userinfo response";
  }

  const expiresIn = typeof tokenResponse.expires_in === "number" ? tokenResponse.expires_in : 3600;
  const creds: Credentials = {
    access_token: tokenResponse.access_token,
    refresh_token:
      typeof tokenResponse.refresh_token === "string" ? tokenResponse.refresh_token : undefined,
    expires_at: Date.now() + expiresIn * 1000,
    email,
  };

  await doWrite(creds);
  return `Logged in as ${email}`;
}

async function defaultOpenBrowser(url: string): Promise<void> {
  const { default: open } = await import("open");
  await open(url);
}

async function defaultCallbackServer(port: number): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/callback") {
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          if (!code || !state) {
            reject(new Error("Missing code or state in callback"));
            server.stop(true);
            return new Response("Missing code or state", { status: 400 });
          }
          resolve({ code, state });
          // Delay stop so the response is fully flushed to the browser
          setTimeout(() => server.stop(), 500);
          return new Response(
            "<html><body>Login successful. You may close this tab.</body></html>",
            {
              headers: { "Content-Type": "text/html" },
            },
          );
        }
        return new Response("Not found", { status: 404 });
      },
      error(err) {
        reject(err);
      },
    });
  });
}

async function defaultDiscover(issuer: string): Promise<oauth.AuthorizationServer> {
  const issuerUrl = new URL(issuer);
  const insecure = issuerUrl.protocol === "http:";
  const options = insecure ? { [oauth.allowInsecureRequests]: true } : undefined;
  return oauth
    .discoveryRequest(issuerUrl, options)
    .then((r) => oauth.processDiscoveryResponse(issuerUrl, r));
}

async function defaultExchangeCode(params: {
  authorizationServer: oauth.AuthorizationServer;
  client: oauth.Client;
  codeVerifier: string;
  code: string;
  state: string;
  redirectUri: string;
}): Promise<oauth.TokenEndpointResponse> {
  const { authorizationServer, client, codeVerifier, code, state, redirectUri } = params;
  const insecure = authorizationServer.issuer.startsWith("http:");
  const options = insecure ? { [oauth.allowInsecureRequests]: true } : undefined;
  const currentUrl = new URL(`${redirectUri}?code=${code}&state=${state}`);
  // validateAuthResponse throws on OAuth2 errors in v3; returns URLSearchParams on success
  const parameters = oauth.validateAuthResponse(authorizationServer, client, currentUrl, state);
  const response = await oauth.authorizationCodeGrantRequest(
    authorizationServer,
    client,
    oauth.None(),
    parameters,
    redirectUri,
    codeVerifier,
    options,
  );
  return oauth.processAuthorizationCodeResponse(authorizationServer, client, response);
}

async function defaultFetchUserinfo(
  authorizationServer: oauth.AuthorizationServer,
  client: oauth.Client,
  accessToken: string,
): Promise<oauth.UserInfoResponse> {
  const insecure = authorizationServer.issuer.startsWith("http:");
  const options = insecure ? { [oauth.allowInsecureRequests]: true } : undefined;
  const response = await oauth.userInfoRequest(authorizationServer, client, accessToken, options);
  return oauth.processUserInfoResponse(
    authorizationServer,
    client,
    oauth.skipSubjectCheck,
    response,
  );
}
