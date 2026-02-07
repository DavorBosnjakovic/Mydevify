import { create } from "zustand";
import { ThemeKey } from "../config/themes";

interface SettingsState {
  theme: ThemeKey;
  mode: "simple" | "technical";
  timeFormat: "12h" | "24h";
  fontSize: "small" | "medium" | "large";
  confirmBeforeDelete: boolean;
  autoSaveFiles: boolean;
  setTheme: (theme: ThemeKey) => void;
  setMode: (mode: "simple" | "technical") => void;
  setTimeFormat: (format: "12h" | "24h") => void;
  setFontSize: (size: "small" | "medium" | "large") => void;
  setConfirmBeforeDelete: (value: boolean) => void;
  setAutoSaveFiles: (value: boolean) => void;
  cycleTheme: () => void;
  toggleMode: () => void;
  resetToDefaults: () => void;
}

const themeOrder: ThemeKey[] = ["dark", "light", "sepia", "retro", "midnight", "highContrast"];

const defaults = {
  theme: "dark" as ThemeKey,
  mode: "simple" as const,
  timeFormat: "12h" as const,
  fontSize: "medium" as const,
  confirmBeforeDelete: true,
  autoSaveFiles: true,
};

// Load persisted settings from localStorage
function loadPersistedSettings() {
  try {
    const saved = localStorage.getItem("mydevify-settings");
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaults, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return defaults;
}

// Save settings to localStorage
function persistSettings(state: Partial<SettingsState>) {
  try {
    const current = loadPersistedSettings();
    const updated = { ...current, ...state };
    // Only save data fields, not functions
    const { theme, mode, timeFormat, fontSize, confirmBeforeDelete, autoSaveFiles } = updated;
    localStorage.setItem("mydevify-settings", JSON.stringify({ theme, mode, timeFormat, fontSize, confirmBeforeDelete, autoSaveFiles }));
  } catch {
    // Ignore storage errors
  }
}

const initial = loadPersistedSettings();

export const useSettingsStore = create<SettingsState>((set) => ({
  ...initial,
  setTheme: (theme) => set(() => { persistSettings({ theme }); return { theme }; }),
  setMode: (mode) => set(() => { persistSettings({ mode }); return { mode }; }),
  setTimeFormat: (timeFormat) => set(() => { persistSettings({ timeFormat }); return { timeFormat }; }),
  setFontSize: (fontSize) => set(() => { persistSettings({ fontSize }); return { fontSize }; }),
  setConfirmBeforeDelete: (confirmBeforeDelete) => set(() => { persistSettings({ confirmBeforeDelete }); return { confirmBeforeDelete }; }),
  setAutoSaveFiles: (autoSaveFiles) => set(() => { persistSettings({ autoSaveFiles }); return { autoSaveFiles }; }),
  cycleTheme: () =>
    set((state) => {
      const currentIndex = themeOrder.indexOf(state.theme);
      const nextIndex = (currentIndex + 1) % themeOrder.length;
      const theme = themeOrder[nextIndex];
      persistSettings({ theme });
      return { theme };
    }),
  toggleMode: () =>
    set((state) => {
      const mode = state.mode === "simple" ? "technical" : "simple";
      persistSettings({ mode });
      return { mode };
    }),
  resetToDefaults: () => set(() => {
    persistSettings(defaults);
    return { ...defaults };
  }),
}));