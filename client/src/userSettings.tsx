import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type InputMethod = "keyboard" | "pointer";

export type UserSettings = {
  inputMethod: InputMethod;
};

type UserSettingsContextValue = {
  settings: UserSettings;
  updateSettings: (next: Partial<UserSettings>) => void;
};

const SETTINGS_STORAGE_KEY = "anagram.userSettings";
const DEFAULT_SETTINGS: UserSettings = {
  inputMethod: "keyboard"
};

function isInputMethod(value: unknown): value is InputMethod {
  return value === "keyboard" || value === "pointer";
}

function normalizeSettings(value: Partial<UserSettings> | null | undefined): UserSettings {
  if (!value) return DEFAULT_SETTINGS;
  return {
    inputMethod: isInputMethod(value.inputMethod) ? value.inputMethod : DEFAULT_SETTINGS.inputMethod
  };
}

function readStoredSettings(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings: UserSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures.
  }
}

const UserSettingsContext = createContext<UserSettingsContextValue | null>(null);

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(() => readStoredSettings());

  const updateSettings = useCallback((next: Partial<UserSettings>) => {
    setSettings((current) => {
      const merged = normalizeSettings({ ...current, ...next });
      persistSettings(merged);
      return merged;
    });
  }, []);

  const value = useMemo(
    () => ({
      settings,
      updateSettings
    }),
    [settings, updateSettings]
  );

  return <UserSettingsContext.Provider value={value}>{children}</UserSettingsContext.Provider>;
}

export function useUserSettings() {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error("useUserSettings must be used within a UserSettingsProvider");
  }
  return context;
}
