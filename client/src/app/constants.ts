import type { PracticeDifficulty } from "@shared/types";

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

export const SERVER_URL = viteEnv?.VITE_SERVER_URL ?? "http://localhost:3001";
export const SESSION_STORAGE_KEY = "anagram.sessionId";
export const PLAYER_NAME_STORAGE_KEY = "anagram.playerName";
export const PRACTICE_SHARE_QUERY_PARAM = "practice";
export const PRACTICE_RESULT_SHARE_QUERY_PARAM = "practiceResult";
export const PRIVATE_ROOM_QUERY_PARAM = "room";
export const PRIVATE_ROOM_CODE_QUERY_PARAM = "code";
export const LETTER_PATTERN = /^[A-Z]+$/;
export const PENDING_RESULT_AUTO_SUBMIT_TTL_MS = 15_000;

export const DEFAULT_PRACTICE_DIFFICULTY: PracticeDifficulty = 3;
export const DEFAULT_FLIP_TIMER_SECONDS = 15;
export const MIN_FLIP_TIMER_SECONDS = 1;
export const MAX_FLIP_TIMER_SECONDS = 60;
export const DEFAULT_CLAIM_TIMER_SECONDS = 3;
export const MIN_CLAIM_TIMER_SECONDS = 1;
export const MAX_CLAIM_TIMER_SECONDS = 10;
export const DEFAULT_PRACTICE_TIMER_SECONDS = 60;
export const MIN_PRACTICE_TIMER_SECONDS = 10;
export const MAX_PRACTICE_TIMER_SECONDS = 120;
export const REPLAY_ANALYSIS_TIMEOUT_MS = 7_000;
export const REPLAY_ANALYSIS_DEFAULT_VISIBLE_OPTIONS = 3;
export const PRACTICE_TIMER_WARNING_SECONDS = 5;
export const DEFAULT_FLIP_REVEAL_MS = 1_000;
export const CLAIM_WORD_ANIMATION_MS = 1_100;
export const MAX_LOG_ENTRIES = 300;
export const CLAIM_FAILURE_WINDOW_MS = 4_000;
export const CUSTOM_PUZZLE_CENTER_LETTER_MIN = 1;
export const CUSTOM_PUZZLE_CENTER_LETTER_MAX = 16;
export const CUSTOM_PUZZLE_EXISTING_WORD_COUNT_MAX = 8;
export const CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MIN = 4;
export const CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MAX = 16;
export const CUSTOM_PUZZLE_TOTAL_CHARACTERS_MAX = 96;
export const CUSTOM_PUZZLE_VALIDATION_TIMEOUT_MS = 5_000;
export const REPLAY_FILE_INPUT_ACCEPT = "application/json,.json";

export const CLAIM_FAILURE_MESSAGES = new Set([
  "Claim window expired.",
  "Enter a word to claim.",
  "Word must contain only letters A-Z.",
  "Word is not valid.",
  "Not enough tiles in the center to make that word."
]);
