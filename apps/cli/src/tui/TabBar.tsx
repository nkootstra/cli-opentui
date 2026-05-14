import { useState } from "react";

type TabBarProps = {
  tabs: readonly string[];
  activeIndex: number;
  hint?: string;
  onTabClick?: (index: number) => void;
};

export function TabBar({ tabs, activeIndex, hint, onTabClick }: TabBarProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <box
      flexDirection="row"
      alignItems="center"
      style={{ paddingLeft: 1, paddingRight: 2, paddingTop: 1 }}
    >
      {tabs.map((tab, i) => {
        const isActive = i === activeIndex;
        const isHovered = i === hoveredIndex;
        return (
          <box
            key={tab}
            flexShrink={0}
            flexGrow={0}
            style={{
              paddingLeft: 2,
              paddingRight: 2,
              backgroundColor: isActive ? "#1e1b4b" : isHovered ? "#111827" : undefined,
            }}
            onMouseDown={onTabClick ? () => onTabClick(i) : undefined}
            onMouseOver={onTabClick ? () => setHoveredIndex(i) : undefined}
            onMouseOut={onTabClick ? () => setHoveredIndex(null) : undefined}
          >
            <text
              fg={isActive ? "#a78bfa" : isHovered ? "#9ca3af" : "#4b5563"}
              attributes={isActive ? 1 : 0}
            >
              {tab}
            </text>
          </box>
        );
      })}
      {hint && (
        <>
          <box flexGrow={1} />
          <text fg="#374151">{hint}</text>
        </>
      )}
    </box>
  );
}
