import { lstat, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildArchiveUrl,
  buildInstallPlan,
  fetchGitHubArchive,
  discoverSkills,
  installSkills,
  listInstalledSkills,
  parseSourceSpec,
  readLockfile,
  removeSkill,
  sanitizeForTerminal,
  updateSkills,
} from "./index.ts";

async function makeSkill(
  root: string,
  relativePath: string,
  body = "---\nname: demo\ndescription: Demo skill\n---\n",
) {
  const dir = join(root, relativePath);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), body);
  await writeFile(join(dir, "support.txt"), "support");
  return dir;
}

describe("source specs", () => {
  test("parses github shorthand without a ref", () => {
    expect(parseSourceSpec("owner/repo")).toEqual({
      host: "github.com",
      owner: "owner",
      repo: "repo",
      requestedRef: null,
    });
  });

  test("parses github shorthand with an explicit ref", () => {
    expect(parseSourceSpec("owner/repo@feature/test")).toEqual({
      host: "github.com",
      owner: "owner",
      repo: "repo",
      requestedRef: "feature/test",
    });
  });

  test("parses full GitHub-compatible URLs and removes .git", () => {
    expect(parseSourceSpec("https://github.example.com/org/repo.git")).toEqual({
      host: "github.example.com",
      owner: "org",
      repo: "repo",
      requestedRef: null,
    });
  });

  test("rejects malformed and unsupported sources", () => {
    expect(() => parseSourceSpec("owner")).toThrow("Expected source");
    expect(() => parseSourceSpec("ssh://github.com/org/repo")).toThrow("Only https URLs");
    expect(() => parseSourceSpec("https://github.com/org/repo/tree/main")).toThrow(
      "Unsupported source URL path",
    );
  });
});

describe("github archive URLs", () => {
  test("builds public github tarball URLs", () => {
    expect(buildArchiveUrl(parseSourceSpec("owner/repo"))).toBe(
      "https://api.github.com/repos/owner/repo/tarball",
    );
  });

  test("builds GHE tarball URLs with encoded refs", () => {
    expect(
      buildArchiveUrl(parseSourceSpec("https://github.example.com/org/repo@feature/test")),
    ).toBe("https://github.example.com/api/v3/repos/org/repo/tarball/feature%2Ftest");
  });

  test("fetches archives with GitHub headers and surfaces HTTP failures", async () => {
    const requests: { url: string; headers: RequestInit["headers"] }[] = [];
    await expect(
      fetchGitHubArchive(parseSourceSpec("owner/repo@main"), {
        fetch: async (url, init) => {
          requests.push({ url: String(url), headers: init?.headers });
          return new Response("missing", { status: 404, statusText: "Not Found" });
        },
      }),
    ).rejects.toThrow("Unable to download skill source");

    expect(requests[0]?.url).toBe("https://api.github.com/repos/owner/repo/tarball/main");
    expect(requests[0]?.headers).toMatchObject({ Accept: "application/vnd.github+json" });
  });
});

describe("skill discovery", () => {
  test("discovers root skills and sanitizes metadata", async () => {
    const root = await Bun.fileURLToPath(new URL(`file://${await Bun.$`mktemp -d`.text()}`.trim()));
    await makeSkill(root, ".", "---\nname: bad\u001b[31m\ndescription: Demo\u0000 skill\n---\n");

    const skills = await discoverSkills(root);

    expect(skills).toMatchObject([{ name: "bad", description: "Demo skill", relativePath: "." }]);
  });

  test("discovers conventional multi-skill layouts", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    await makeSkill(root, "skills/foo", "---\nname: foo\ndescription: Foo\n---\n");
    await makeSkill(root, ".claude/skills/bar", "---\nname: bar\ndescription: Bar\n---\n");

    const skills = await discoverSkills(root);

    expect(skills.map((skill) => skill.name).toSorted()).toEqual(["bar", "foo"]);
  });

  test("reads folded frontmatter descriptions", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    await makeSkill(
      root,
      "skills/create-skill",
      "---\nname: create-skill\ndescription: >-\n  Helps create and refine skills for agents.\n  Use when turning repeatable workflows into reusable instructions.\n---\n",
    );

    const skills = await discoverSkills(root);

    expect(skills).toMatchObject([
      {
        name: "create-skill",
        description:
          "Helps create and refine skills for agents. Use when turning repeatable workflows into reusable instructions.",
      },
    ]);
  });

  test("falls back to markdown blockquote descriptions", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    await makeSkill(
      root,
      "skills/blockquote",
      "---\nname: blockquote\n---\n# Blockquote\n\n> Use when a skill describes itself with a tagline blockquote.\n\nMore details follow.\n",
    );

    const skills = await discoverSkills(root);

    expect(skills).toMatchObject([
      {
        name: "blockquote",
        description: "Use when a skill describes itself with a tagline blockquote.",
      },
    ]);
  });

  test("falls back to bounded recursive discovery", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    await makeSkill(
      root,
      "nested/deeper/fallback",
      "---\nname: fallback\ndescription: Fallback\n---\n",
    );

    const skills = await discoverSkills(root);

    expect(skills.map((skill) => skill.name)).toEqual(["fallback"]);
  });

  test("reports duplicate destination names as ambiguous", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    await makeSkill(root, "skills/a", "---\nname: same\ndescription: A\n---\n");
    await makeSkill(root, "skills/b", "---\nname: same\ndescription: B\n---\n");

    await expect(discoverSkills(root)).rejects.toThrow("Duplicate skill name");
  });

  test("rejects symlinked SKILL.md files during discovery", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    await mkdir(join(root, "skills", "bad"), { recursive: true });
    await symlink("/etc/passwd", join(root, "skills", "bad", "SKILL.md"));

    await expect(discoverSkills(root)).rejects.toThrow("SKILL.md must be a regular file");
  });
});

describe("install planning and writes", () => {
  test("builds a named install plan without writing files", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    const claudeHome = join(root, "claude");
    await makeSkill(root, "repo/skills/foo", "---\nname: foo\ndescription: Foo\n---\n");
    await makeSkill(root, "repo/skills/bar", "---\nname: bar\ndescription: Bar\n---\n");
    const skills = await discoverSkills(join(root, "repo"));

    const plan = await buildInstallPlan({
      claudeHome,
      selectedNames: ["foo"],
      source: parseSourceSpec("owner/repo@v1"),
      skills,
    });

    expect(plan.operations.map((operation) => operation.destinationName)).toEqual(["foo"]);
    expect(await Bun.file(join(claudeHome, "skills", "foo", "SKILL.md")).exists()).toBe(false);
  });

  test("builds local install plans under .agents with Claude symlink destinations", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    const projectRoot = join(root, "project");
    const repoRoot = join(root, "repo");
    await makeSkill(repoRoot, "skills/foo", "---\nname: foo\ndescription: Foo\n---\n");

    const plan = await buildInstallPlan({
      projectRoot,
      scope: "local",
      selectedNames: ["foo"],
      source: parseSourceSpec("owner/repo"),
      skills: await discoverSkills(repoRoot),
    });

    expect(plan.scope).toBe("local");
    expect(plan.lockfileRoot).toBe(join(projectRoot, ".agents"));
    expect(plan.operations[0]?.destinationPath).toBe(join(projectRoot, ".agents", "skills", "foo"));
    expect(plan.operations[0]?.claudeSymlinkPath).toBe(
      join(projectRoot, ".claude", "skills", "foo"),
    );
  });

  test("builds global install plans under global .agents with Claude symlink destinations", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    const globalRoot = join(root, "global");
    const repoRoot = join(root, "repo");
    await makeSkill(repoRoot, "skills/foo", "---\nname: foo\ndescription: Foo\n---\n");

    const plan = await buildInstallPlan({
      claudeHome: join(globalRoot, ".claude"),
      selectedNames: ["foo"],
      source: parseSourceSpec("owner/repo"),
      skills: await discoverSkills(repoRoot),
    });

    expect(plan.scope).toBe("global");
    expect(plan.claudeHome).toBe(join(globalRoot, ".agents"));
    expect(plan.lockfileRoot).toBe(join(globalRoot, ".agents"));
    expect(plan.operations[0]?.destinationPath).toBe(join(globalRoot, ".agents", "skills", "foo"));
    expect(plan.operations[0]?.claudeSymlinkPath).toBe(
      join(globalRoot, ".claude", "skills", "foo"),
    );
  });

  test("installs selected skills and writes deterministic lockfile entries", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    const repoRoot = join(root, "repo");
    const globalRoot = join(root, "global");
    const claudeHome = join(globalRoot, ".claude");
    const agentsHome = join(globalRoot, ".agents");
    await makeSkill(repoRoot, "skills/foo", "---\nname: foo\ndescription: Foo\n---\n");

    const plan = await buildInstallPlan({
      claudeHome,
      selectedNames: ["foo"],
      source: parseSourceSpec("owner/repo"),
      skills: await discoverSkills(repoRoot),
    });

    await installSkills(plan, { force: false, now: new Date("2026-05-13T00:00:00.000Z") });

    expect(await readFile(join(agentsHome, "skills", "foo", "support.txt"), "utf8")).toBe(
      "support",
    );
    expect((await lstat(join(claudeHome, "skills", "foo"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(claudeHome, "skills", "foo"))).toBe("../../.agents/skills/foo");
    expect(await readLockfile(agentsHome)).toEqual({
      version: 1,
      skills: {
        foo: {
          sourceHost: "github.com",
          owner: "owner",
          repo: "repo",
          requestedRef: null,
          resolvedCommit: null,
          sourceSkillPath: "skills/foo",
          displayName: "foo",
          destinationName: "foo",
          installedAt: "2026-05-13T00:00:00.000Z",
        },
      },
    });
  });

  test("installs local skills to .agents and symlinks .claude skills", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    const projectRoot = join(root, "project");
    const repoRoot = join(root, "repo");
    await makeSkill(repoRoot, "skills/foo", "---\nname: foo\ndescription: Foo\n---\n");

    const plan = await buildInstallPlan({
      projectRoot,
      scope: "local",
      selectedNames: ["foo"],
      source: parseSourceSpec("owner/repo"),
      skills: await discoverSkills(repoRoot),
    });

    await installSkills(plan, { force: false, now: new Date("2026-05-13T00:00:00.000Z") });

    const canonicalPath = join(projectRoot, ".agents", "skills", "foo", "SKILL.md");
    const symlinkPath = join(projectRoot, ".claude", "skills", "foo");
    expect(await Bun.file(canonicalPath).exists()).toBe(true);
    expect((await lstat(symlinkPath)).isSymbolicLink()).toBe(true);
    expect(await readlink(symlinkPath)).toBe("../../.agents/skills/foo");
    expect(await readLockfile(join(projectRoot, ".agents"))).toMatchObject({
      skills: { foo: { destinationName: "foo" } },
    });
  });

  test("refuses existing destinations unless forced", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    const repoRoot = join(root, "repo");
    const globalRoot = join(root, "global");
    const claudeHome = join(globalRoot, ".claude");
    const agentsHome = join(globalRoot, ".agents");
    await makeSkill(repoRoot, "skills/foo", "---\nname: foo\ndescription: Foo\n---\n");
    await makeSkill(agentsHome, "skills/foo", "---\nname: old\ndescription: Old\n---\n");

    const plan = await buildInstallPlan({
      claudeHome,
      selectedNames: ["foo"],
      source: parseSourceSpec("owner/repo"),
      skills: await discoverSkills(repoRoot),
    });

    await expect(installSkills(plan, { force: false })).rejects.toThrow("already exists");
  });

  test("rejects missing and unsafe selected skill names while planning", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    const repoRoot = join(root, "repo");
    await makeSkill(repoRoot, "skills/foo", "---\nname: foo\ndescription: Foo\n---\n");
    const skills = await discoverSkills(repoRoot);

    await expect(
      buildInstallPlan({
        selectedNames: ["missing"],
        source: parseSourceSpec("owner/repo"),
        skills,
      }),
    ).rejects.toThrow("Skill 'missing' was not found");
    await expect(
      buildInstallPlan({
        selectedNames: ["../bad"],
        source: parseSourceSpec("owner/repo"),
        skills,
      }),
    ).rejects.toThrow("Invalid skill destination name");
  });

  test("does not copy symlinks into skill destinations", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    const repoRoot = join(root, "repo");
    const globalRoot = join(root, "global");
    const claudeHome = join(globalRoot, ".claude");
    const agentsHome = join(globalRoot, ".agents");
    const skillDir = await makeSkill(
      repoRoot,
      "skills/foo",
      "---\nname: foo\ndescription: Foo\n---\n",
    );
    await symlink("/tmp/unsafe", join(skillDir, "link"));

    const plan = await buildInstallPlan({
      claudeHome,
      selectedNames: ["foo"],
      source: parseSourceSpec("owner/repo"),
      skills: await discoverSkills(repoRoot),
    });
    await installSkills(plan, { force: false });

    expect(await Bun.file(join(agentsHome, "skills", "foo", "link")).exists()).toBe(false);
  });
});

describe("updates", () => {
  test("updates lockfile-backed skills through an injected fetcher", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    const globalRoot = join(root, "global");
    const claudeHome = join(globalRoot, ".claude");
    const agentsHome = join(globalRoot, ".agents");
    const repoRoot = join(root, "repo");
    await makeSkill(repoRoot, "skills/foo", "---\nname: foo\ndescription: Foo\n---\nnew");
    await mkdir(agentsHome, { recursive: true });
    await writeFile(
      join(agentsHome, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          foo: {
            sourceHost: "github.com",
            owner: "owner",
            repo: "repo",
            requestedRef: "v1",
            resolvedCommit: null,
            sourceSkillPath: "skills/foo",
            displayName: "foo",
            destinationName: "foo",
            installedAt: "2026-05-12T00:00:00.000Z",
          },
        },
      }),
    );

    const result = await updateSkills({
      claudeHome,
      force: true,
      fetchSource: async () => repoRoot,
      now: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(result.updated).toEqual(["foo"]);
    expect(await readFile(join(agentsHome, "skills", "foo", "SKILL.md"), "utf8")).toContain("new");
    expect((await lstat(join(claudeHome, "skills", "foo"))).isSymbolicLink()).toBe(true);
  });

  test("continues updating after per-entry failures", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    const globalRoot = join(root, "global");
    const claudeHome = join(globalRoot, ".claude");
    const agentsHome = join(globalRoot, ".agents");
    const repoRoot = join(root, "repo");
    await makeSkill(repoRoot, "skills/foo", "---\nname: foo\ndescription: Foo\n---\n");
    await mkdir(agentsHome, { recursive: true });
    await writeFile(
      join(agentsHome, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          foo: {
            sourceHost: "github.com",
            owner: "owner",
            repo: "repo",
            requestedRef: null,
            resolvedCommit: null,
            sourceSkillPath: "skills/foo",
            displayName: "foo",
            destinationName: "foo",
            installedAt: "2026-05-12T00:00:00.000Z",
          },
          missing: {
            sourceHost: "github.com",
            owner: "owner",
            repo: "repo",
            requestedRef: null,
            resolvedCommit: null,
            sourceSkillPath: "skills/missing",
            displayName: "missing",
            destinationName: "missing",
            installedAt: "2026-05-12T00:00:00.000Z",
          },
        },
      }),
    );

    const result = await updateSkills({
      claudeHome,
      fetchSource: async () => repoRoot,
    });

    expect(result.updated).toEqual(["foo"]);
    expect(result.failed).toMatchObject([{ destinationName: "missing" }]);
  });

  test("rejects corrupt lockfile entry shapes", async () => {
    const root = (await Bun.$`mktemp -d`.text()).trim();
    const agentsHome = join(root, "agents");
    await mkdir(agentsHome, { recursive: true });
    await writeFile(
      join(agentsHome, "skills-lock.json"),
      JSON.stringify({ version: 1, skills: { bad: { owner: 1 } } }),
    );

    await expect(readLockfile(agentsHome)).rejects.toThrow(
      "Unsupported or corrupt skills lockfile",
    );
  });
});

describe("terminal sanitization", () => {
  test("strips unsafe terminal control characters", () => {
    expect(sanitizeForTerminal("hello\u001b[31m\u0000 world")).toBe("hello world");
  });
});

describe("listInstalledSkills", () => {
  test("returns empty list when no lockfile present", async () => {
    const tmp = await Bun.$`mktemp -d`.text().then((s) => s.trim());
    const agentsHome = join(tmp, ".agents");
    await mkdir(agentsHome, { recursive: true });
    const skills = await listInstalledSkills({ claudeHome: agentsHome, scope: "global" });
    expect(skills).toEqual([]);
  });

  test("returns global skills from lockfile", async () => {
    const tmp = await Bun.$`mktemp -d`.text().then((s) => s.trim());
    const agentsHome = join(tmp, ".agents");
    await mkdir(agentsHome, { recursive: true });
    await writeFile(
      join(agentsHome, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          foo: {
            sourceHost: "github.com",
            owner: "owner",
            repo: "repo",
            requestedRef: null,
            resolvedCommit: null,
            sourceSkillPath: "skills/foo",
            displayName: "foo",
            destinationName: "foo",
            installedAt: "2026-05-13T00:00:00.000Z",
          },
        },
      }),
    );

    const skills = await listInstalledSkills({ claudeHome: agentsHome, scope: "global" });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.destinationName).toBe("foo");
    expect(skills[0]?.scope).toBe("global");
    expect(skills[0]?.source).toBe("github.com/owner/repo");
  });
});

describe("removeSkill", () => {
  test("removes skill directory, symlink, and lockfile entry", async () => {
    const tmp = await Bun.$`mktemp -d`.text().then((s) => s.trim());
    const agentsHome = join(tmp, ".agents");
    const claudeHome = join(tmp, ".claude");
    await mkdir(join(agentsHome, "skills", "foo"), { recursive: true });
    await writeFile(join(agentsHome, "skills", "foo", "SKILL.md"), "# foo");
    await mkdir(join(claudeHome, "skills"), { recursive: true });
    await symlink("../../.agents/skills/foo", join(claudeHome, "skills", "foo"));
    await writeFile(
      join(agentsHome, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          foo: {
            sourceHost: "github.com",
            owner: "owner",
            repo: "repo",
            requestedRef: null,
            resolvedCommit: null,
            sourceSkillPath: "skills/foo",
            displayName: "foo",
            destinationName: "foo",
            installedAt: "2026-05-13T00:00:00.000Z",
          },
        },
      }),
    );

    const result = await removeSkill("foo", {
      claudeHome,
      scope: "global",
      projectRoot: tmp,
    });

    expect(result.removed).toBe("foo");

    const lockfile = await readLockfile(agentsHome);
    expect(Object.keys(lockfile.skills)).not.toContain("foo");

    let skillDirExists = false;
    try {
      await lstat(join(agentsHome, "skills", "foo"));
      skillDirExists = true;
    } catch {
      // expected
    }
    expect(skillDirExists).toBe(false);

    let symlinkExists = false;
    try {
      await lstat(join(claudeHome, "skills", "foo"));
      symlinkExists = true;
    } catch {
      // expected
    }
    expect(symlinkExists).toBe(false);
  });

  test("throws when skill is not in lockfile", async () => {
    const tmp = await Bun.$`mktemp -d`.text().then((s) => s.trim());
    const agentsHome = join(tmp, ".agents");
    await mkdir(agentsHome, { recursive: true });

    await expect(
      removeSkill("missing", { claudeHome: agentsHome, scope: "global" }),
    ).rejects.toThrow("not installed");
  });
});
