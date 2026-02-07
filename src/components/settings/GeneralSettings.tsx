import { useSettingsStore } from "../../stores/settingsStore";
import { themes, ThemeKey } from "../../config/themes";

function GeneralSettings() {
  const {
    theme, mode, timeFormat, fontSize, confirmBeforeDelete, autoSaveFiles,
    setTheme, setMode, setTimeFormat, setFontSize, setConfirmBeforeDelete, setAutoSaveFiles,
    resetToDefaults,
  } = useSettingsStore();
  const t = themes[theme];

  const themeKeys = Object.keys(themes) as ThemeKey[];

  return (
    <div className={`${t.colors.text}`}>
      <h1 className="text-2xl font-bold mb-6">General Settings</h1>

      {/* Theme selection */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Theme
        </label>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeKey)}
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          {themeKeys.map((key) => (
            <option key={key} value={key}>
              {themes[key].name}
            </option>
          ))}
        </select>
      </div>

      {/* Default mode */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Default Mode
        </label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "simple" | "technical")}
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          <option value="simple">Simple</option>
          <option value="technical">Technical</option>
        </select>
        <p className={`text-sm mt-1 ${t.colors.textMuted}`}>
          {mode === "simple" 
            ? "Guided experience with visual previews" 
            : "Full code access with technical details"}
        </p>
      </div>

      {/* Time format */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Time Format
        </label>
        <select
          value={timeFormat}
          onChange={(e) => setTimeFormat(e.target.value as "12h" | "24h")}
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          <option value="12h">12-hour (2:30 PM)</option>
          <option value="24h">24-hour (14:30)</option>
        </select>
      </div>

      {/* Font size */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Font Size
        </label>
        <select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as "small" | "medium" | "large")}
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          <option value="small">Small</option>
          <option value="medium">Medium (default)</option>
          <option value="large">Large</option>
        </select>
      </div>

      {/* Auto-save */}
      <div className="mb-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoSaveFiles}
            onChange={(e) => setAutoSaveFiles(e.target.checked)}
            className="w-4 h-4"
          />
          <div>
            <span className="font-medium">Auto-save files</span>
            <p className={`text-sm ${t.colors.textMuted}`}>
              Automatically save files written by AI to your project
            </p>
          </div>
        </label>
      </div>

      {/* Confirm before delete */}
      <div className="mb-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmBeforeDelete}
            onChange={(e) => setConfirmBeforeDelete(e.target.checked)}
            className="w-4 h-4"
          />
          <div>
            <span className="font-medium">Confirm before deleting</span>
            <p className={`text-sm ${t.colors.textMuted}`}>
              Ask for confirmation before deleting files or clearing chat
            </p>
          </div>
        </label>
      </div>

      {/* Startup behavior */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          On Startup
        </label>
        <select
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          <option value="lastProject">Open last project</option>
          <option value="newChat">Start new chat</option>
          <option value="projectList">Show project list</option>
        </select>
      </div>

      {/* Language */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Language
        </label>
        <select
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
        </select>
      </div>

      {/* Reset */}
      <div className="mb-6 pt-4 border-t border-gray-700">
        <button
          onClick={() => {
            if (window.confirm("Reset all settings to defaults?")) {
              resetToDefaults();
            }
          }}
          className={`px-4 py-2 ${t.borderRadius} text-sm text-red-400 hover:text-red-300 ${t.colors.bgSecondary} hover:opacity-80`}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

export default GeneralSettings;