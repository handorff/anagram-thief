import { io } from "socket.io-client";
import {
  SERVER_URL,
  SESSION_STORAGE_KEY
} from "../constants";

export function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateSessionId() {
  if (typeof window === "undefined") return generateId();
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }
    const created = generateId();
    window.localStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return generateId();
  }
}

const sessionId = getOrCreateSessionId();

export const socket = io(SERVER_URL, { autoConnect: false });
socket.auth = { sessionId };
socket.connect();
