# CLI

To install dependencies:

```bash
bun install
```

To run the OpenTUI app:

```bash
bun dev
```

## Claude Code Skill Installs

The CLI can install Claude Code skills from GitHub-compatible repositories. Installs keep canonical copies in `.agents/skills/<skill-name>` and create Claude Code-compatible symlinks in `.claude/skills/<skill-name>`. Project-local installs use the current working directory; global installs use `~/.agents` and `~/.claude`.

Use `OPENCODE_CLAUDE_HOME` when testing global installs locally so they do not touch your real `~/.claude` directory:

```bash
tmp_claude_home=$(mktemp -d)
export OPENCODE_CLAUDE_HOME="$tmp_claude_home"
bun run apps/cli/src/index.tsx skills owner/repo --list
```

Examples:

```bash
# GitHub shorthand, list discovered skills without writing
bun run apps/cli/src/index.tsx skills owner/repo --list

# Interactive install: select skills, choose local/global, confirm
bun run apps/cli/src/index.tsx skills owner/repo

# Machine-readable skill list for scripts or agents
bun run apps/cli/src/index.tsx skills owner/repo --list --json

# Local repository path, useful before pushing a skill repo
bun run apps/cli/src/index.tsx skills ./my-local-skills --list

# Dry-run all discovered skills without writing
bun run apps/cli/src/index.tsx skills owner/repo --all --local --dry-run

# Machine-readable install plan
bun run apps/cli/src/index.tsx skills owner/repo --all --local --dry-run --json

# Pinned branch or tag
bun run apps/cli/src/index.tsx skills owner/repo@develop --all --dry-run

# One named skill, skip confirmation prompt
bun run apps/cli/src/index.tsx skills owner/repo pdf --local --yes

# Multiple named skills
bun run apps/cli/src/index.tsx skills owner/repo --skill foo --skill bar --local --dry-run

# Multiple named skills with short aliases
bun run apps/cli/src/index.tsx skills owner/repo -s foo -s bar --local --dry-run

# Global install to ~/.agents with symlinks from ~/.claude
bun run apps/cli/src/index.tsx skills owner/repo pdf --global --yes

# Global install with short aliases
bun run apps/cli/src/index.tsx skills owner/repo pdf -g -y

# GitHub Enterprise Server URL
bun run apps/cli/src/index.tsx skills https://github.example.com/org/repo --list

# Update skills recorded in the redirected skills lockfile
bun run apps/cli/src/index.tsx skills update --yes

# Preview lockfile-backed updates
bun run apps/cli/src/index.tsx skills update --dry-run --json
```

Interactive prompts use arrow-key selection. Skill selection uses checkboxes; install location uses a local/global choice list.

`--list`/`-l` prints discovered skills and exits. `--skill`/`-s` selects named skills. `--all` selects every discovered skill. `--local` installs to `./.agents/skills` and symlinks `./.claude/skills`. `--global`/`-g` installs to `~/.agents/skills` and symlinks `~/.claude/skills`. `--json` emits machine-readable output. `--force` allows overwriting an existing destination; `--force --yes`/`-y` overwrites without prompting. Without `--force`, existing skill directories fail before writes happen. `--dry-run` prints the planned install/update without writing files.
