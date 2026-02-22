import { useState } from "react";
import { MediaPanel } from "./MediaPanel";
import { ClipInspector } from "./ClipInspector";
import { TextEditorPanel } from "./TextEditorPanel";
import { TransitionsPanel } from "./TransitionsPanel";

type Tab = "media" | "text" | "transitions" | "inspector";

const TABS: { id: Tab; label: string }[] = [
  { id: "media", label: "Media" },
  { id: "text", label: "Text" },
  { id: "transitions", label: "Transitions" },
  { id: "inspector", label: "Inspector" },
];

export function LeftPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("media");

  return (
    <div className="left-panel">
      <div className="tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {activeTab === "media" && <MediaPanel />}
        {activeTab === "text" && <TextEditorPanel />}
        {activeTab === "transitions" && <TransitionsPanel />}
        {activeTab === "inspector" && <ClipInspector />}
      </div>
    </div>
  );
}
