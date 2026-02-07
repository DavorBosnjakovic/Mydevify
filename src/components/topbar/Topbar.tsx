import { useState, useEffect } from "react";
import { Monitor, Palette, ChevronDown, GitBranch } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import { themes, ThemeKey } from "../../config/themes";
import UsageIndicator from "../chat/UsageIndicator";

function Topbar() {
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitChanges, setGitChanges] = useState(0);
  const { theme, mode, setTheme, toggleMode } = useSettingsStore();
  const { currentProject, projectPath } = useProjectStore();
  const t = themes[theme];
  const themeKeys = Object.keys(themes) as ThemeKey[];

  // Fetch git status when project changes or mode switches to technical
  useEffect(() => {
    if (!projectPath || mode !== "technical") {
      setGitBranch(null);
      setGitChanges(0);
      return;
    }

    async function fetchGitStatus() {
      try {
        const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
          "execute_command",
          { command: "git rev-parse --abbrev-ref HEAD", cwd: projectPath }
        );
        if (result.exit_code === 0 && result.stdout.trim()) {
          setGitBranch(result.stdout.trim());

          // Get changed file count
          const statusResult = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
            "execute_command",
            { command: "git status --porcelain", cwd: projectPath }
          );
          if (statusResult.exit_code === 0) {
            const lines = statusResult.stdout.trim().split("\n").filter((l: string) => l.length > 0);
            setGitChanges(lines.length);
          }
        } else {
          setGitBranch(null);
          setGitChanges(0);
        }
      } catch {
        setGitBranch(null);
        setGitChanges(0);
      }
    }

    fetchGitStatus();

    // Refresh git status every 10 seconds
    const interval = setInterval(fetchGitStatus, 10000);
    return () => clearInterval(interval);
  }, [projectPath, mode]);

  return (
    <div className={`h-12 ${t.colors.bgSecondary} ${t.colors.border} border-b flex items-center px-4 justify-between ${t.glow}`}>
      {/* Left: Logo + Project + Git */}
      <div className="flex items-center gap-4">
        <span className={`font-bold text-lg ${t.colors.text}`}>Mydevify</span>
        <span className={t.colors.textMuted}>|</span>
        <span className={t.colors.textMuted}>
          {currentProject ? currentProject.name : "No project open"}
        </span>

        {/* Git indicator - Technical mode only */}
        {mode === "technical" && gitBranch && (
          <>
            <span className={t.colors.textMuted}>|</span>
            <div className="flex items-center gap-1.5">
              <GitBranch size={14} className={t.colors.textMuted} />
              <span className={`text-sm ${t.colors.textMuted}`}>
                {gitBranch}
              </span>
              {gitChanges > 0 && (
                <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">
                  {gitChanges}↑
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        {/* Usage indicator */}
        <UsageIndicator />

        {/* Mode toggle */}
        <button
          onClick={toggleMode}
          className={`px-3 py-1 ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} text-sm flex items-center gap-2 hover:opacity-80`}
        >
          <Monitor size={16} />
          {mode === "simple" ? "Simple" : "Technical"}
        </button>

        {/* Theme dropdown */}
        <div className="relative">
          <button
            onClick={() => setThemeDropdownOpen(!themeDropdownOpen)}
            className={`px-3 py-1 ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} text-sm flex items-center gap-2 hover:opacity-80`}
          >
            <Palette size={16} />
            {t.name}
            <ChevronDown size={14} />
          </button>
          {themeDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setThemeDropdownOpen(false)}
              />
              <div className={`absolute right-0 mt-1 w-40 ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-lg z-50`}>
                {themeKeys.map((key) => (
                  <button
                    key={key}
                    onClick={() => {
                      setTheme(key);
                      setThemeDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-sm text-left flex items-center justify-between ${t.colors.text} hover:${t.colors.bgTertiary} ${
                      theme === key ? t.colors.accent + " text-white" : ""
                    }`}
                  >
                    {themes[key].name}
                    {theme === key && <span>✔</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}

export default Topbar;