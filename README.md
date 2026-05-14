# cli

A CLI and TUI for discovering, installing, and managing Claude-compatible skills.

## Commands

```
cli                        # Launch the TUI
cli skills <source>        # Install skills from a GitHub repo
cli skills list            # List installed skills
cli skills update          # Update all installed skills
cli skills remove <name>   # Remove an installed skill
cli login                  # Authenticate (OAuth 2.0 + PKCE)
cli logout                 # Remove stored credentials
cli whoami                 # Show the logged-in user
```

The `skills` prefix is optional — `cli list`, `cli update`, `cli remove` are accepted as shorthands.

## Local development — authentication

The mock OAuth server requires Docker.

### Start the mock server

```sh
docker compose -f docker/docker-compose.yml up
```

This starts an `oauth2-mock-server` instance on `http://localhost:8080`.

### Run the login flow against the mock server

Copy the example env file and run:

```sh
cp .env.example .env
bun apps/cli/src/index.tsx login
```

The callback port defaults to `8765`. Override it with `SKILLS_CALLBACK_PORT` if needed.

### Environment variables

| Variable               | Description                                  | Default |
| ---------------------- | -------------------------------------------- | ------- |
| `SKILLS_AUTH_ISSUER`   | OIDC issuer URL (required for auth commands) | —       |
| `SKILLS_CLIENT_ID`     | OAuth client ID (required for auth commands) | —       |
| `SKILLS_CALLBACK_PORT` | Callback server port for the login flow      | `8765`  |

### Notes

- The mock server generates a new RSA signing key on each container restart. Any tokens stored from a previous session become invalid. Re-run `cli login` after restarting the container — this is expected for local development.
- For production (Okta), create a **Native Application** integration and register `http://localhost:8765/callback` (or your custom port) as an allowed redirect URI.
