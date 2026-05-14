import { useEffect, useState } from "react";
import { type DoctorResult, runDoctor } from "@repo/skills";

type LoadState =
  | { status: "loading" }
  | { status: "done"; result: DoctorResult }
  | { status: "error"; message: string };

const ISSUE_KIND_LABEL: Record<string, string> = {
  missing_agents_dir: "Missing skills dir",
  missing_claude_dir: "Missing claude dir",
  missing_claude_symlink: "Missing symlink",
  broken_claude_symlink: "Broken symlink",
  orphaned_lockfile_entry: "Orphaned lockfile entry",
  lockfile_corrupt: "Corrupt lockfile",
};

export function DoctorSection() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    runDoctor()
      .then((result) => setState({ status: "done", result }))
      .catch((err: unknown) =>
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, []);

  if (state.status === "loading") {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg="#60a5fa">Running diagnostics…</text>
      </box>
    );
  }

  if (state.status === "error") {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg="#f87171">{`Doctor failed: ${state.message}`}</text>
      </box>
    );
  }

  const { result } = state;
  const healthy = result.issues.length === 0;

  return (
    <box flexDirection="column" flexGrow={1} style={{ padding: 2 }}>
      {/* Header */}
      <box flexDirection="column" style={{ marginBottom: 1 }}>
        <text fg="#a78bfa" attributes={1}>
          Doctor
        </text>
        {healthy ? (
          <text fg="#4ade80">✓  All checks passed</text>
        ) : (
          <text fg="#f87171">{`✗  ${result.issues.length} issue${result.issues.length !== 1 ? "s" : ""} found`}</text>
        )}
      </box>

      {/* Paths */}
      <box flexDirection="column" style={{ marginBottom: 1 }}>
        <text fg="#4b5563">{`Skills dir : ${result.agentsHome}`}</text>
        <text fg="#4b5563">{`Claude dir : ${result.claudeHome}`}</text>
      </box>

      {/* Issue list */}
      {!healthy && (
        <box flexDirection="column">
          {result.issues.map((issue, i) => {
            const label = ISSUE_KIND_LABEL[issue.kind] ?? issue.kind;
            const title = issue.skillName ? `${label}  —  ${issue.skillName}` : label;
            return (
              <box key={i} flexDirection="column" style={{ marginBottom: 1 }}>
                <text fg="#fbbf24" attributes={1}>{`✗  ${title}`}</text>
                <text fg="#6b7280" style={{ paddingLeft: 3 }}>
                  {issue.message}
                </text>
              </box>
            );
          })}
        </box>
      )}
    </box>
  );
}
