import { io } from "socket.io-client";
import {
  SERVER_URL,
  SESSION_TOKEN_STORAGE_KEY
} from "../constants";

export function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readStoredSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function persistSessionToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage failures.
  }
}

const sessionToken = readStoredSessionToken();

export const socket = io(SERVER_URL, { autoConnect: false });
socket.auth = sessionToken ? { sessionToken } : {};
socket.connect();

export function setSocketSessionToken(token: string) {
  const normalized = token.trim();
  if (!normalized) return;
  persistSessionToken(normalized);
  socket.auth = { sessionToken: normalized };
}
