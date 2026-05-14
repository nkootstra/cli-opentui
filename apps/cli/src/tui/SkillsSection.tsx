import { useCallback, useEffect, useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
  buildInstallPlan,
  discoverSkills,
  fetchGitHubArchive,
  installSkills,
  listInstalledSkills,
  parseSourceSpec,
  removeSkill,
  type DiscoveredSkill,
  type InstalledSkill,
} from "@repo/skills";
import { SKILL_SOURCES } from "./sources.ts";
import { TabBar } from "./TabBar.tsx";

type SkillEntry = DiscoveredSkill & {
  sourceSpec: string;
  installed: boolean;
};

// Skills grouped per repo source
type RepoSkills = {
  sourceSpec: string;
  skills: SkillEntry[];
};

type SectionStatus =
  | { type: "loading"; repo: string }
  | { type: "ready"; notice?: string }
  | { type: "busy"; current: number; total: number; message: string }
  | { type: "fatal"; message: string };

async function loadAllSkills(onRepo: (repo: string) => void): Promise<RepoSkills[]> {
  const installed = await listInstalledSkills({ scope: "global" });
  const installedNames = new Set<string>(installed.map((s: InstalledSkill) => s.destinationName));
  const repos: RepoSkills[] = [];

  for (const sourceSpec of SKILL_SOURCES) {
    onRepo(sourceSpec);
    try {
      const parsed = parseSourceSpec(sourceSpec);
      const archiveRoot = await fetchGitHubArchive(parsed);
      const skills = await discoverSkills(archiveRoot);
      repos.push({
        sourceSpec,
        skills: skills.map((skill) => ({
          ...skill,
          sourceSpec,
          installed: installedNames.has(skill.name),
        })),
      });
    } catch {
      // Push empty entry so the tab still shows
      repos.push({ sourceSpec, skills: [] });
    }
  }

  return repos;
}

type SkillsSectionProps = {
  active: boolean;
};

export function SkillsSection({ active }: SkillsSectionProps) {
  const { width } = useTerminalDimensions();
  const [repos, setRepos] = useState<RepoSkills[]>([]);
  const [repoIndex, setRepoIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<SectionStatus>({
    type: "loading",
    repo: SKILL_SOURCES[0] ?? "",
  });

  const reload = useCallback(async () => {
    setSelected(new Set());
    setStatus({ type: "loading", repo: SKILL_SOURCES[0] ?? "" });
    try {
      const loaded = await loadAllSkills((repo) => setStatus({ type: "loading", repo }));
      setRepos(loaded);
      setRepoIndex(0);
      setCursor(0);
      setStatus({ type: "ready" });
    } catch (err) {
      setStatus({ type: "fatal", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const currentSkills = useMemo(() => repos[repoIndex]?.skills ?? [], [repos, repoIndex]);

  const activeNames = useCallback(
    (skills: SkillEntry[], sel: Set<string>, cur: number): string[] => {
      if (sel.size > 0) return [...sel];
      const s = skills[cur];
      return s ? [s.name] : [];
    },
    [],
  );

  const applyToggle = useCallback(async () => {
    const names = activeNames(currentSkills, selected, cursor);
    if (names.length === 0) return;

    const toInstall = names.filter((n) => !currentSkills.find((s) => s.name === n)?.installed);
    const toRemove = names.filter((n) => currentSkills.find((s) => s.name === n)?.installed);
    const total = toInstall.length + toRemove.length;
    let done = 0;

    const bySource = new Map<string, string[]>();
    for (const name of toInstall) {
      const skill = currentSkills.find((s) => s.name === name)!;
      const list = bySource.get(skill.sourceSpec) ?? [];
      list.push(name);
      bySource.set(skill.sourceSpec, list);
    }

    const errors: string[] = [];

    try {
      for (const [sourceSpec, batchNames] of bySource) {
        setStatus({
          type: "busy",
          current: done + 1,
          total,
          message: `Installing ${batchNames.join(", ")}…`,
        });
        try {
          const source = parseSourceSpec(sourceSpec);
          const archiveRoot = await fetchGitHubArchive(source);
          const discovered = await discoverSkills(archiveRoot);
          const plan = await buildInstallPlan({
            scope: "global",
            selectedNames: batchNames,
            source,
            skills: discovered,
          });
          await installSkills(plan, { force: true });
          setRepos((prev) =>
            prev.map((r) => ({
              ...r,
              skills: r.skills.map((s) =>
                batchNames.includes(s.name) ? { ...s, installed: true } : s,
              ),
            })),
          );
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
        done += batchNames.length;
      }

      for (const name of toRemove) {
        setStatus({ type: "busy", current: done + 1, total, message: `Uninstalling ${name}…` });
        try {
          await removeSkill(name, { scope: "global" });
          setRepos((prev) =>
            prev.map((r) => ({
              ...r,
              skills: r.skills.map((s) => (s.name === name ? { ...s, installed: false } : s)),
            })),
          );
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
        done++;
      }

      setSelected(new Set());
      setStatus({ type: "ready", notice: errors.length > 0 ? errors.join("  ·  ") : undefined });
    } catch (err) {
      setSelected(new Set());
      setStatus({ type: "ready", notice: err instanceof Error ? err.message : String(err) });
    }
  }, [currentSkills, selected, cursor, activeNames]);

  useKeyboard((key) => {
    if (!active) return;
    if (status.type === "busy") return;
    if (status.type === "loading") return;

    if (key.name === "]") {
      setRepoIndex((i) => Math.min(repos.length - 1, i + 1));
      setCursor(0);
      setSelected(new Set());
    } else if (key.name === "[") {
      setRepoIndex((i) => Math.max(0, i - 1));
      setCursor(0);
      setSelected(new Set());
    } else if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(currentSkills.length - 1, c + 1));
    } else if (key.name === "space") {
      const skill = currentSkills[cursor];
      if (!skill) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(skill.name)) next.delete(skill.name);
        else next.add(skill.name);
        return next;
      });
    } else if (key.name === "return") {
      void applyToggle();
    } else if (key.name === "escape") {
      setSelected(new Set());
    } else if (key.name === "r") {
      void reload();
    }
  });

  const isBusy = status.type === "busy";
  const notice = status.type === "ready" ? status.notice : undefined;
  const focusedSkill = currentSkills[cursor];
  const listWidth = Math.min(34, Math.floor(width * 0.35));
  const repoTabNames = repos.map((r) => r.sourceSpec);

  // ── Loading splash ───────────────────────────────────────────────────────
  if (status.type === "loading") {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <box flexDirection="column" alignItems="center" style={{ gap: 1 }}>
          <text fg="#facc15">Fetching skills…</text>
          <text fg="#6b7280">{status.repo}</text>
        </box>
      </box>
    );
  }

  if (status.type === "fatal") {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <box flexDirection="column" alignItems="center" style={{ gap: 1 }}>
          <text fg="#f87171" attributes={1}>
            Failed to load skills
          </text>
          <text fg="#9ca3af">{status.message}</text>
          <text fg="#6b7280">Press r to retry</text>
        </box>
      </box>
    );
  }

  const activeCount = selected.size;

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* ── Repo tabs ── */}
      <TabBar
        tabs={repoTabNames}
        activeIndex={repoIndex}
        hint={repos.length > 1 ? "[ ] switch repo" : undefined}
        onTabClick={(i) => setRepoIndex(i)}
      />

      {/* ── Status bar ── */}
      {isBusy && (
        <box style={{ paddingLeft: 2, paddingTop: 1, paddingBottom: 1 }}>
          <text fg="#60a5fa">{`⟳  ${status.message}  (${status.current}/${status.total})`}</text>
        </box>
      )}
      {!isBusy && notice && (
        <box style={{ paddingLeft: 2, paddingTop: 1, paddingBottom: 1 }}>
          <text fg="#f87171">{`✗  ${notice}`}</text>
        </box>
      )}
      {!isBusy && !notice && activeCount > 0 && (
        <box style={{ paddingLeft: 2, paddingTop: 1, paddingBottom: 1 }}>
          <text fg="#fbbf24">{`${activeCount} skill${activeCount === 1 ? "" : "s"} selected  ·  Enter to apply`}</text>
        </box>
      )}

      {/* ── Two-pane area ── */}
      <box flexDirection="row" flexGrow={1}>
        {/* Left: skill list */}
        <box flexDirection="column" width={listWidth} style={{ border: true, paddingTop: 1 }}>
          {currentSkills.length === 0 && (
            <box style={{ paddingLeft: 2 }}>
              <text fg="#6b7280">No skills found.</text>
            </box>
          )}
          {currentSkills.map((skill, index) => {
            const isCursor = index === cursor;
            const isMarked = selected.has(skill.name);
            const badge = isMarked ? "◆ " : skill.installed ? "✓ " : "  ";
            const badgeColor = isMarked ? "#fbbf24" : skill.installed ? "#4ade80" : "#374151";
            const nameFg = isCursor
              ? "#ffffff"
              : isMarked
                ? "#fef08a"
                : skill.installed
                  ? "#86efac"
                  : "#d1d5db";
            return (
              <box
                key={skill.name}
                flexDirection="row"
                alignItems="center"
                style={{
                  paddingLeft: 1,
                  paddingRight: 1,
                  backgroundColor: isCursor ? "#312e81" : undefined,
                }}
              >
                <text fg={badgeColor}>{badge}</text>
                <text fg={nameFg} attributes={isCursor ? 1 : 0}>
                  {skill.name}
                </text>
              </box>
            );
          })}
        </box>

        {/* Right: detail panel */}
        <box flexDirection="column" flexGrow={1} style={{ padding: 2 }}>
          {focusedSkill ? (
            <>
              <box flexDirection="row" alignItems="center" style={{ marginBottom: 1 }}>
                <text fg="#e5e7eb" attributes={1}>
                  {focusedSkill.name}
                </text>
                <box style={{ marginLeft: 2 }}>
                  {focusedSkill.installed ? (
                    <text fg="#4ade80">● Installed</text>
                  ) : (
                    <text fg="#6b7280">○ Not installed</text>
                  )}
                </box>
                {selected.has(focusedSkill.name) && (
                  <box style={{ marginLeft: 2 }}>
                    <text fg="#fbbf24">◆ Selected</text>
                  </box>
                )}
              </box>

              {focusedSkill.description ? (
                <text fg="#9ca3af">{focusedSkill.description}</text>
              ) : (
                <text fg="#4b5563" attributes={2}>
                  No description available.
                </text>
              )}

              <box style={{ marginTop: 2 }}>
                {activeCount > 1 ? (
                  <text fg="#fbbf24">{`Press Enter to apply ${activeCount} changes`}</text>
                ) : focusedSkill.installed ? (
                  <text fg="#f87171">Press Enter to uninstall</text>
                ) : (
                  <text fg="#4ade80">Press Enter to install</text>
                )}
              </box>
            </>
          ) : (
            <text fg="#4b5563">Select a skill to see details.</text>
          )}
        </box>
      </box>
    </box>
  );
}
