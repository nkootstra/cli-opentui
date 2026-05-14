import { useEffect, useState } from "react";
import { type KnownApplication, listApplications } from "@repo/skills";

type LoadState =
  | { status: "loading" }
  | { status: "done"; apps: KnownApplication[] }
  | { status: "error"; message: string };

const STATUS_COLOR: Record<string, string> = {
  active: "#4ade80",
  missing: "#fbbf24",
  not_configured: "#4b5563",
};

export function ApplicationsSection() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    listApplications()
      .then((apps) => setState({ status: "done", apps }))
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
        <text fg="#60a5fa">Scanning applications…</text>
      </box>
    );
  }

  if (state.status === "error") {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg="#f87171">{`Applications failed: ${state.message}`}</text>
      </box>
    );
  }

  const { apps } = state;
  const active = apps.filter((a) => a.status === "active");

  return (
    <box flexDirection="column" flexGrow={1} style={{ padding: 2 }}>
      {/* Header */}
      <box flexDirection="column" style={{ marginBottom: 1 }}>
        <text fg="#a78bfa" attributes={1}>
          Applications
        </text>
        <text fg="#4b5563">{`${active.length} of ${apps.length} configured`}</text>
      </box>

      {/* App rows */}
      <box flexDirection="column">
        {apps.map((app) => {
          const dot = STATUS_COLOR[app.status] ?? "#4b5563";
          const skillLabel =
            app.status === "active"
              ? `${app.skillCount} skill${app.skillCount !== 1 ? "s" : ""}`
              : app.status === "missing"
                ? "no skills dir"
                : "not installed";
          const skillColor = app.status === "active" ? "#60a5fa" : dot;

          return (
            <box
              key={app.name}
              flexDirection="row"
              alignItems="center"
              style={{ paddingTop: 1, paddingBottom: 1 }}
            >
              <text fg={dot} style={{ paddingRight: 2 }}>
                ●
              </text>
              <text fg="#e5e7eb" attributes={app.status === "active" ? 1 : 0} style={{ width: 14 }}>
                {app.name}
              </text>
              <text fg={skillColor} style={{ width: 16 }}>
                {skillLabel}
              </text>
              <text fg="#374151">{app.skillsDir}</text>
            </box>
          );
        })}
      </box>
    </box>
  );
}
