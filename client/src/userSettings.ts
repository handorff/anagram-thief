import { createContext, useContext } from "react";

const USER_SETTINGS_STORAGE_KEY = "anagram.userSettings";

export type InputMethodSetting = "typing" | "tile";
export type ThemeSetting = "light" | "dark";

export type UserSettings = {
  inputMethod: InputMethodSetting;
  theme: ThemeSetting;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  inputMethod: "typing",
  theme: "light"
};

function normalizeInputMethodSetting(value: unknown): InputMethodSetting {
  return value === "tile" ? "tile" : "typing";
}

function normalizeThemeSetting(value: unknown): ThemeSetting {
  return value === "dark" ? "dark" : "light";
}

function normalizeUserSettings(value: unknown): UserSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_USER_SETTINGS;
  }

  const candidate = value as Partial<UserSettings>;
  return {
    inputMethod: normalizeInputMethodSetting(candidate.inputMethod),
    theme: normalizeThemeSetting(candidate.theme)
  };
}

export function readStoredUserSettings(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_USER_SETTINGS;
  try {
    const storedValue = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY);
    if (!storedValue) return DEFAULT_USER_SETTINGS;
    const parsed = JSON.parse(storedValue) as unknown;
    return normalizeUserSettings(parsed);
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

export function persistUserSettings(settings: UserSettings) {
  if (typeof window === "undefined") return;
  try {
    const normalized = normalizeUserSettings(settings);
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage failures.
  }
}

export type UserSettingsContextValue = {
  settings: UserSettings;
  isTileInputMethodEnabled: boolean;
  isDarkMode: boolean;
};

export const UserSettingsContext = createContext<UserSettingsContextValue>({
  settings: DEFAULT_USER_SETTINGS,
  isTileInputMethodEnabled: false,
  isDarkMode: false
});

export function useUserSettings() {
  return useContext(UserSettingsContext);
}

export function buildUserSettingsContextValue(settings: UserSettings): UserSettingsContextValue {
  return {
    settings,
    isTileInputMethodEnabled: settings.inputMethod === "tile",
    isDarkMode: settings.theme === "dark"
  };
}
