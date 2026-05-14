import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export type SourceSpec = {
  host: string;
  owner: string;
  repo: string;
  requestedRef: string | null;
};

export type DiscoveredSkill = {
  name: string;
  description: string | null;
  relativePath: string;
  absolutePath: string;
};

export type InstallPlan = {
  scope: InstallScope;
  claudeHome: string;
  lockfileRoot: string;
  source: SourceSpec;
  operations: InstallOperation[];
};

export type InstallScope = "global" | "local";

export type InstallOperation = {
  skill: DiscoveredSkill;
  destinationName: string;
  destinationPath: string;
  claudeSymlinkPath?: string;
  exists: boolean;
};

export type Lockfile = {
  version: 1;
  skills: Record<string, LockfileEntry>;
};

export type LockfileEntry = {
  sourceHost: string;
  owner: string;
  repo: string;
  requestedRef: string | null;
  resolvedCommit: string | null;
  sourceSkillPath: string;
  displayName: string;
  destinationName: string;
  installedAt: string;
};

export function parseSourceSpec(input: string): SourceSpec {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Expected source in owner/repo or https://host/owner/repo form");

  if (trimmed.includes("://")) {
    const url = new URL(trimmed);
    if (url.protocol !== "https:")
      throw new Error("Only https URLs are supported for skill sources");
    const segments = url.pathname.split("/").filter(Boolean);
    const [owner, repoSegment] = segments;
    if (!owner || !repoSegment)
      throw new Error("Expected source URL path to include owner and repo");
    if (segments.length > 2 && !repoSegment.includes("@"))
      throw new Error(
        "Unsupported source URL path. Use https://host/owner/repo or owner/repo@ref.",
      );
    const repoInput = [repoSegment, ...segments.slice(2)].join("/").replace(/\.git$/, "");
    const { repo, requestedRef } = splitRepoAndRef(repoInput);
    return { host: url.host, owner, repo, requestedRef };
  }

  const firstSlash = trimmed.indexOf("/");
  const owner = firstSlash === -1 ? "" : trimmed.slice(0, firstSlash);
  const repoPart = firstSlash === -1 ? "" : trimmed.slice(firstSlash + 1);
  if (!owner || !repoPart || (repoPart.includes("/") && !repoPart.includes("@"))) {
    throw new Error("Expected source in owner/repo or owner/repo@ref form");
  }
  const { repo, requestedRef } = splitRepoAndRef(repoPart);
  return { host: "github.com", owner, repo, requestedRef };
}

export function buildArchiveUrl(source: SourceSpec): string {
  const base =
    source.host === "github.com"
      ? `https://api.github.com/repos/${source.owner}/${source.repo}/tarball`
      : `https://${source.host}/api/v3/repos/${source.owner}/${source.repo}/tarball`;
  return source.requestedRef ? `${base}/${encodeURIComponent(source.requestedRef)}` : base;
}

export async function fetchGitHubArchive(
  source: SourceSpec,
  options: {
    fetch?: (input: string, init?: RequestInit) => Promise<Response>;
    token?: string;
    tempDir?: string;
  } = {},
): Promise<string> {
  const fetchImpl = options.fetch ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "opencode-skills-installer",
  };
  const token = options.token ?? tokenForHost(source.host);
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(buildArchiveUrl(source), { headers, redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `Unable to download skill source ${source.owner}/${source.repo}: ${response.status} ${response.statusText}`,
    );
  }

  const tempRoot = options.tempDir ?? (await Bun.$`mktemp -d`.text()).trim();
  const archivePath = join(tempRoot, "source.tar.gz");
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  const extractDir = join(tempRoot, "extract");
  await mkdir(extractDir, { recursive: true });
  await Bun.$`tar -xzf ${archivePath} -C ${extractDir}`.quiet();
  const entries = await readdir(extractDir);
  const root = entries.length === 1 ? join(extractDir, entries[0]!) : extractDir;
  await assertSafeTree(root);
  return root;
}

export function sanitizeForTerminal(value: string): string {
  const ansiEscapePattern = new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]`, "g");
  return value
    .replace(ansiEscapePattern, "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && (code < 127 || code > 159);
    })
    .join("")
    .trim();
}

export function resolveClaudeHome(claudeHome = process.env.OPENCODE_CLAUDE_HOME): string {
  return claudeHome ? resolve(claudeHome) : join(homedir(), ".claude");
}

export async function discoverSkills(root: string): Promise<DiscoveredSkill[]> {
  const repoRoot = resolve(root);
  const candidates = await findSkillDirectories(repoRoot);
  const skills = await Promise.all(candidates.map((candidate) => readSkill(repoRoot, candidate)));
  const byName = new Map<string, string>();

  for (const skill of skills) {
    const existingPath = byName.get(skill.name);
    if (existingPath)
      throw new Error(
        `Duplicate skill name '${skill.name}' in ${existingPath} and ${skill.relativePath}`,
      );
    byName.set(skill.name, skill.relativePath);
  }

  return skills.toSorted((a, b) => a.name.localeCompare(b.name));
}

export async function buildInstallPlan(options: {
  claudeHome?: string;
  projectRoot?: string;
  scope?: InstallScope;
  selectedNames: string[];
  source: SourceSpec;
  skills: DiscoveredSkill[];
}): Promise<InstallPlan> {
  const scope = options.scope ?? "global";
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const globalClaudeHome = resolveClaudeHome(options.claudeHome);
  const agentsHome =
    scope === "local" ? join(projectRoot, ".agents") : join(dirname(globalClaudeHome), ".agents");
  const claudeSkillsHome = scope === "local" ? join(projectRoot, ".claude") : globalClaudeHome;
  const claudeHome = agentsHome;
  const lockfileRoot = claudeHome;
  const selected = new Set(options.selectedNames);
  const chosen = options.skills.filter((skill) => selected.has(skill.name));

  for (const name of selected) {
    validateDestinationName(name);
    if (!options.skills.some((skill) => skill.name === name))
      throw new Error(`Skill '${name}' was not found in source`);
  }

  const operations = await Promise.all(
    chosen.map(async (skill) => {
      const destinationPath = join(claudeHome, "skills", skill.name);
      return {
        skill,
        destinationName: skill.name,
        destinationPath,
        claudeSymlinkPath: join(claudeSkillsHome, "skills", skill.name),
        exists: await pathExists(destinationPath),
      };
    }),
  );

  return { scope, claudeHome, lockfileRoot, source: options.source, operations };
}

export async function installSkills(
  plan: InstallPlan,
  options: { force?: boolean; now?: Date; resolvedCommit?: string | null } = {},
): Promise<{ installed: string[] }> {
  const force = options.force ?? false;
  for (const operation of plan.operations) {
    if (operation.exists && !force)
      throw new Error(
        `Skill '${operation.destinationName}' already exists. Use --force to overwrite.`,
      );
  }

  const installedAt = (options.now ?? new Date()).toISOString();
  const lockfile = await readLockfile(plan.claudeHome);

  for (const operation of plan.operations) {
    await replaceDirectory(operation.skill.absolutePath, operation.destinationPath);
    if (operation.claudeSymlinkPath)
      await replaceSymlink(
        "../../.agents/skills/" + operation.destinationName,
        operation.claudeSymlinkPath,
      );
    lockfile.skills[operation.destinationName] = {
      sourceHost: plan.source.host,
      owner: plan.source.owner,
      repo: plan.source.repo,
      requestedRef: plan.source.requestedRef,
      resolvedCommit: options.resolvedCommit ?? null,
      sourceSkillPath: operation.skill.relativePath,
      displayName: operation.skill.name,
      destinationName: operation.destinationName,
      installedAt,
    };
  }

  await writeLockfile(plan.claudeHome, lockfile);
  return { installed: plan.operations.map((operation) => operation.destinationName) };
}

async function replaceSymlink(target: string, linkPath: string): Promise<void> {
  await mkdir(dirname(linkPath), { recursive: true });
  if (await pathExists(linkPath)) {
    const stats = await lstat(linkPath);
    if (!stats.isSymbolicLink())
      throw new Error(
        `Cannot replace non-symlink Claude skill path '${linkPath}'. Use --force after removing it.`,
      );
    await rm(linkPath, { force: true });
  }
  await symlink(target, linkPath);
}

export async function readLockfile(claudeHome = resolveClaudeHome()): Promise<Lockfile> {
  const path = lockfilePath(resolveAgentsHome(claudeHome));
  if (!(await Bun.file(path).exists())) return { version: 1, skills: {} };

  const parsed = JSON.parse(await readFile(path, "utf8")) as Lockfile;
  if (!isLockfile(parsed)) {
    throw new Error(`Unsupported or corrupt skills lockfile at ${path}`);
  }
  return parsed;
}

export async function writeLockfile(claudeHome: string, lockfile: Lockfile): Promise<void> {
  const path = lockfilePath(resolveAgentsHome(claudeHome));
  await mkdir(dirname(path), { recursive: true });
  const sorted: Lockfile = { version: 1, skills: {} };
  for (const key of Object.keys(lockfile.skills).toSorted())
    sorted.skills[key] = lockfile.skills[key]!;
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(sorted, null, 2)}\n`);
  await rename(temp, path);
}

export async function updateSkills(options: {
  claudeHome?: string;
  force?: boolean;
  now?: Date;
  fetchSource: (source: SourceSpec) => Promise<string>;
}): Promise<{ updated: string[]; failed: { destinationName: string; message: string }[] }> {
  const claudeHome = resolveClaudeHome(options.claudeHome);
  const agentsHome = resolveAgentsHome(claudeHome);
  const lockfile = await readLockfile(agentsHome);
  const updated: string[] = [];
  const failed: { destinationName: string; message: string }[] = [];

  for (const entry of Object.values(lockfile.skills)) {
    try {
      const source: SourceSpec = {
        host: entry.sourceHost,
        owner: entry.owner,
        repo: entry.repo,
        requestedRef: entry.requestedRef,
      };
      const root = await options.fetchSource(source);
      const skills = await discoverSkills(root);
      const plan = await buildInstallPlan({
        claudeHome,
        selectedNames: [entry.displayName],
        source,
        skills,
      });
      await installSkills(plan, { force: options.force ?? true, now: options.now });
      updated.push(entry.destinationName);
    } catch (error) {
      failed.push({
        destinationName: entry.destinationName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { updated, failed };
}

function splitRepoAndRef(input: string): { repo: string; requestedRef: string | null } {
  const [repo, ...refParts] = input.split("@");
  if (!repo || repo === "." || repo === "..") throw new Error("Expected repository name in source");
  const requestedRef = refParts.length > 0 ? refParts.join("@") : null;
  if (requestedRef === "") throw new Error("Expected ref after @ in source");
  return { repo, requestedRef };
}

function tokenForHost(host: string): string | undefined {
  if (host !== "github.com") return undefined;
  return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
}

async function assertSafeTree(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const resolved = resolve(path);
    if (!resolved.startsWith(`${resolve(root)}${sep}`) && resolved !== resolve(root)) {
      throw new Error(`Unsafe archive path '${entry.name}'`);
    }
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) await assertSafeTree(path);
  }
}

async function findSkillDirectories(root: string): Promise<string[]> {
  const known = [
    ".",
    "skills",
    ".claude/skills",
    ".agents/skills",
    "curated",
    "experimental",
    "system",
  ];
  const found: string[] = [];

  for (const relativePath of known) {
    const absolutePath = join(root, relativePath);
    if (await Bun.file(join(absolutePath, "SKILL.md")).exists()) found.push(absolutePath);
    for (const child of await safeReadDir(absolutePath)) {
      const childPath = join(absolutePath, child);
      if ((await isDirectory(childPath)) && (await Bun.file(join(childPath, "SKILL.md")).exists()))
        found.push(childPath);
    }
  }

  if (found.length > 0) return unique(found);
  return unique(await recursiveSkillSearch(root, 0, []));
}

async function recursiveSkillSearch(
  current: string,
  depth: number,
  found: string[],
): Promise<string[]> {
  if (found.length >= 50 || depth > 3) return found;
  if (await Bun.file(join(current, "SKILL.md")).exists()) {
    found.push(current);
    return found;
  }

  for (const child of await safeReadDir(current)) {
    if ([".git", "node_modules", "vendor", "dist", "build"].includes(child)) continue;
    if (child.startsWith(".")) continue;
    const childPath = join(current, child);
    if (await isDirectory(childPath)) await recursiveSkillSearch(childPath, depth + 1, found);
  }
  return found;
}

async function readSkill(repoRoot: string, absolutePath: string): Promise<DiscoveredSkill> {
  const skillPath = join(absolutePath, "SKILL.md");
  if (!(await lstat(skillPath)).isFile())
    throw new Error(`SKILL.md must be a regular file: ${skillPath}`);
  const content = await readFile(skillPath, "utf8");
  const metadata = parseFrontmatter(content);
  const fallbackName = basename(absolutePath) || basename(repoRoot);
  const name = sanitizeDestinationName(sanitizeForTerminal(metadata.name ?? fallbackName));

  if (!name) throw new Error(`Invalid skill name in ${absolutePath}`);

  return {
    name,
    description: sanitizeDescription(metadata.description ?? descriptionFromMarkdown(content)),
    relativePath: normalizeRelativePath(relative(repoRoot, absolutePath)),
    absolutePath,
  };
}

function sanitizeDescription(description: string | null | undefined): string | null {
  const sanitized = description ? sanitizeForTerminal(description) : "";
  return sanitized || null;
}

function descriptionFromMarkdown(content: string): string | null {
  const body = stripFrontmatter(content);
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(">")) return trimmed.replace(/^>\s*/, "");
  }

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("<!--")) continue;
    return trimmed;
  }
  return null;
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---", 4);
  return end === -1 ? content : content.slice(end + 4);
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  if (!content.startsWith("---\n")) return {};
  const end = content.indexOf("\n---", 4);
  if (end === -1) return {};
  const frontmatter = content.slice(4, end);
  const metadata: { name?: string; description?: string } = {};
  const lines = frontmatter.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (key === "description" && [">", ">-", ">+", "|", "|-", "|+"].includes(value)) {
      const blockLines: string[] = [];
      while (lines[index + 1]?.startsWith(" ")) blockLines.push(lines[++index]!.trim());
      metadata.description = value.startsWith(">") ? blockLines.join(" ") : blockLines.join("\n");
      continue;
    }
    if (key === "name") metadata.name = value;
    if (key === "description") metadata.description = value;
  }
  return metadata;
}

function sanitizeDestinationName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function validateDestinationName(name: string): void {
  if (!name || name.startsWith(".") || name.includes("/") || name.includes("\\") || name === "..") {
    throw new Error(`Invalid skill destination name '${name}'`);
  }
}

function isLockfile(value: unknown): value is Lockfile {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.skills)) return false;
  return Object.values(value.skills).every(isLockfileEntry);
}

function isLockfileEntry(value: unknown): value is LockfileEntry {
  return (
    isRecord(value) &&
    typeof value.sourceHost === "string" &&
    typeof value.owner === "string" &&
    typeof value.repo === "string" &&
    (typeof value.requestedRef === "string" || value.requestedRef === null) &&
    (typeof value.resolvedCommit === "string" || value.resolvedCommit === null) &&
    typeof value.sourceSkillPath === "string" &&
    typeof value.displayName === "string" &&
    typeof value.destinationName === "string" &&
    typeof value.installedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function replaceDirectory(source: string, destination: string): Promise<void> {
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const temp = join(parent, `.tmp-${basename(destination)}-${process.pid}`);
  const backup = join(parent, `.backup-${basename(destination)}-${process.pid}`);
  await rm(temp, { force: true, recursive: true });
  await rm(backup, { force: true, recursive: true });
  await copySkillDirectory(source, temp);

  try {
    if (await pathExists(destination)) await rename(destination, backup);
    await rename(temp, destination);
    await rm(backup, { force: true, recursive: true });
  } catch (error) {
    await rm(destination, { force: true, recursive: true });
    if (await pathExists(backup)) await rename(backup, destination);
    throw error;
  }
}

async function copySkillDirectory(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    const stats = await lstat(sourcePath);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) await copySkillDirectory(sourcePath, destinationPath);
    else if (stats.isFile()) await cp(sourcePath, destinationPath);
  }
}

function lockfilePath(claudeHome: string): string {
  return join(resolve(claudeHome), "skills-lock.json");
}

function resolveAgentsHome(claudeHome: string): string {
  const resolved = resolve(claudeHome);
  return basename(resolved) === ".claude" ? join(dirname(resolved), ".agents") : resolved;
}

async function safeReadDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

function normalizeRelativePath(path: string): string {
  if (!path || path === "") return ".";
  return path.split(sep).join("/");
}

function unique(paths: string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function extractArchivePlaceholder(): Promise<string> {
  return tmpdir();
}
