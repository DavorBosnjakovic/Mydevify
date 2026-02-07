import { useState, useCallback } from "react";
import { PanelRight } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSnapshotStore } from "../../stores/snapshotStore";
import { themes } from "../../config/themes";
import Topbar from "../topbar/Topbar";
import Sidebar from "../sidebar/Sidebar";
import ChatArea from "../chat/ChatArea";
import PreviewArea from "../preview/PreviewArea";
import SettingsLayout from "../settings/SettingsLayout";
import TimeMachine from "../timemachine/TimeMachine";
import TerminalPanel from "../terminal/TerminalPanel";

function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");

  // Vertical divider (chat <-> preview)
  const [chatWidth, setChatWidth] = useState(50);
  const [isDraggingVertical, setIsDraggingVertical] = useState(false);

  // Horizontal divider (editor area <-> terminal)
  const [terminalHeight, setTerminalHeight] = useState(30);
  const [isDraggingHorizontal, setIsDraggingHorizontal] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);

  const { theme, mode } = useSettingsStore();
  const { isOpen: timeMachineOpen } = useSnapshotStore();
  const t = themes[theme];

  const showTerminal = mode === "technical" && terminalOpen;

  // --- Vertical divider handlers (chat <-> preview) ---
  const handleVerticalMouseDown = useCallback(() => {
    setIsDraggingVertical(true);
  }, []);

  // --- Horizontal divider handlers (editor <-> terminal) ---
  const handleHorizontalMouseDown = useCallback(() => {
    setIsDraggingHorizontal(true);
  }, []);

  // --- Unified mouse up ---
  const handleMouseUp = useCallback(() => {
    setIsDraggingVertical(false);
    setIsDraggingHorizontal(false);
  }, []);

  // --- Unified mouse move ---
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDraggingVertical) {
        const container = e.currentTarget;
        const rect = container.getBoundingClientRect();
        const sidebarWidth = sidebarOpen ? 256 : 48;
        const availableWidth = rect.width - sidebarWidth;
        const mouseX = e.clientX - rect.left - sidebarWidth;
        const newChatWidth = Math.min(
          Math.max((mouseX / availableWidth) * 100, 20),
          80
        );
        setChatWidth(newChatWidth);
      }

      if (isDraggingHorizontal) {
        const container = e.currentTarget;
        const rect = container.getBoundingClientRect();
        const topbarHeight = 48;
        const availableHeight = rect.height - topbarHeight;
        const mouseY = e.clientY - rect.top - topbarHeight;
        // Terminal height is measured from bottom, so invert
        const newTerminalPercent =
          ((availableHeight - mouseY) / availableHeight) * 100;
        setTerminalHeight(Math.min(Math.max(newTerminalPercent, 10), 70));
      }
    },
    [isDraggingVertical, isDraggingHorizontal, sidebarOpen]
  );

  const handleSettingsClick = (tab: string = "general") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  return (
    <div
      className={`flex flex-col h-screen ${t.colors.bg} ${t.colors.text} ${t.fontFamily} select-none`}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top bar */}
      <Topbar
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - always visible */}
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onSettingsClick={handleSettingsClick}
        />

        {/* Settings view */}
        {settingsOpen ? (
          <SettingsLayout
            onClose={() => setSettingsOpen(false)}
            initialTab={settingsTab}
          />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* ── Upper area: Chat + Preview ── */}
            <div
              className="flex overflow-hidden"
              style={{
                height: showTerminal
                  ? `${100 - terminalHeight}%`
                  : "100%",
              }}
            >
              {/* Chat area */}
              <div
                className={`flex flex-col ${t.colors.border} ${previewOpen ? "border-r" : ""}`}
                style={{
                  width: previewOpen ? `${chatWidth}%` : "100%",
                }}
              >
                <ChatArea onSettingsClick={handleSettingsClick} />
              </div>

              {previewOpen && (
                <>
                  {/* Vertical resize handle */}
                  <div
                    className={`w-1 cursor-col-resize ${isDraggingVertical ? "bg-blue-500" : t.colors.bgSecondary} hover:bg-blue-500 transition-colors`}
                    onMouseDown={handleVerticalMouseDown}
                  />
                  {/* Preview area */}
                  <div className="flex-1 flex flex-col">
                    <PreviewArea onClose={() => setPreviewOpen(false)} />
                  </div>
                </>
              )}

              {/* Preview toggle button (when closed) */}
              {!previewOpen && (
                <button
                  onClick={() => setPreviewOpen(true)}
                  className={`w-10 ${t.colors.bgSecondary} ${t.colors.text} flex items-center justify-center hover:opacity-80`}
                >
                  <PanelRight size={20} />
                </button>
              )}

              {/* Time Machine panel */}
              {timeMachineOpen && <TimeMachine />}
            </div>

            {/* ── Horizontal resize divider + Terminal ── */}
            {showTerminal && (
              <>
                <div
                  className={`h-1 cursor-row-resize ${isDraggingHorizontal ? "bg-blue-500" : t.colors.bgSecondary} hover:bg-blue-500 transition-colors`}
                  onMouseDown={handleHorizontalMouseDown}
                />
                <div
                  className={`overflow-hidden ${t.colors.border} border-t`}
                  style={{ height: `${terminalHeight}%` }}
                >
                  <TerminalPanel />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MainLayout;