import { useCallback, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { TabBar } from "./tui/TabBar.tsx";
import { SkillsSection } from "./tui/SkillsSection.tsx";
import { DoctorSection } from "./tui/DoctorSection.tsx";
import { ApplicationsSection } from "./tui/ApplicationsSection.tsx";
import { StatusBar, type StatusBarDeps } from "./tui/StatusBar.tsx";

const ROOT_TABS = ["Skills", "Doctor", "Applications"] as const;
type RootTab = (typeof ROOT_TABS)[number];

export function App({ statusBarDeps = {} }: { statusBarDeps?: StatusBarDeps } = {}) {
  const renderer = useRenderer();
  const [activeTab, setActiveTab] = useState<RootTab>("Skills");
  const activeIndex = ROOT_TABS.indexOf(activeTab);
  const [appsRefreshKey, setAppsRefreshKey] = useState(0);
  const onSkillsChanged = useCallback(() => setAppsRefreshKey((k) => k + 1), []);

  useKeyboard((key) => {
    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      renderer.destroy();
      return;
    }
    if (key.name === "tab" && !key.shift) {
      setActiveTab(ROOT_TABS[(activeIndex + 1) % ROOT_TABS.length]!);
    } else if (key.name === "tab" && key.shift) {
      setActiveTab(ROOT_TABS[(activeIndex - 1 + ROOT_TABS.length) % ROOT_TABS.length]!);
    }
  });

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* ── Root tab bar ── */}
      <TabBar
        tabs={ROOT_TABS}
        activeIndex={activeIndex}
        hint="Tab / Shift+Tab switch  ·  q quit"
        onTabClick={(i) => setActiveTab(ROOT_TABS[i]!)}
      />

      {/* ── Active section ── */}
      {activeTab === "Skills" && <SkillsSection active onSkillsChanged={onSkillsChanged} />}
      {activeTab === "Doctor" && <DoctorSection />}
      {activeTab === "Applications" && <ApplicationsSection refreshKey={appsRefreshKey} />}

      {/* ── Bottom status bar ── */}
      <StatusBar deps={statusBarDeps} />
    </box>
  );
}
