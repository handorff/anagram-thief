import { PLAYER_NAME_STORAGE_KEY } from "../constants";

export function readStoredPlayerName() {
  if (typeof window === "undefined") return "";
  try {
    const value = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    return value ?? "";
  } catch {
    return "";
  }
}

export function persistPlayerName(name: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  } catch {
    // Ignore storage failures.
  }
}

export function sanitizeClientName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 24) : "Player";
}
