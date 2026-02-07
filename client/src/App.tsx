import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { io } from "socket.io-client";
import type {
  AdminEndGameWarningResponse,
  AdminGameSummary,
  AdminGamesResponse,
  AdminLoginResponse,
  GameReplay,
  GameState,
  Player,
  PracticeDifficulty,
  PracticeModeState,
  PracticeResultSharePayload,
  PracticeResult,
  PracticeScoredWord,
  PracticeSharePayload,
  PracticeValidateCustomResponse,
  ReplayAnalysisMap,
  ReplayAnalysisResponse,
  ReplayAnalysisResult,
  ReplayFileV1,
  ReplayPlayerSnapshot,
  ReplayStateSnapshot,
  RoomState,
  RoomSummary
} from "@shared/types";
import {
  buildPracticeSharePayload,
  decodePracticeSharePayload,
  encodePracticeSharePayload
} from "@shared/practiceShare";
import {
  buildPracticeResultSharePayload,
  decodePracticeResultSharePayload,
  encodePracticeResultSharePayload
} from "@shared/practiceResultShare";
import {
  buildReplayFileV1,
  parseReplayFile,
  serializeReplayFile
} from "@shared/replayFile";
import {
  MAX_REPLAY_IMPORT_FILE_BYTES,
  buildReplayExportFilename,
  getImportedReplayAnalysis,
  toReplayAnalysisMap
} from "./replayImportExport";
import {
  buildUserSettingsContextValue,
  persistUserSettings,
  readStoredUserSettings,
  UserSettingsContext,
  useUserSettings,
  type UserSettings
} from "./userSettings";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const SESSION_STORAGE_KEY = "anagram.sessionId";
const PLAYER_NAME_STORAGE_KEY = "anagram.playerName";
const PRACTICE_SHARE_QUERY_PARAM = "practice";
const PRACTICE_RESULT_SHARE_QUERY_PARAM = "practiceResult";
const PRIVATE_ROOM_QUERY_PARAM = "room";
const PRIVATE_ROOM_CODE_QUERY_PARAM = "code";
const LETTER_PATTERN = /^[A-Z]+$/;
const PENDING_RESULT_AUTO_SUBMIT_TTL_MS = 15_000;

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readStoredPlayerName() {
  if (typeof window === "undefined") return "";
  try {
    const value = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    return value ?? "";
  } catch {
    return "";
  }
}

function persistPlayerName(name: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  } catch {
    // Ignore storage failures.
  }
}

function getOrCreateSessionId() {
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

type PendingSharedLaunch =
  | {
      kind: "puzzle";
      payload: PracticeSharePayload;
    }
  | {
      kind: "result";
      payload: PracticeSharePayload;
      submittedWord: string;
      sharerName?: string;
      expectedPuzzleFingerprint: string;
    };

type PendingResultAutoSubmit = {
  submittedWord: string;
  expectedPuzzleFingerprint: string;
  expiresAt: number;
};

type PendingPrivateRoomJoin = {
  roomId: string;
  code: string;
};

function buildPracticePuzzleFingerprint(payload: Pick<PracticeSharePayload, "c" | "w">): string {
  return `${payload.c}|${payload.w.join(",")}`;
}

function buildPracticePuzzleFingerprintFromState(puzzle: PracticeModeState["puzzle"]): string | null {
  if (!puzzle) return null;
  const center = puzzle.centerTiles.map((tile) => normalizeEditorText(tile.letter)).join("");
  const words = puzzle.existingWords.map((word) => normalizeEditorText(word.text));
  return buildPracticePuzzleFingerprint({
    c: center,
    w: words
  });
}

function parseResultSharePayloadFromUrl(token: string): PracticeResultSharePayload | null {
  return decodePracticeResultSharePayload(token);
}

function readPendingSharedLaunchFromUrl(): PendingSharedLaunch | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const resultToken = params.get(PRACTICE_RESULT_SHARE_QUERY_PARAM);
  if (resultToken) {
    const parsed = parseResultSharePayloadFromUrl(resultToken);
    if (parsed) {
      return {
        kind: "result",
        payload: parsed.p,
        submittedWord: parsed.a,
        sharerName: parsed.n,
        expectedPuzzleFingerprint: buildPracticePuzzleFingerprint(parsed.p)
      };
    }
  }

  const practiceToken = params.get(PRACTICE_SHARE_QUERY_PARAM);
  if (!practiceToken) return null;
  const puzzlePayload = decodePracticeSharePayload(practiceToken);
  if (!puzzlePayload) return null;
  return {
    kind: "puzzle",
    payload: puzzlePayload
  };
}

function readPendingPrivateRoomJoinFromUrl(): PendingPrivateRoomJoin | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get(PRIVATE_ROOM_QUERY_PARAM)?.trim();
  const code = params.get(PRIVATE_ROOM_CODE_QUERY_PARAM)?.trim();
  if (!roomId || !code) return null;
  return { roomId, code };
}

function removePracticeShareFromUrl() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has(PRACTICE_SHARE_QUERY_PARAM) && !params.has(PRACTICE_RESULT_SHARE_QUERY_PARAM)) return;
  params.delete(PRACTICE_SHARE_QUERY_PARAM);
  params.delete(PRACTICE_RESULT_SHARE_QUERY_PARAM);
  const search = params.toString();
  const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

function removePrivateRoomJoinFromUrl() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has(PRIVATE_ROOM_QUERY_PARAM) && !params.has(PRIVATE_ROOM_CODE_QUERY_PARAM)) return;
  params.delete(PRIVATE_ROOM_QUERY_PARAM);
  params.delete(PRIVATE_ROOM_CODE_QUERY_PARAM);
  const search = params.toString();
  const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

function buildPrivateRoomInviteUrl(roomId: string, code: string): string {
  const inviteUrl = new URL(window.location.origin + window.location.pathname);
  inviteUrl.searchParams.set(PRIVATE_ROOM_QUERY_PARAM, roomId);
  inviteUrl.searchParams.set(PRIVATE_ROOM_CODE_QUERY_PARAM, code);
  return inviteUrl.toString();
}

const sessionId = getOrCreateSessionId();
const socket = io(SERVER_URL, { autoConnect: false });
socket.auth = { sessionId };
socket.connect();

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function sanitizeClientName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 24) : "Player";
}

function normalizeEditorText(value: string): string {
  return value.trim().toUpperCase();
}

const DEFAULT_PRACTICE_DIFFICULTY: PracticeDifficulty = 3;
const DEFAULT_FLIP_TIMER_SECONDS = 15;
const MIN_FLIP_TIMER_SECONDS = 1;
const MAX_FLIP_TIMER_SECONDS = 60;
const DEFAULT_CLAIM_TIMER_SECONDS = 3;
const MIN_CLAIM_TIMER_SECONDS = 1;
const MAX_CLAIM_TIMER_SECONDS = 10;
const DEFAULT_PRACTICE_TIMER_SECONDS = 60;
const MIN_PRACTICE_TIMER_SECONDS = 10;
const MAX_PRACTICE_TIMER_SECONDS = 120;
const REPLAY_ANALYSIS_TIMEOUT_MS = 7_000;
const REPLAY_ANALYSIS_DEFAULT_VISIBLE_OPTIONS = 3;
const PRACTICE_TIMER_WARNING_SECONDS = 5;
const DEFAULT_FLIP_REVEAL_MS = 1_000;
const CLAIM_WORD_ANIMATION_MS = 1_100;
const MAX_LOG_ENTRIES = 300;
const CLAIM_FAILURE_WINDOW_MS = 4_000;
const CUSTOM_PUZZLE_CENTER_LETTER_MIN = 1;
const CUSTOM_PUZZLE_CENTER_LETTER_MAX = 16;
const CUSTOM_PUZZLE_EXISTING_WORD_COUNT_MAX = 8;
const CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MIN = 4;
const CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MAX = 16;
const CUSTOM_PUZZLE_TOTAL_CHARACTERS_MAX = 96;
const CUSTOM_PUZZLE_VALIDATION_TIMEOUT_MS = 5_000;
const REPLAY_FILE_INPUT_ACCEPT = "application/json,.json";
const ADMIN_REFRESH_INTERVAL_MS = 10_000;
const CLAIM_FAILURE_MESSAGES = new Set([
  "Claim window expired.",
  "Enter a word to claim.",
  "Word must contain only letters A-Z.",
  "Word is not valid.",
  "Not enough tiles in the center to make that word."
]);

function createInactivePracticeState(
  difficulty: PracticeDifficulty = DEFAULT_PRACTICE_DIFFICULTY
): PracticeModeState {
  return {
    active: false,
    phase: "puzzle",
    currentDifficulty: difficulty,
    queuedDifficulty: difficulty,
    timerEnabled: false,
    timerSeconds: DEFAULT_PRACTICE_TIMER_SECONDS,
    puzzleTimerEndsAt: null,
    puzzle: null,
    result: null
  };
}

type GameLogKind = "event" | "error";

type GameLogEntry = {
  id: string;
  timestamp: number;
  text: string;
  kind: GameLogKind;
};

type WordSnapshot = {
  id: string;
  text: string;
  tileIds: string[];
  ownerId: string;
  createdAt: number;
};

type PendingGameLogEntry = {
  text: string;
  kind: GameLogKind;
  timestamp?: number;
};

type ClaimFailureContext = {
  message: string;
  at: number;
};

type WordHighlightKind = "claim" | "steal";

type EditorPuzzleDraft = {
  payload: PracticeSharePayload | null;
  validationMessage: string | null;
  normalizedCenter: string;
  normalizedExistingWords: string[];
};

type ReplaySource =
  | {
      kind: "room";
      replay: GameReplay;
    }
  | {
      kind: "imported";
      file: ReplayFileV1;
    };

function clampFlipTimerSeconds(value: number) {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) return DEFAULT_FLIP_TIMER_SECONDS;
  return Math.min(MAX_FLIP_TIMER_SECONDS, Math.max(MIN_FLIP_TIMER_SECONDS, rounded));
}

function clampClaimTimerSeconds(value: number) {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) return DEFAULT_CLAIM_TIMER_SECONDS;
  return Math.min(MAX_CLAIM_TIMER_SECONDS, Math.max(MIN_CLAIM_TIMER_SECONDS, rounded));
}

function clampPracticeDifficulty(value: number): PracticeDifficulty {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) return DEFAULT_PRACTICE_DIFFICULTY;
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as PracticeDifficulty;
}

function clampPracticeTimerSeconds(value: number): number {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) return DEFAULT_PRACTICE_TIMER_SECONDS;
  return Math.min(MAX_PRACTICE_TIMER_SECONDS, Math.max(MIN_PRACTICE_TIMER_SECONDS, rounded));
}

function formatLogTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

async function readJsonResponse(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && typeof (payload as { message?: unknown }).message === "string") {
    return (payload as { message: string }).message;
  }
  return fallback;
}

function isAdminEndGameWarningResponse(payload: unknown): payload is AdminEndGameWarningResponse {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<AdminEndGameWarningResponse>;
  if (candidate.ok !== false) return false;
  if (candidate.requiresAcknowledgement !== true) return false;
  if (typeof candidate.roomId !== "string" || !candidate.roomId) return false;
  if (!Array.isArray(candidate.onlinePlayers)) return false;
  return true;
}

function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return "n/a";
  return new Date(timestamp).toLocaleString();
}

function getPracticeResultCategory(result: PracticeResult): {
  key: "perfect" | "amazing" | "great" | "good" | "ok" | "better-luck-next-time";
  label: string;
} {
  if (result.score <= 0) {
    return {
      key: "better-luck-next-time",
      label: "Better luck next time"
    };
  }
  if (result.bestScore <= 0 || result.score === result.bestScore) {
    return {
      key: "perfect",
      label: "Perfect"
    };
  }

  const ratio = result.score / result.bestScore;
  if (ratio >= 0.9) {
    return { key: "amazing", label: "Amazing" };
  }
  if (ratio >= 0.75) {
    return { key: "great", label: "Great" };
  }
  if (ratio >= 0.5) {
    return { key: "good", label: "Good" };
  }
  return { key: "ok", label: "OK" };
}

function getPlayerName<TPlayer extends { id: string; name: string }>(
  players: TPlayer[],
  playerId: string | null | undefined
) {
  if (!playerId) return "Unknown";
  return players.find((player) => player.id === playerId)?.name ?? "Unknown";
}

function getWordSnapshots(players: Array<{ id: string; words: { id: string; text: string; tileIds: string[]; createdAt: number }[] }>): WordSnapshot[] {
  const snapshots: WordSnapshot[] = [];
  for (const player of players) {
    for (const word of player.words) {
      snapshots.push({
        id: word.id,
        text: word.text,
        tileIds: word.tileIds,
        ownerId: player.id,
        createdAt: word.createdAt
      });
    }
  }
  return snapshots;
}

function findReplacedWord(addedWord: WordSnapshot, removedWords: WordSnapshot[]) {
  const matches = removedWords.filter((word) =>
    word.tileIds.every((tileId) => addedWord.tileIds.includes(tileId))
  );
  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    if (a.tileIds.length !== b.tileIds.length) {
      return b.tileIds.length - a.tileIds.length;
    }
    return a.createdAt - b.createdAt;
  });

  return matches[0];
}

function appendPreStealLogContext(
  text: string,
  state: Pick<GameState, "lastClaimEvent">,
  wordId: string
): string {
  const claimEvent = state.lastClaimEvent;
  if (!claimEvent || claimEvent.wordId !== wordId || claimEvent.source !== "pre-steal") {
    return text;
  }

  const textWithoutPeriod = text.endsWith(".") ? text.slice(0, -1) : text;
  if (claimEvent.movedToBottomOfPreStealPrecedence) {
    return `${textWithoutPeriod} via pre-steal. Moved to bottom of pre-steal precedence.`;
  }
  return `${textWithoutPeriod} via pre-steal.`;
}

function reorderEntriesById<T extends { id: string }>(items: T[], draggedId: string, targetId: string): T[] {
  if (draggedId === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1) return items;

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

function buildReplayActionText(
  replaySteps: NonNullable<GameState["replay"]>["steps"],
  stepIndex: number
): string {
  const step = replaySteps[stepIndex];
  if (!step) return "No replay action.";

  const currentState = step.state;
  const previousState = stepIndex > 0 ? replaySteps[stepIndex - 1]?.state ?? null : null;

  if (step.kind === "flip-revealed") {
    const previousCenterTileIds = new Set(previousState?.centerTiles.map((tile) => tile.id) ?? []);
    const addedTiles = currentState.centerTiles.filter((tile) => !previousCenterTileIds.has(tile.id));
    const flipperId = previousState?.pendingFlip?.playerId ?? previousState?.turnPlayerId ?? null;
    const flipperName = getPlayerName(previousState?.players ?? currentState.players, flipperId);
    if (addedTiles.length === 0) {
      return `${flipperName} flipped a tile.`;
    }
    return addedTiles.map((tile) => `${flipperName} flipped ${tile.letter}.`).join(" ");
  }

  if (step.kind === "claim-succeeded") {
    if (!previousState) {
      return "A word was claimed.";
    }

    const previousWords = getWordSnapshots(previousState.players);
    const currentWords = getWordSnapshots(currentState.players);
    const previousWordMap = new Map(previousWords.map((word) => [word.id, word]));
    const removedWords = previousWords.filter(
      (word) => !currentWords.some((currentWord) => currentWord.id === word.id)
    );
    const addedWords = currentWords
      .filter((word) => !previousWordMap.has(word.id))
      .sort((a, b) => a.createdAt - b.createdAt);

    const lines: string[] = [];
    for (const addedWord of addedWords) {
      const claimantName = getPlayerName(currentState.players, addedWord.ownerId);
      const replacedWord = findReplacedWord(addedWord, removedWords);
      if (!replacedWord) {
        lines.push(appendPreStealLogContext(`${claimantName} claimed ${addedWord.text}.`, currentState, addedWord.id));
        continue;
      }

      const removedWordIndex = removedWords.findIndex((word) => word.id === replacedWord.id);
      if (removedWordIndex !== -1) {
        removedWords.splice(removedWordIndex, 1);
      }

      if (replacedWord.ownerId === addedWord.ownerId) {
        lines.push(
          appendPreStealLogContext(
            `${claimantName} extended ${replacedWord.text} to ${addedWord.text}.`,
            currentState,
            addedWord.id
          )
        );
      } else {
        const stolenFromName = getPlayerName(currentState.players, replacedWord.ownerId);
        lines.push(
          appendPreStealLogContext(
            `${claimantName} stole ${replacedWord.text} from ${stolenFromName} with ${addedWord.text}.`,
            currentState,
            addedWord.id
          )
        );
      }
    }

    if (lines.length > 0) {
      return lines.join(" ");
    }
    return "A word was claimed.";
  }

  return "Replay action.";
}

function buildPracticeSharePayloadFromReplayState(state: ReplayStateSnapshot): PracticeSharePayload {
  const centerLetters = state.centerTiles
    .map((tile) => normalizeEditorText(tile.letter))
    .filter((letter) => letter.length === 1 && LETTER_PATTERN.test(letter))
    .join("");
  const existingWords = state.players.flatMap((player) =>
    player.words
      .map((word) => normalizeEditorText(word.text))
      .filter((word) => word.length > 0 && LETTER_PATTERN.test(word))
  );

  return {
    v: 2,
    d: DEFAULT_PRACTICE_DIFFICULTY,
    c: centerLetters,
    w: existingWords
  };
}

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => {
    if (typeof window === "undefined") return "/";
    return window.location.pathname;
  });
  const isAdminPath = currentPath === "/admin" || currentPath === "/admin/";

  const [isConnected, setIsConnected] = useState(socket.connected);
  const [selfPlayerId, setSelfPlayerId] = useState<string | null>(null);
  const [roomList, setRoomList] = useState<RoomSummary[]>([]);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [replayStepIndex, setReplayStepIndex] = useState(0);
  const [replaySource, setReplaySource] = useState<ReplaySource | null>(null);
  const [importReplayError, setImportReplayError] = useState<string | null>(null);
  const [replayPuzzleError, setReplayPuzzleError] = useState<string | null>(null);
  const [isReplayAnalysisOpen, setIsReplayAnalysisOpen] = useState(false);
  const [replayAnalysisByStepIndex, setReplayAnalysisByStepIndex] = useState<
    Record<number, ReplayAnalysisResult>
  >({});
  const [importedReplayAnalysisByStepIndex, setImportedReplayAnalysisByStepIndex] = useState<
    Record<number, ReplayAnalysisResult>
  >({});
  const [replayAnalysisLoadingStepIndex, setReplayAnalysisLoadingStepIndex] = useState<number | null>(null);
  const [replayAnalysisError, setReplayAnalysisError] = useState<string | null>(null);
  const [showAllReplayOptionsByStep, setShowAllReplayOptionsByStep] = useState<Record<number, boolean>>({});
  const [practiceState, setPracticeState] = useState<PracticeModeState>(() =>
    createInactivePracticeState()
  );
  const [pendingSharedLaunch, setPendingSharedLaunch] = useState<PendingSharedLaunch | null>(() =>
    readPendingSharedLaunchFromUrl()
  );
  const [pendingPrivateRoomJoin, setPendingPrivateRoomJoin] = useState<PendingPrivateRoomJoin | null>(() =>
    readPendingPrivateRoomJoinFromUrl()
  );
  const [pendingResultAutoSubmit, setPendingResultAutoSubmit] = useState<PendingResultAutoSubmit | null>(null);
  const [gameLogEntries, setGameLogEntries] = useState<GameLogEntry[]>([]);
  const [claimedWordHighlights, setClaimedWordHighlights] = useState<Record<string, WordHighlightKind>>({});

  const [playerName, setPlayerName] = useState(() => readStoredPlayerName());
  const [nameDraft, setNameDraft] = useState(() => readStoredPlayerName());
  const [editNameDraft, setEditNameDraft] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [userSettings, setUserSettings] = useState<UserSettings>(() => readStoredUserSettings());
  const [userSettingsDraft, setUserSettingsDraft] = useState<UserSettings>(() => readStoredUserSettings());
  const [lobbyView, setLobbyView] = useState<"list" | "create" | "editor">("list");
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [adminTokenDraft, setAdminTokenDraft] = useState("");
  const [adminSessionToken, setAdminSessionToken] = useState<string | null>(null);
  const [adminSessionExpiresAt, setAdminSessionExpiresAt] = useState<number | null>(null);
  const [adminGamesResponse, setAdminGamesResponse] = useState<AdminGamesResponse | null>(null);
  const [adminGamesLoading, setAdminGamesLoading] = useState(false);
  const [adminLoginLoading, setAdminLoginLoading] = useState(false);
  const [adminCleanupLoading, setAdminCleanupLoading] = useState(false);
  const [adminEndingRoomId, setAdminEndingRoomId] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminStatusMessage, setAdminStatusMessage] = useState<string | null>(null);

  const [createRoomName, setCreateRoomName] = useState("");
  const [createPublic, setCreatePublic] = useState(true);
  const [createMaxPlayers, setCreateMaxPlayers] = useState(8);
  const [createFlipTimerEnabled, setCreateFlipTimerEnabled] = useState(false);
  const [createFlipTimerSeconds, setCreateFlipTimerSeconds] = useState(DEFAULT_FLIP_TIMER_SECONDS);
  const [createClaimTimerSeconds, setCreateClaimTimerSeconds] = useState(DEFAULT_CLAIM_TIMER_SECONDS);
  const [createPreStealEnabled, setCreatePreStealEnabled] = useState(false);

  const [privateInviteCopyStatus, setPrivateInviteCopyStatus] = useState<"copied" | "failed" | null>(null);
  const [showLeaveGameConfirm, setShowLeaveGameConfirm] = useState(false);
  const [showPracticeStartPrompt, setShowPracticeStartPrompt] = useState(false);
  const [practiceStartDifficulty, setPracticeStartDifficulty] = useState<PracticeDifficulty | null>(null);
  const [practiceStartTimerEnabled, setPracticeStartTimerEnabled] = useState(false);
  const [practiceStartTimerSeconds, setPracticeStartTimerSeconds] = useState(DEFAULT_PRACTICE_TIMER_SECONDS);
  const [editorDifficulty, setEditorDifficulty] = useState<PracticeDifficulty>(DEFAULT_PRACTICE_DIFFICULTY);
  const [editorCenterInput, setEditorCenterInput] = useState("");
  const [editorExistingWordsInput, setEditorExistingWordsInput] = useState("");
  const [editorValidationMessageFromServer, setEditorValidationMessageFromServer] = useState<string | null>(null);
  const [editorShareStatus, setEditorShareStatus] = useState<"copied" | "failed" | null>(null);
  const [isEditorShareValidationInFlight, setIsEditorShareValidationInFlight] = useState(false);

  const [claimWord, setClaimWord] = useState("");
  const [queuedTileClaimLetters, setQueuedTileClaimLetters] = useState("");
  const [preStealTriggerInput, setPreStealTriggerInput] = useState("");
  const [preStealClaimWordInput, setPreStealClaimWordInput] = useState("");
  const [preStealDraggedEntryId, setPreStealDraggedEntryId] = useState<string | null>(null);
  const [practiceWord, setPracticeWord] = useState("");
  const [practiceSubmitError, setPracticeSubmitError] = useState<string | null>(null);
  const [practiceShareStatus, setPracticeShareStatus] = useState<"copied" | "failed" | null>(null);
  const [practiceResultShareStatus, setPracticeResultShareStatus] = useState<"copied" | "failed" | null>(null);
  const [showAllPracticeOptions, setShowAllPracticeOptions] = useState(false);
  const claimInputRef = useRef<HTMLInputElement>(null);
  const practiceInputRef = useRef<HTMLInputElement>(null);
  const replayImportInputRef = useRef<HTMLInputElement>(null);
  const gameLogListRef = useRef<HTMLDivElement>(null);
  const previousGameStateRef = useRef<GameState | null>(null);
  const lastClaimFailureRef = useRef<ClaimFailureContext | null>(null);
  const roomStatusRef = useRef<RoomState["status"] | null>(null);
  const hasGameStateRef = useRef(false);
  const practiceModeRef = useRef<{ active: boolean; phase: PracticeModeState["phase"] }>({
    active: false,
    phase: "puzzle"
  });
  const previousRoomIdRef = useRef<string | null>(null);
  const claimAnimationTimeoutsRef = useRef<Map<string, number>>(new Map());
  const practiceShareStatusTimeoutRef = useRef<number | null>(null);
  const practiceResultShareStatusTimeoutRef = useRef<number | null>(null);
  const editorShareStatusTimeoutRef = useRef<number | null>(null);
  const privateInviteCopyStatusTimeoutRef = useRef<number | null>(null);

  const [now, setNow] = useState(Date.now());

  const appendGameLogEntries = useCallback((entries: PendingGameLogEntry[]) => {
    if (entries.length === 0) return;
    setGameLogEntries((current) => {
      const nextEntries = entries.map((entry) => ({
        id: generateId(),
        timestamp: entry.timestamp ?? Date.now(),
        text: entry.text,
        kind: entry.kind
      }));
      const next = [...current, ...nextEntries];
      if (next.length <= MAX_LOG_ENTRIES) return next;
      return next.slice(next.length - MAX_LOG_ENTRIES);
    });
  }, []);

  const clearClaimWordHighlights = useCallback(() => {
    claimAnimationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    claimAnimationTimeoutsRef.current.clear();
    setClaimedWordHighlights({});
  }, []);

  const markClaimedWordForAnimation = useCallback((wordId: string, kind: WordHighlightKind = "claim") => {
    setClaimedWordHighlights((current) => ({ ...current, [wordId]: kind }));
    const existingTimeoutId = claimAnimationTimeoutsRef.current.get(wordId);
    if (existingTimeoutId !== undefined) {
      window.clearTimeout(existingTimeoutId);
    }

    const timeoutId = window.setTimeout(() => {
      setClaimedWordHighlights((current) => {
        if (!(wordId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[wordId];
        return next;
      });
      claimAnimationTimeoutsRef.current.delete(wordId);
    }, CLAIM_WORD_ANIMATION_MS);

    claimAnimationTimeoutsRef.current.set(wordId, timeoutId);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      claimAnimationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      claimAnimationTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (practiceShareStatusTimeoutRef.current !== null) {
        window.clearTimeout(practiceShareStatusTimeoutRef.current);
        practiceShareStatusTimeoutRef.current = null;
      }
      if (practiceResultShareStatusTimeoutRef.current !== null) {
        window.clearTimeout(practiceResultShareStatusTimeoutRef.current);
        practiceResultShareStatusTimeoutRef.current = null;
      }
      if (editorShareStatusTimeoutRef.current !== null) {
        window.clearTimeout(editorShareStatusTimeoutRef.current);
        editorShareStatusTimeoutRef.current = null;
      }
      if (privateInviteCopyStatusTimeoutRef.current !== null) {
        window.clearTimeout(privateInviteCopyStatusTimeoutRef.current);
        privateInviteCopyStatusTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    roomStatusRef.current = roomState?.status ?? null;
    hasGameStateRef.current = Boolean(gameState);
  }, [roomState?.status, gameState]);

  useEffect(() => {
    practiceModeRef.current = {
      active: practiceState.active,
      phase: practiceState.phase
    };
  }, [practiceState.active, practiceState.phase]);

  useEffect(() => {
    const onConnect = () => {
      setIsConnected(true);
      socket.emit("room:list");
    };
    const onDisconnect = () => setIsConnected(false);
    const onRoomList = (rooms: RoomSummary[]) => setRoomList(rooms);
    const onRoomState = (state: RoomState) => setRoomState(state);
    const onGameState = (state: GameState) => setGameState(state);
    const onPracticeState = (state: PracticeModeState) => setPracticeState(state);
    const onError = ({ message }: { message: string }) => {
      if (practiceModeRef.current.active && practiceModeRef.current.phase === "puzzle") {
        setPracticeSubmitError(message);
        return;
      }

      if (roomStatusRef.current !== "in-game" || !hasGameStateRef.current) {
        setPendingResultAutoSubmit(null);
        setLobbyError(message);
        return;
      }

      const timestamp = Date.now();
      if (CLAIM_FAILURE_MESSAGES.has(message)) {
        lastClaimFailureRef.current = { message, at: timestamp };
      }

      appendGameLogEntries([{ text: message, kind: "error", timestamp }]);
    };
    const onSessionSelf = ({
      playerId,
      name
    }: {
      playerId: string;
      name: string;
      roomId: string | null;
    }) => {
      setSelfPlayerId(playerId);
      if (playerName.trim()) {
        const sanitizedLocalName = sanitizeClientName(playerName);
        if (sanitizedLocalName !== playerName) {
          setPlayerName(sanitizedLocalName);
          setNameDraft(sanitizedLocalName);
          setEditNameDraft(sanitizedLocalName);
          persistPlayerName(sanitizedLocalName);
        }
        if (sanitizedLocalName !== name) {
          socket.emit("session:update-name", { name: sanitizedLocalName });
        }
        return;
      }
      const resolvedName = sanitizeClientName(name);
      if (resolvedName === "Player") return;
      setPlayerName(resolvedName);
      setNameDraft(resolvedName);
      setEditNameDraft(resolvedName);
      persistPlayerName(resolvedName);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:list", onRoomList);
    socket.on("room:state", onRoomState);
    socket.on("game:state", onGameState);
    socket.on("practice:state", onPracticeState);
    socket.on("session:self", onSessionSelf);
    socket.on("error", onError);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:list", onRoomList);
      socket.off("room:state", onRoomState);
      socket.off("game:state", onGameState);
      socket.off("practice:state", onPracticeState);
      socket.off("session:self", onSessionSelf);
      socket.off("error", onError);
    };
  }, [appendGameLogEntries, playerName]);

  const currentPlayers: Player[] = useMemo(() => {
    if (gameState) return gameState.players;
    if (roomState) return roomState.players;
    return [];
  }, [gameState, roomState]);
  const myPreStealEntries = useMemo(() => {
    if (!gameState || !selfPlayerId) return [];
    return gameState.players.find((player) => player.id === selfPlayerId)?.preStealEntries ?? [];
  }, [gameState, selfPlayerId]);
  const preStealPrecedencePlayers = useMemo(() => {
    if (!gameState) return [];
    return gameState.preStealPrecedenceOrder
      .map((playerId) => gameState.players.find((player) => player.id === playerId))
      .filter((player): player is Player => Boolean(player));
  }, [gameState]);
  const spectatorPreStealPlayers = useMemo(() => {
    if (!gameState) return [];
    return gameState.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected,
      preStealEntries: player.preStealEntries
    }));
  }, [gameState]);

  const openLobbyRooms = useMemo(() => roomList.filter((room) => room.status === "lobby"), [roomList]);
  const inProgressLobbyRooms = useMemo(
    () => roomList.filter((room) => room.status === "in-game"),
    [roomList]
  );
  const adminGames = adminGamesResponse?.games ?? [];
  const adminOfflineGames = adminGamesResponse?.offlineGames ?? [];
  const userSettingsContextValue = useMemo(
    () => buildUserSettingsContextValue(userSettings),
    [userSettings]
  );
  const isTileInputMethodEnabled = userSettingsContextValue.isTileInputMethodEnabled;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", userSettings.theme);
    document.documentElement.style.colorScheme = userSettings.theme;
  }, [userSettings.theme]);

  const endTimerRemaining = useMemo(() => {
    if (!gameState?.endTimerEndsAt) return null;
    const remaining = Math.max(0, Math.ceil((gameState.endTimerEndsAt - now) / 1000));
    return remaining;
  }, [gameState?.endTimerEndsAt, now]);

  const isHost = roomState?.hostId === selfPlayerId;
  const isInGame = roomState?.status === "in-game" && gameState;
  const isSpectator = useMemo(() => {
    if (!roomState || !gameState || !selfPlayerId) return false;
    return !gameState.players.some((player) => player.id === selfPlayerId);
  }, [roomState, gameState, selfPlayerId]);
  const pendingFlip = gameState?.pendingFlip ?? null;
  const isFlipRevealActive = pendingFlip !== null;
  const flipRevealDurationMs = pendingFlip
    ? Math.max(1, pendingFlip.revealsAt - pendingFlip.startedAt)
    : DEFAULT_FLIP_REVEAL_MS;
  const flipRevealElapsedMs = pendingFlip
    ? Math.max(0, Math.min(flipRevealDurationMs, now - pendingFlip.startedAt))
    : 0;
  const flipRevealPlayerName = useMemo(() => {
    if (!pendingFlip || !gameState) return "Unknown";
    return getPlayerName(gameState.players, pendingFlip.playerId);
  }, [pendingFlip, gameState]);
  const claimWindow = gameState?.claimWindow ?? null;
  const isMyClaimWindow = claimWindow?.playerId === selfPlayerId;
  const claimTimerSeconds = roomState?.claimTimer.seconds ?? DEFAULT_CLAIM_TIMER_SECONDS;
  const claimWindowRemainingMs = useMemo(() => {
    if (!claimWindow) return null;
    return Math.max(0, claimWindow.endsAt - now);
  }, [claimWindow, now]);
  const claimWindowRemainingSeconds =
    claimWindowRemainingMs === null ? null : Math.max(0, Math.ceil(claimWindowRemainingMs / 1000));
  const claimProgress =
    claimWindowRemainingMs === null
      ? 0
      : Math.max(
          0,
          Math.min(1, claimWindowRemainingMs / (claimTimerSeconds * 1000))
        );
  const claimCooldownEndsAt = selfPlayerId ? gameState?.claimCooldowns?.[selfPlayerId] : null;
  const claimCooldownRemainingMs =
    claimCooldownEndsAt && claimCooldownEndsAt > now ? claimCooldownEndsAt - now : null;
  const claimCooldownRemainingSeconds =
    claimCooldownRemainingMs === null ? null : Math.max(0, Math.ceil(claimCooldownRemainingMs / 1000));
  const isClaimCooldownActive = claimCooldownRemainingMs !== null;
  const claimWindowPlayerName = useMemo(() => {
    if (!claimWindow || !gameState) return "Unknown";
    return gameState.players.find((player) => player.id === claimWindow.playerId)?.name ?? "Unknown";
  }, [claimWindow, gameState]);
  const claimStatus = useMemo(() => {
    if (isSpectator) {
      return "Spectating (read-only)";
    }
    if (isFlipRevealActive) {
      return `${flipRevealPlayerName} is revealing a tile...`;
    }
    if (claimWindow && claimWindowRemainingSeconds !== null) {
      if (isMyClaimWindow) {
        return `Your claim window: ${claimWindowRemainingSeconds}s`;
      }
      return `${claimWindowPlayerName} is claiming (${claimWindowRemainingSeconds}s)`;
    }
    if (isClaimCooldownActive && claimCooldownRemainingSeconds !== null) {
      return `Cooldown: ${claimCooldownRemainingSeconds}s or next flip.`;
    }
    return isTileInputMethodEnabled
      ? "Click or tap tiles to build a claim"
      : "Press enter to claim a word";
  }, [
    isSpectator,
    isFlipRevealActive,
    flipRevealPlayerName,
    claimWindow,
    claimWindowRemainingSeconds,
    isMyClaimWindow,
    claimWindowPlayerName,
    isClaimCooldownActive,
    claimCooldownRemainingSeconds,
    isTileInputMethodEnabled
  ]);
  const claimPlaceholder = claimStatus;
  const claimButtonLabel = isSpectator ? "Spectating" : isMyClaimWindow ? "Submit Claim" : "Start Claim";
  const isClaimButtonDisabled = isMyClaimWindow
    ? !claimWord.trim() || isFlipRevealActive
    : Boolean(claimWindow) || isClaimCooldownActive || isFlipRevealActive || isSpectator;
  const isClaimInputDisabled = !isMyClaimWindow || isClaimCooldownActive || isFlipRevealActive || isSpectator;
  const isTileSelectionEnabled = isTileInputMethodEnabled && !isSpectator;
  const shouldShowGameLog = Boolean(gameState) && roomState?.status === "in-game";
  const roomReplay = gameState?.replay ?? null;
  const roomReplaySteps = useMemo(
    () =>
      (roomReplay?.steps ?? []).filter(
        (step) => step.kind === "flip-revealed" || step.kind === "claim-succeeded"
      ),
    [roomReplay?.steps]
  );
  const activeReplay =
    replaySource?.kind === "imported"
      ? replaySource.file.replay
      : replaySource?.kind === "room"
        ? replaySource.replay
        : null;
  const replaySteps = useMemo(
    () =>
      (activeReplay?.steps ?? []).filter(
        (step) => step.kind === "flip-revealed" || step.kind === "claim-succeeded"
      ),
    [activeReplay?.steps]
  );
  const maxReplayStepIndex = replaySteps.length > 0 ? replaySteps.length - 1 : 0;
  const clampedReplayStepIndex = Math.min(Math.max(replayStepIndex, 0), maxReplayStepIndex);
  const activeReplayStep = replaySteps[clampedReplayStepIndex] ?? null;
  const activeReplayState: ReplayStateSnapshot | null = activeReplayStep?.state ?? null;
  const activeReplayActionText = useMemo(
    () => buildReplayActionText(replaySteps, clampedReplayStepIndex),
    [replaySteps, clampedReplayStepIndex]
  );
  const activeReplayRequestedStepIndex = activeReplayStep?.index ?? null;
  const activeImportedReplayAnalysis =
    replaySource?.kind === "imported" && activeReplayRequestedStepIndex !== null
      ? importedReplayAnalysisByStepIndex[activeReplayRequestedStepIndex] ??
        getImportedReplayAnalysis(replaySource.file, activeReplayRequestedStepIndex)
      : null;
  const activeReplayAnalysis =
    activeReplayRequestedStepIndex === null
      ? null
      : replaySource?.kind === "imported"
        ? activeImportedReplayAnalysis
        : replayAnalysisByStepIndex[activeReplayRequestedStepIndex] ?? null;
  const isActiveReplayAnalysisLoading =
    activeReplayRequestedStepIndex !== null &&
    replayAnalysisLoadingStepIndex === activeReplayRequestedStepIndex;
  const {
    visibleReplayAnalysisOptions,
    hiddenReplayAnalysisOptionCount
  } = useMemo(() => {
    if (!activeReplayAnalysis) {
      return {
        visibleReplayAnalysisOptions: [] as PracticeScoredWord[],
        hiddenReplayAnalysisOptionCount: 0
      };
    }

    const requestedStepIndex = activeReplayAnalysis.requestedStepIndex;
    const showAll = Boolean(showAllReplayOptionsByStep[requestedStepIndex]);
    if (showAll) {
      return {
        visibleReplayAnalysisOptions: activeReplayAnalysis.allOptions,
        hiddenReplayAnalysisOptionCount: 0
      };
    }

    const visibleCount = Math.min(
      REPLAY_ANALYSIS_DEFAULT_VISIBLE_OPTIONS,
      activeReplayAnalysis.allOptions.length
    );
    return {
      visibleReplayAnalysisOptions: activeReplayAnalysis.allOptions.slice(0, visibleCount),
      hiddenReplayAnalysisOptionCount: Math.max(0, activeReplayAnalysis.allOptions.length - visibleCount)
    };
  }, [activeReplayAnalysis, showAllReplayOptionsByStep]);
  const canExportReplay = Boolean(
    roomState?.status === "ended" && replaySource?.kind === "room" && roomReplay
  );
  const replayTurnPlayerName = activeReplayState
    ? getPlayerName(activeReplayState.players, activeReplayState.turnPlayerId)
    : "Unknown";
  const replayPreStealPlayers = useMemo(() => {
    if (!activeReplayState) return [];
    return activeReplayState.players.map((player) => ({
      id: player.id,
      name: player.name,
      preStealEntries: player.preStealEntries
    }));
  }, [activeReplayState]);
  const replayPreStealPrecedencePlayers = useMemo(() => {
    if (!activeReplayState) return [];
    return activeReplayState.preStealPrecedenceOrder
      .map((playerId) => activeReplayState.players.find((player) => player.id === playerId))
      .filter((player): player is ReplayPlayerSnapshot => Boolean(player));
  }, [activeReplayState]);
  const gameOverStandings = useMemo(() => {
    if (!gameState) {
      return { players: [] as Player[], winningScore: null as number | null };
    }

    const players = gameState.players.slice().sort((a, b) => b.score - a.score);
    const winningScore = players.length > 0 ? players[0].score : null;
    return { players, winningScore };
  }, [gameState]);
  const isInPractice = !roomState && practiceState.active;
  const practicePuzzle = practiceState.puzzle;
  const practiceResult = practiceState.result;
  const practiceTimerRemainingMs = useMemo(() => {
    if (!practiceState.active) return null;
    if (practiceState.phase !== "puzzle") return null;
    if (!practiceState.timerEnabled) return null;
    if (!practiceState.puzzleTimerEndsAt) return null;
    return Math.max(0, practiceState.puzzleTimerEndsAt - now);
  }, [
    practiceState.active,
    practiceState.phase,
    practiceState.timerEnabled,
    practiceState.puzzleTimerEndsAt,
    now
  ]);
  const practiceTimerRemainingSeconds =
    practiceTimerRemainingMs === null ? null : Math.max(0, Math.ceil(practiceTimerRemainingMs / 1000));
  const practiceTimerProgress =
    practiceTimerRemainingMs === null
      ? 0
      : Math.max(0, Math.min(1, practiceTimerRemainingMs / (practiceState.timerSeconds * 1000)));
  const isPracticeTimerWarning =
    practiceTimerRemainingSeconds !== null && practiceTimerRemainingSeconds <= PRACTICE_TIMER_WARNING_SECONDS;
  const practiceResultCategory = useMemo(
    () => (practiceResult ? getPracticeResultCategory(practiceResult) : null),
    [practiceResult]
  );
  const {
    visiblePracticeOptions,
    hiddenPracticeOptionCount
  } = useMemo(() => {
    if (!practiceResult) {
      return {
        visiblePracticeOptions: [] as PracticeScoredWord[],
        hiddenPracticeOptionCount: 0
      };
    }

    const allOptions = practiceResult.allOptions;
    if (showAllPracticeOptions) {
      return {
        visiblePracticeOptions: allOptions,
        hiddenPracticeOptionCount: 0
      };
    }

    const submittedScore = practiceResult.score;
    const firstLowerScoringIndex = allOptions.findIndex((option) => option.score < submittedScore);
    const minimumVisibleCount = Math.min(3, allOptions.length);
    const visibleCount = Math.min(
      allOptions.length,
      Math.max(minimumVisibleCount, firstLowerScoringIndex === -1 ? allOptions.length : firstLowerScoringIndex)
    );

    return {
      visiblePracticeOptions: allOptions.slice(0, visibleCount),
      hiddenPracticeOptionCount: allOptions.length - visibleCount
    };
  }, [practiceResult, showAllPracticeOptions]);

  const editorPuzzleDraft: EditorPuzzleDraft = useMemo(() => {
    const normalizedCenter = normalizeEditorText(editorCenterInput);
    const normalizedExistingWords = editorExistingWordsInput
      .split(/\r?\n/)
      .map((line) => normalizeEditorText(line))
      .filter((line) => line.length > 0);

    if (!normalizedCenter) {
      return {
        payload: null,
        validationMessage: "Enter at least one center tile letter.",
        normalizedCenter,
        normalizedExistingWords
      };
    }

    if (!LETTER_PATTERN.test(normalizedCenter)) {
      return {
        payload: null,
        validationMessage: "Center tiles must contain only letters A-Z.",
        normalizedCenter,
        normalizedExistingWords
      };
    }

    if (
      normalizedCenter.length < CUSTOM_PUZZLE_CENTER_LETTER_MIN ||
      normalizedCenter.length > CUSTOM_PUZZLE_CENTER_LETTER_MAX
    ) {
      return {
        payload: null,
        validationMessage: `Center tiles must be ${CUSTOM_PUZZLE_CENTER_LETTER_MIN}-${CUSTOM_PUZZLE_CENTER_LETTER_MAX} letters.`,
        normalizedCenter,
        normalizedExistingWords
      };
    }

    if (normalizedExistingWords.length > CUSTOM_PUZZLE_EXISTING_WORD_COUNT_MAX) {
      return {
        payload: null,
        validationMessage: `Use at most ${CUSTOM_PUZZLE_EXISTING_WORD_COUNT_MAX} existing words.`,
        normalizedCenter,
        normalizedExistingWords
      };
    }

    let totalCharacters = normalizedCenter.length;
    for (const word of normalizedExistingWords) {
      if (!LETTER_PATTERN.test(word)) {
        return {
          payload: null,
          validationMessage: "Existing words must contain only letters A-Z.",
          normalizedCenter,
          normalizedExistingWords
        };
      }
      if (
        word.length < CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MIN ||
        word.length > CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MAX
      ) {
        return {
          payload: null,
          validationMessage: `Each existing word must be ${CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MIN}-${CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MAX} letters.`,
          normalizedCenter,
          normalizedExistingWords
        };
      }
      totalCharacters += word.length;
      if (totalCharacters > CUSTOM_PUZZLE_TOTAL_CHARACTERS_MAX) {
        return {
          payload: null,
          validationMessage: `Total characters across center tiles and existing words must be at most ${CUSTOM_PUZZLE_TOTAL_CHARACTERS_MAX}.`,
          normalizedCenter,
          normalizedExistingWords
        };
      }
    }

    return {
      payload: {
        v: 2,
        d: editorDifficulty,
        c: normalizedCenter,
        w: normalizedExistingWords
      },
      validationMessage: null,
      normalizedCenter,
      normalizedExistingWords
    };
  }, [editorCenterInput, editorDifficulty, editorExistingWordsInput]);

  const showEditorShareStatus = useCallback((status: "copied" | "failed") => {
    setEditorShareStatus(status);
    if (editorShareStatusTimeoutRef.current !== null) {
      window.clearTimeout(editorShareStatusTimeoutRef.current);
    }
    editorShareStatusTimeoutRef.current = window.setTimeout(() => {
      setEditorShareStatus(null);
      editorShareStatusTimeoutRef.current = null;
    }, 2_500);
  }, []);

  const showPracticeShareStatus = useCallback((status: "copied" | "failed") => {
    setPracticeShareStatus(status);
    if (practiceShareStatusTimeoutRef.current !== null) {
      window.clearTimeout(practiceShareStatusTimeoutRef.current);
    }
    practiceShareStatusTimeoutRef.current = window.setTimeout(() => {
      setPracticeShareStatus(null);
      practiceShareStatusTimeoutRef.current = null;
    }, 2_500);
  }, []);

  const showPracticeResultShareStatus = useCallback((status: "copied" | "failed") => {
    setPracticeResultShareStatus(status);
    if (practiceResultShareStatusTimeoutRef.current !== null) {
      window.clearTimeout(practiceResultShareStatusTimeoutRef.current);
    }
    practiceResultShareStatusTimeoutRef.current = window.setTimeout(() => {
      setPracticeResultShareStatus(null);
      practiceResultShareStatusTimeoutRef.current = null;
    }, 2_500);
  }, []);

  const showPrivateInviteCopyStatus = useCallback((status: "copied" | "failed") => {
    setPrivateInviteCopyStatus(status);
    if (privateInviteCopyStatusTimeoutRef.current !== null) {
      window.clearTimeout(privateInviteCopyStatusTimeoutRef.current);
    }
    privateInviteCopyStatusTimeoutRef.current = window.setTimeout(() => {
      setPrivateInviteCopyStatus(null);
      privateInviteCopyStatusTimeoutRef.current = null;
    }, 2_500);
  }, []);

  const editorValidationMessage = editorPuzzleDraft.validationMessage ?? editorValidationMessageFromServer;
  const isEditorPuzzleReady = editorPuzzleDraft.payload !== null;
  const editorTotalCharacters = useMemo(() => {
    return (
      editorPuzzleDraft.normalizedCenter.length +
      editorPuzzleDraft.normalizedExistingWords.reduce((sum, word) => sum + word.length, 0)
    );
  }, [editorPuzzleDraft.normalizedCenter.length, editorPuzzleDraft.normalizedExistingWords]);

  const fetchAdminGamesForToken = useCallback(
    async (token: string): Promise<boolean> => {
      setAdminGamesLoading(true);
      setAdminError(null);
      try {
        const response = await fetch(`${SERVER_URL}/admin/games`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const payload = await readJsonResponse(response);
        if (response.status === 401) {
          setAdminSessionToken(null);
          setAdminSessionExpiresAt(null);
          setAdminGamesResponse(null);
          setAdminError("Admin session expired. Sign in again.");
          return false;
        }
        if (!response.ok) {
          setAdminError(getApiErrorMessage(payload, "Failed to load admin games."));
          return false;
        }
        setAdminGamesResponse(payload as AdminGamesResponse);
        return true;
      } catch {
        setAdminError("Failed to load admin games.");
        return false;
      } finally {
        setAdminGamesLoading(false);
      }
    },
    []
  );

  const fetchAdminGames = useCallback(async (): Promise<boolean> => {
    if (!adminSessionToken) return false;
    return fetchAdminGamesForToken(adminSessionToken);
  }, [adminSessionToken, fetchAdminGamesForToken]);

  const handleAdminLogin = useCallback(async () => {
    const tokenDraft = adminTokenDraft.trim();
    if (!tokenDraft) return;

    setAdminLoginLoading(true);
    setAdminError(null);
    setAdminStatusMessage(null);
    try {
      const response = await fetch(`${SERVER_URL}/admin/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ token: tokenDraft })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        if (response.status === 404) {
          setAdminError("Admin mode is disabled on this server.");
          return;
        }
        setAdminError(getApiErrorMessage(payload, "Admin login failed."));
        return;
      }

      const login = payload as AdminLoginResponse;
      if (typeof login?.token !== "string" || typeof login?.expiresAt !== "number") {
        setAdminError("Admin login response was invalid.");
        return;
      }

      setAdminSessionToken(login.token);
      setAdminSessionExpiresAt(login.expiresAt);
      setAdminTokenDraft("");
      setAdminStatusMessage("Admin session active.");
      await fetchAdminGamesForToken(login.token);
    } catch {
      setAdminError("Admin login failed.");
    } finally {
      setAdminLoginLoading(false);
    }
  }, [adminTokenDraft, fetchAdminGamesForToken]);

  const handleAdminLogout = useCallback(() => {
    setAdminSessionToken(null);
    setAdminSessionExpiresAt(null);
    setAdminGamesResponse(null);
    setAdminError(null);
    setAdminStatusMessage("Signed out of admin mode.");
  }, []);

  const handleAdminEndGame = useCallback(
    async (gameSummary: AdminGameSummary) => {
      if (!adminSessionToken) return;

      setAdminEndingRoomId(gameSummary.roomId);
      setAdminError(null);
      setAdminStatusMessage(null);

      const sendEndRequest = async (acknowledgeOnlinePlayers: boolean) => {
        const response = await fetch(`${SERVER_URL}/admin/games/${encodeURIComponent(gameSummary.roomId)}/end`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminSessionToken}`
          },
          body: JSON.stringify({ acknowledgeOnlinePlayers })
        });
        const payload = await readJsonResponse(response);
        return { response, payload };
      };

      try {
        const initial = await sendEndRequest(false);
        if (initial.response.status === 401) {
          setAdminSessionToken(null);
          setAdminSessionExpiresAt(null);
          setAdminGamesResponse(null);
          setAdminError("Admin session expired. Sign in again.");
          return;
        }

        if (initial.response.status === 409 && isAdminEndGameWarningResponse(initial.payload)) {
          const onlinePlayersText =
            initial.payload.onlinePlayers.length > 0
              ? initial.payload.onlinePlayers.map((player) => player.name).join(", ")
              : "Unknown player";
          const confirmed = window.confirm(
            `${initial.payload.message}\nOnline players: ${onlinePlayersText}\nEnd the game now?`
          );
          if (!confirmed) {
            setAdminStatusMessage("End game canceled.");
            return;
          }

          const confirmedResult = await sendEndRequest(true);
          if (confirmedResult.response.status === 401) {
            setAdminSessionToken(null);
            setAdminSessionExpiresAt(null);
            setAdminGamesResponse(null);
            setAdminError("Admin session expired. Sign in again.");
            return;
          }
          if (!confirmedResult.response.ok) {
            setAdminError(getApiErrorMessage(confirmedResult.payload, "Failed to end game."));
            return;
          }
        } else if (!initial.response.ok) {
          setAdminError(getApiErrorMessage(initial.payload, "Failed to end game."));
          return;
        }

        setAdminStatusMessage(`Ended game "${gameSummary.roomName}".`);
        await fetchAdminGames();
      } catch {
        setAdminError("Failed to end game.");
      } finally {
        setAdminEndingRoomId(null);
      }
    },
    [adminSessionToken, fetchAdminGames]
  );

  const handleAdminRedisCleanup = useCallback(async () => {
    if (!adminSessionToken) return;
    const confirmed = window.confirm(
      "Delete the Redis snapshot key for persisted game state? This does not end active in-memory games."
    );
    if (!confirmed) return;

    setAdminCleanupLoading(true);
    setAdminError(null);
    setAdminStatusMessage(null);
    try {
      const response = await fetch(`${SERVER_URL}/admin/redis/cleanup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminSessionToken}`
        }
      });
      const payload = await readJsonResponse(response);
      if (response.status === 401) {
        setAdminSessionToken(null);
        setAdminSessionExpiresAt(null);
        setAdminGamesResponse(null);
        setAdminError("Admin session expired. Sign in again.");
        return;
      }
      if (!response.ok) {
        setAdminError(getApiErrorMessage(payload, "Redis cleanup failed."));
        return;
      }

      const cleanupPayload = payload as { deleted?: boolean; deletedCount?: number; key?: string };
      const keyLabel = typeof cleanupPayload.key === "string" ? cleanupPayload.key : "state key";
      const deletedCount = typeof cleanupPayload.deletedCount === "number" ? cleanupPayload.deletedCount : 0;
      if (cleanupPayload.deleted === true || deletedCount > 0) {
        setAdminStatusMessage(`Deleted Redis snapshot key "${keyLabel}".`);
      } else {
        setAdminStatusMessage(`Redis snapshot key "${keyLabel}" was already absent.`);
      }
    } catch {
      setAdminError("Redis cleanup failed.");
    } finally {
      setAdminCleanupLoading(false);
    }
  }, [adminSessionToken]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!adminSessionToken || !adminSessionExpiresAt) return;
    const remainingMs = adminSessionExpiresAt - Date.now();
    if (remainingMs <= 0) {
      setAdminSessionToken(null);
      setAdminSessionExpiresAt(null);
      setAdminGamesResponse(null);
      setAdminError("Admin session expired. Sign in again.");
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setAdminSessionToken(null);
      setAdminSessionExpiresAt(null);
      setAdminGamesResponse(null);
      setAdminError("Admin session expired. Sign in again.");
    }, remainingMs + 100);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [adminSessionToken, adminSessionExpiresAt]);

  useEffect(() => {
    if (!isAdminPath || !adminSessionToken) return;
    void fetchAdminGames();
    const intervalId = window.setInterval(() => {
      void fetchAdminGames();
    }, ADMIN_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAdminPath, adminSessionToken, fetchAdminGames]);

  const handleCreate = () => {
    if (!playerName) return;
    if (practiceState.active) return;
    setLobbyError(null);
    const flipTimerSeconds = clampFlipTimerSeconds(createFlipTimerSeconds);
    const claimTimerSeconds = clampClaimTimerSeconds(createClaimTimerSeconds);
    socket.emit("room:create", {
      roomName: createRoomName,
      playerName,
      isPublic: createPublic,
      maxPlayers: createMaxPlayers,
      flipTimerEnabled: createFlipTimerEnabled,
      flipTimerSeconds,
      claimTimerSeconds,
      preStealEnabled: createPreStealEnabled
    });
  };

  const handleJoinRoom = (room: RoomSummary) => {
    if (!playerName) return;
    if (practiceState.active) return;
    if (room.status !== "lobby") return;
    if (!room.isPublic) return;
    if (room.playerCount >= room.maxPlayers) return;
    setLobbyError(null);
    socket.emit("room:join", {
      roomId: room.id,
      name: playerName
    });
  };

  const handleSpectateRoom = (room: RoomSummary) => {
    if (!playerName) return;
    if (practiceState.active) return;
    if (room.status !== "in-game") return;
    if (!room.isPublic) return;
    setLobbyError(null);
    socket.emit("room:spectate", { roomId: room.id });
  };

  const handleStart = () => {
    if (!roomState) return;
    socket.emit("room:start", { roomId: roomState.id });
  };

  const handleCloseAdminPanel = () => {
    setAdminError(null);
    setAdminStatusMessage(null);
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", "/");
      setCurrentPath(window.location.pathname);
    }
  };

  const handleStartPractice = () => {
    if (roomState) return;
    setLobbyError(null);
    setPracticeStartDifficulty(null);
    setPracticeStartTimerEnabled(false);
    setPracticeStartTimerSeconds(DEFAULT_PRACTICE_TIMER_SECONDS);
    setShowPracticeStartPrompt(true);
    setLobbyView("list");
  };

  const handleConfirmPracticeStart = () => {
    if (practiceStartDifficulty === null) return;
    setLobbyError(null);
    socket.emit("practice:start", {
      difficulty: practiceStartDifficulty,
      timerEnabled: practiceStartTimerEnabled,
      timerSeconds: clampPracticeTimerSeconds(practiceStartTimerSeconds)
    });
    setShowPracticeStartPrompt(false);
    setPracticeStartDifficulty(null);
    setPracticeStartTimerEnabled(false);
    setPracticeStartTimerSeconds(DEFAULT_PRACTICE_TIMER_SECONDS);
  };

  const handleCancelPracticeStart = () => {
    setShowPracticeStartPrompt(false);
    setPracticeStartDifficulty(null);
    setPracticeStartTimerEnabled(false);
    setPracticeStartTimerSeconds(DEFAULT_PRACTICE_TIMER_SECONDS);
  };

  const handleOpenPracticeEditor = () => {
    setLobbyError(null);
    setEditorValidationMessageFromServer(null);
    setEditorShareStatus(null);
    setIsEditorShareValidationInFlight(false);
    setLobbyView("editor");
  };

  const handlePlayEditorPuzzle = () => {
    if (!editorPuzzleDraft.payload) return;
    setLobbyError(null);
    setEditorValidationMessageFromServer(null);
    socket.emit("practice:start", {
      difficulty: editorPuzzleDraft.payload.d,
      sharedPuzzle: editorPuzzleDraft.payload,
      timerEnabled: false
    });
  };

  const handleShareEditorPuzzle = async () => {
    if (!editorPuzzleDraft.payload) return;

    setLobbyError(null);
    setEditorValidationMessageFromServer(null);
    setIsEditorShareValidationInFlight(true);

    const validationResponse = await new Promise<PracticeValidateCustomResponse>((resolve) => {
      let isSettled = false;
      const timeoutId = window.setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        resolve({
          ok: false,
          message: "Validation timed out. Please try again."
        });
      }, CUSTOM_PUZZLE_VALIDATION_TIMEOUT_MS);

      socket.emit(
        "practice:validate-custom",
        { sharedPuzzle: editorPuzzleDraft.payload },
        (response: PracticeValidateCustomResponse) => {
          if (isSettled) return;
          isSettled = true;
          window.clearTimeout(timeoutId);
          if (!response || typeof response.ok !== "boolean") {
            resolve({
              ok: false,
              message: "Validation failed."
            });
            return;
          }
          resolve(response);
        }
      );
    });

    setIsEditorShareValidationInFlight(false);

    if (!validationResponse.ok) {
      setEditorValidationMessageFromServer(validationResponse.message ?? "Custom puzzle validation failed.");
      showEditorShareStatus("failed");
      return;
    }

    const token = encodePracticeSharePayload(editorPuzzleDraft.payload);
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set(PRACTICE_SHARE_QUERY_PARAM, token);

    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      showEditorShareStatus("copied");
    } catch {
      setEditorValidationMessageFromServer("Could not copy link. Please try again.");
      showEditorShareStatus("failed");
    }
  };

  const handlePracticeDifficultyChange = (value: number) => {
    socket.emit("practice:set-difficulty", {
      difficulty: clampPracticeDifficulty(value)
    });
  };

  const handlePracticeSubmit = () => {
    if (!isInPractice || practiceState.phase !== "puzzle" || !practiceWord.trim()) return;
    setPracticeSubmitError(null);
    socket.emit("practice:submit", { word: practiceWord });
  };

  const handlePracticeSkip = () => {
    if (!isInPractice) return;
    socket.emit("practice:skip");
    setPracticeWord("");
    setPracticeSubmitError(null);
  };

  const handlePracticeNext = () => {
    if (!isInPractice || practiceState.phase !== "result") return;
    socket.emit("practice:next");
    setPracticeWord("");
    setPracticeSubmitError(null);
  };

  const handlePracticeExit = () => {
    socket.emit("practice:exit");
    setPracticeWord("");
    setPracticeSubmitError(null);
    setPendingResultAutoSubmit(null);
  };

  const handleSharePracticePuzzle = async () => {
    if (!practicePuzzle) return;

    const payload = buildPracticeSharePayload(practiceState.currentDifficulty, practicePuzzle);
    const token = encodePracticeSharePayload(payload);
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set(PRACTICE_SHARE_QUERY_PARAM, token);

    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      showPracticeShareStatus("copied");
    } catch {
      showPracticeShareStatus("failed");
    }
  };

  const handleSharePracticeResult = async () => {
    if (!practicePuzzle || !practiceResult || practiceState.phase !== "result") return;
    if (practiceResult.timedOut || !practiceResult.submittedWordNormalized) return;

    try {
      const payload = buildPracticeResultSharePayload(
        practiceState.currentDifficulty,
        practicePuzzle,
        practiceResult.submittedWordNormalized,
        playerName
      );
      const token = encodePracticeResultSharePayload(payload);
      const shareUrl = new URL(window.location.href);
      shareUrl.searchParams.set(PRACTICE_RESULT_SHARE_QUERY_PARAM, token);
      await navigator.clipboard.writeText(shareUrl.toString());
      showPracticeResultShareStatus("copied");
    } catch {
      showPracticeResultShareStatus("failed");
    }
  };

  const handleCopyPrivateInviteUrl = async () => {
    if (!roomState || roomState.isPublic || !roomState.code) return;
    const inviteUrl = buildPrivateRoomInviteUrl(roomState.id, roomState.code);
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showPrivateInviteCopyStatus("copied");
    } catch {
      showPrivateInviteCopyStatus("failed");
    }
  };

  const handleLeaveRoom = () => {
    if (!roomState) return;
    socket.emit("room:leave");
    setRoomState(null);
    setGameState(null);
    setIsReplayMode(false);
    setReplayStepIndex(0);
    setReplaySource(null);
    setImportReplayError(null);
    setReplayPuzzleError(null);
    setIsReplayAnalysisOpen(false);
    setReplayAnalysisByStepIndex({});
    setImportedReplayAnalysisByStepIndex({});
    setReplayAnalysisLoadingStepIndex(null);
    setReplayAnalysisError(null);
    setShowAllReplayOptionsByStep({});
    setGameLogEntries([]);
    setQueuedTileClaimLetters("");
    clearClaimWordHighlights();
    previousGameStateRef.current = null;
    lastClaimFailureRef.current = null;
  };

  const handleOpenReplayImport = useCallback(() => {
    setImportReplayError(null);
    replayImportInputRef.current?.click();
  }, []);

  const handleReplayFileInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_REPLAY_IMPORT_FILE_BYTES) {
      setImportReplayError("File is too large.");
      return;
    }

    try {
      const fileText = await file.text();
      const parsed = parseReplayFile(fileText);
      if (!parsed.ok) {
        setImportReplayError(parsed.message);
        return;
      }

      setReplaySource({
        kind: "imported",
        file: parsed.file
      });
      setImportReplayError(null);
      setReplayPuzzleError(null);
      setIsReplayMode(true);
      setReplayStepIndex(0);
      setIsReplayAnalysisOpen(false);
      setImportedReplayAnalysisByStepIndex({});
      setReplayAnalysisLoadingStepIndex(null);
      setReplayAnalysisError(null);
      setShowAllReplayOptionsByStep({});
    } catch {
      setImportReplayError("Replay file is invalid or corrupted.");
    }
  }, []);

  const handleExportReplay = useCallback(() => {
    if (!roomReplay || roomState?.status !== "ended") return;

    const analysisByStepIndex: ReplayAnalysisMap | undefined = toReplayAnalysisMap(replayAnalysisByStepIndex);
    const replayFile = buildReplayFileV1({
      replay: roomReplay,
      analysisByStepIndex,
      sourceRoomId: roomState.id,
      app: "anagram-thief-web"
    });
    const payload = serializeReplayFile(replayFile);
    const blob = new Blob([payload], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = buildReplayExportFilename(replayFile.exportedAt);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  }, [roomReplay, roomState?.id, roomState?.status, replayAnalysisByStepIndex]);

  const handleViewReplayAsPuzzle = useCallback(async () => {
    if (!activeReplayState) return;

    const sharedPuzzle = buildPracticeSharePayloadFromReplayState(activeReplayState);
    setReplayPuzzleError(null);

    const validationResponse = await new Promise<PracticeValidateCustomResponse>((resolve) => {
      let isSettled = false;
      const timeoutId = window.setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        resolve({
          ok: false,
          message: "Validation timed out. Please try again."
        });
      }, CUSTOM_PUZZLE_VALIDATION_TIMEOUT_MS);

      socket.emit(
        "practice:validate-custom",
        { sharedPuzzle },
        (response: PracticeValidateCustomResponse) => {
          if (isSettled) return;
          isSettled = true;
          window.clearTimeout(timeoutId);
          if (!response || typeof response.ok !== "boolean") {
            resolve({
              ok: false,
              message: "Custom puzzle is invalid or has no valid plays."
            });
            return;
          }
          resolve(response);
        }
      );
    });

    if (!validationResponse.ok) {
      setReplayPuzzleError(validationResponse.message ?? "Custom puzzle is invalid or has no valid plays.");
      return;
    }

    setPendingSharedLaunch({
      kind: "puzzle",
      payload: sharedPuzzle
    });
    setReplayPuzzleError(null);
    setIsReplayMode(false);
    setReplaySource(null);
    setIsReplayAnalysisOpen(false);
    setReplayAnalysisError(null);
    setReplayAnalysisLoadingStepIndex(null);
    if (roomState) {
      handleLeaveRoom();
    }
  }, [activeReplayState, roomState, handleLeaveRoom]);

  const handleExitReplayView = useCallback(() => {
    setIsReplayMode(false);
    setReplayStepIndex(0);
    setReplaySource(null);
    setReplayPuzzleError(null);
    setIsReplayAnalysisOpen(false);
    setImportedReplayAnalysisByStepIndex({});
    setReplayAnalysisLoadingStepIndex(null);
    setReplayAnalysisError(null);
    setShowAllReplayOptionsByStep({});
  }, []);

  const fetchReplayAnalysisForStep = useCallback(
    (requestedStepIndex: number) => {
      if (!Number.isInteger(requestedStepIndex) || requestedStepIndex < 0) return;

      setReplayAnalysisError(null);
      setReplayAnalysisLoadingStepIndex(requestedStepIndex);

      let isSettled = false;
      const timeoutId = window.setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        setReplayAnalysisLoadingStepIndex((current) =>
          current === requestedStepIndex ? null : current
        );
        setReplayAnalysisError("Replay analysis timed out. Please try again.");
      }, REPLAY_ANALYSIS_TIMEOUT_MS);

      const handleResponse = (response: ReplayAnalysisResponse, source: "room" | "imported") => {
        if (isSettled) return;
        isSettled = true;
        window.clearTimeout(timeoutId);
        setReplayAnalysisLoadingStepIndex((current) =>
          current === requestedStepIndex ? null : current
        );

        if (!response || typeof response.ok !== "boolean") {
          setReplayAnalysisError("Replay analysis failed.");
          return;
        }

        if (!response.ok) {
          setReplayAnalysisError(response.message || "Replay analysis failed.");
          return;
        }

        if (source === "imported") {
          setImportedReplayAnalysisByStepIndex((current) => ({
            ...current,
            [response.result.requestedStepIndex]: response.result
          }));
        } else {
          setReplayAnalysisByStepIndex((current) => ({
            ...current,
            [response.result.requestedStepIndex]: response.result
          }));
        }
        setReplayAnalysisError(null);
      };

      if (replaySource?.kind === "imported") {
        socket.emit(
          "replay:analyze-imported-step",
          { replayFile: replaySource.file, stepIndex: requestedStepIndex },
          (response: ReplayAnalysisResponse) => handleResponse(response, "imported")
        );
        return;
      }

      if (!roomState || roomState.status !== "ended") {
        window.clearTimeout(timeoutId);
        setReplayAnalysisLoadingStepIndex((current) =>
          current === requestedStepIndex ? null : current
        );
        return;
      }

      socket.emit(
        "replay:analyze-step",
        { roomId: roomState.id, stepIndex: requestedStepIndex },
        (response: ReplayAnalysisResponse) => handleResponse(response, "room")
      );
    },
    [roomState, replaySource]
  );

  const handleEnterReplay = useCallback(() => {
    if (!roomReplay || roomReplaySteps.length === 0) return;
    setReplaySource({
      kind: "room",
      replay: roomReplay
    });
    setImportReplayError(null);
    setReplayPuzzleError(null);
    setReplayStepIndex(0);
    setIsReplayAnalysisOpen(false);
    setReplayAnalysisError(null);
    setReplayAnalysisLoadingStepIndex(null);
    setIsReplayMode(true);
  }, [roomReplay, roomReplaySteps.length]);

  const handleConfirmLeaveGame = () => {
    setShowLeaveGameConfirm(false);
    handleLeaveRoom();
  };

  const handleConfirmName = () => {
    const resolvedName = sanitizeClientName(nameDraft);
    setPlayerName(resolvedName);
    setNameDraft(resolvedName);
    setEditNameDraft(resolvedName);
    persistPlayerName(resolvedName);
    socket.emit("session:update-name", { name: resolvedName });
  };

  const roomId = roomState?.id ?? null;

  const handleOpenSettings = useCallback(() => {
    setEditNameDraft(playerName);
    setUserSettingsDraft(userSettings);
    setIsSettingsOpen(true);
  }, [playerName, userSettings]);

  const handleCloseSettings = useCallback(() => {
    setEditNameDraft(playerName);
    setUserSettingsDraft(userSettings);
    setIsSettingsOpen(false);
  }, [playerName, userSettings]);

  const handleSaveSettings = useCallback(() => {
    const resolvedName = sanitizeClientName(editNameDraft);
    setPlayerName(resolvedName);
    setNameDraft(resolvedName);
    setEditNameDraft(resolvedName);
    persistPlayerName(resolvedName);
    socket.emit("session:update-name", { name: resolvedName });
    if (roomId) {
      socket.emit("player:update-name", { name: resolvedName });
    }
    setUserSettings(userSettingsDraft);
    persistUserSettings(userSettingsDraft);
    setIsSettingsOpen(false);
  }, [editNameDraft, roomId, userSettingsDraft]);

  const handleFlip = useCallback(() => {
    if (!roomId) return;
    if (isSpectator) return;
    if (isFlipRevealActive) return;
    socket.emit("game:flip", { roomId });
  }, [roomId, isSpectator, isFlipRevealActive]);

  const handleClaimIntent = useCallback(() => {
    if (!roomId) return;
    if (isSpectator) return;
    if (isFlipRevealActive) return;
    if (claimWindow || isClaimCooldownActive) return;
    claimInputRef.current?.focus();
    socket.emit("game:claim-intent", { roomId });
  }, [roomId, isSpectator, isFlipRevealActive, claimWindow, isClaimCooldownActive]);

  const handleClaimTileSelect = useCallback(
    (letter: string) => {
      if (!roomId) return;
      if (isSpectator) return;
      if (!isTileInputMethodEnabled) return;
      const normalizedLetter = normalizeEditorText(letter).slice(0, 1);
      if (!normalizedLetter) return;

      if (isMyClaimWindow) {
        setClaimWord((current) => `${current}${normalizedLetter}`);
        requestAnimationFrame(() => claimInputRef.current?.focus());
        return;
      }

      if (claimWindow || isClaimCooldownActive || isFlipRevealActive) return;
      setQueuedTileClaimLetters((current) => `${current}${normalizedLetter}`);
      handleClaimIntent();
    },
    [
      roomId,
      isSpectator,
      isTileInputMethodEnabled,
      isMyClaimWindow,
      claimWindow,
      isClaimCooldownActive,
      isFlipRevealActive,
      handleClaimIntent
    ]
  );

  const handleClaimSubmit = useCallback(() => {
    if (!roomState) return;
    if (isSpectator) return;
    if (!isMyClaimWindow) return;
    if (!claimWord.trim()) return;
    socket.emit("game:claim", {
      roomId: roomState.id,
      word: claimWord
    });
    setClaimWord("");
    requestAnimationFrame(() => claimInputRef.current?.focus());
  }, [roomState, isSpectator, isMyClaimWindow, claimWord]);

  const handleAddPreStealEntry = useCallback(() => {
    if (isSpectator) return;
    if (!roomState || !gameState?.preStealEnabled) return;
    const triggerLetters = preStealTriggerInput.trim();
    const claimWord = preStealClaimWordInput.trim();
    if (!triggerLetters || !claimWord) return;

    socket.emit("game:pre-steal:add", {
      roomId: roomState.id,
      triggerLetters,
      claimWord
    });
    setPreStealTriggerInput("");
    setPreStealClaimWordInput("");
  }, [isSpectator, roomState, gameState?.preStealEnabled, preStealTriggerInput, preStealClaimWordInput]);

  const handleRemovePreStealEntry = useCallback(
    (entryId: string) => {
      if (isSpectator) return;
      if (!roomState || !gameState?.preStealEnabled) return;
      socket.emit("game:pre-steal:remove", {
        roomId: roomState.id,
        entryId
      });
    },
    [isSpectator, roomState, gameState?.preStealEnabled]
  );

  const handleReorderPreStealEntries = useCallback(
    (orderedEntryIds: string[]) => {
      if (isSpectator) return;
      if (!roomState || !gameState?.preStealEnabled) return;
      socket.emit("game:pre-steal:reorder", {
        roomId: roomState.id,
        orderedEntryIds
      });
    },
    [isSpectator, roomState, gameState?.preStealEnabled]
  );

  const handlePreStealEntryDrop = useCallback(
    (targetEntryId: string) => {
      if (isSpectator) return;
      if (!preStealDraggedEntryId) return;
      const nextEntries = reorderEntriesById(myPreStealEntries, preStealDraggedEntryId, targetEntryId);
      const nextOrder = nextEntries.map((entry) => entry.id);
      const currentOrder = myPreStealEntries.map((entry) => entry.id);
      if (nextOrder.join(",") !== currentOrder.join(",")) {
        handleReorderPreStealEntries(nextOrder);
      }
      setPreStealDraggedEntryId(null);
    },
    [isSpectator, preStealDraggedEntryId, myPreStealEntries, handleReorderPreStealEntries]
  );

  useEffect(() => {
    if (!isMyClaimWindow) {
      setClaimWord("");
      return;
    }
    requestAnimationFrame(() => claimInputRef.current?.focus());
  }, [isMyClaimWindow]);

  useEffect(() => {
    if (!isMyClaimWindow) return;
    if (!queuedTileClaimLetters) return;
    setClaimWord((current) => `${current}${queuedTileClaimLetters}`);
    setQueuedTileClaimLetters("");
    requestAnimationFrame(() => claimInputRef.current?.focus());
  }, [isMyClaimWindow, queuedTileClaimLetters]);

  useEffect(() => {
    if (isMyClaimWindow) return;
    if (!queuedTileClaimLetters) return;
    if (claimWindow || isClaimCooldownActive || isFlipRevealActive) {
      setQueuedTileClaimLetters("");
    }
  }, [
    isMyClaimWindow,
    queuedTileClaimLetters,
    claimWindow,
    isClaimCooldownActive,
    isFlipRevealActive
  ]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      handleCloseSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSettingsOpen, handleCloseSettings]);

  useEffect(() => {
    if (!practiceState.active) {
      setPracticeWord("");
      setPracticeSubmitError(null);
      return;
    }
    if (practiceState.phase !== "puzzle") return;
    setPracticeWord("");
    setPracticeSubmitError(null);
    requestAnimationFrame(() => practiceInputRef.current?.focus());
  }, [practiceState.active, practiceState.phase, practiceState.puzzle?.id]);

  useEffect(() => {
    setShowAllPracticeOptions(false);
  }, [practiceState.puzzle?.id, practiceResult?.submittedWordNormalized, practiceResult?.score]);

  useEffect(() => {
    setPracticeShareStatus(null);
  }, [practiceState.puzzle?.id]);

  useEffect(() => {
    setPracticeResultShareStatus(null);
  }, [practiceState.puzzle?.id, practiceResult?.submittedWordNormalized]);

  useEffect(() => {
    setEditorValidationMessageFromServer(null);
    setEditorShareStatus(null);
  }, [editorCenterInput, editorExistingWordsInput, editorDifficulty]);

  useEffect(() => {
    if (!pendingSharedLaunch) return;
    if (!isConnected) return;
    if (roomState) return;

    setLobbyError(null);
    if (pendingSharedLaunch.kind === "result") {
      setPendingResultAutoSubmit({
        submittedWord: pendingSharedLaunch.submittedWord,
        expectedPuzzleFingerprint: pendingSharedLaunch.expectedPuzzleFingerprint,
        expiresAt: Date.now() + PENDING_RESULT_AUTO_SUBMIT_TTL_MS
      });
    } else {
      setPendingResultAutoSubmit(null);
    }
    socket.emit("practice:start", {
      sharedPuzzle: pendingSharedLaunch.payload,
      timerEnabled: false
    });
    setPendingSharedLaunch(null);
    removePracticeShareFromUrl();
  }, [pendingSharedLaunch, isConnected, roomState]);

  useEffect(() => {
    if (!pendingPrivateRoomJoin) return;
    if (!isConnected) return;
    if (!playerName.trim()) return;
    if (roomState) return;
    if (practiceState.active) return;
    if (pendingSharedLaunch) return;

    setLobbyError(null);
    socket.emit("room:join", {
      roomId: pendingPrivateRoomJoin.roomId,
      name: playerName,
      code: pendingPrivateRoomJoin.code
    });
    setPendingPrivateRoomJoin(null);
    removePrivateRoomJoinFromUrl();
  }, [
    pendingPrivateRoomJoin,
    isConnected,
    playerName,
    roomState,
    practiceState.active,
    pendingSharedLaunch
  ]);

  useEffect(() => {
    if (!pendingResultAutoSubmit) return;
    if (pendingResultAutoSubmit.expiresAt <= now) {
      setPendingResultAutoSubmit(null);
      return;
    }
    if (!isConnected) return;
    if (roomState) return;
    if (!practiceState.active || practiceState.phase !== "puzzle") return;

    const puzzleFingerprint = buildPracticePuzzleFingerprintFromState(practiceState.puzzle);
    if (!puzzleFingerprint) return;
    if (puzzleFingerprint !== pendingResultAutoSubmit.expectedPuzzleFingerprint) return;

    setLobbyError(null);
    setPracticeSubmitError(null);
    socket.emit("practice:submit", { word: pendingResultAutoSubmit.submittedWord });
    setPendingResultAutoSubmit(null);
  }, [
    pendingResultAutoSubmit,
    now,
    isConnected,
    roomState,
    practiceState.active,
    practiceState.phase,
    practiceState.puzzle
  ]);

  useEffect(() => {
    if (roomState) {
      setPendingPrivateRoomJoin(null);
      removePrivateRoomJoinFromUrl();
      setLobbyError(null);
      setPendingResultAutoSubmit(null);
      setReplaySource((current) => (current?.kind === "imported" ? null : current));
      setImportReplayError(null);
      return;
    }
    setLobbyView("list");
  }, [roomState]);

  useEffect(() => {
    if (roomState || replaySource?.kind === "imported") return;
    setQueuedTileClaimLetters("");
    setPreStealTriggerInput("");
    setPreStealClaimWordInput("");
    setPreStealDraggedEntryId(null);
    setIsReplayMode(false);
    setReplayStepIndex(0);
    setIsReplayAnalysisOpen(false);
    setReplayAnalysisByStepIndex({});
    setReplayAnalysisLoadingStepIndex(null);
    setReplayAnalysisError(null);
    setShowAllReplayOptionsByStep({});
  }, [roomState, replaySource?.kind]);

  useEffect(() => {
    if (!isReplayMode) return;
    if (replaySource) return;
    if (roomState?.status !== "ended" || !roomReplay) return;
    setReplaySource({
      kind: "room",
      replay: roomReplay
    });
  }, [isReplayMode, replaySource, roomState?.status, roomReplay]);

  useEffect(() => {
    if (replaySource?.kind !== "room") return;
    if (!roomReplay) return;
    setReplaySource((current) => {
      if (!current || current.kind !== "room") return current;
      if (current.replay === roomReplay) return current;
      return {
        kind: "room",
        replay: roomReplay
      };
    });
  }, [replaySource?.kind, roomReplay]);

  useEffect(() => {
    setReplayStepIndex((current) => Math.min(Math.max(current, 0), maxReplayStepIndex));
  }, [maxReplayStepIndex]);

  useEffect(() => {
    if (replaySource?.kind === "imported") {
      if (replaySteps.length === 0) {
        setIsReplayMode(false);
        setReplayStepIndex(0);
        setReplaySource(null);
        setIsReplayAnalysisOpen(false);
        setReplayAnalysisLoadingStepIndex(null);
        setReplayAnalysisError(null);
      }
      return;
    }
    if (!roomState || roomState.status !== "ended") {
      setIsReplayMode(false);
      setReplayStepIndex(0);
      setReplaySource(null);
      setIsReplayAnalysisOpen(false);
      setReplayAnalysisLoadingStepIndex(null);
      setReplayAnalysisError(null);
      return;
    }
    if (replaySteps.length === 0) {
      setIsReplayMode(false);
      setReplayStepIndex(0);
      setReplaySource(null);
      setIsReplayAnalysisOpen(false);
      setReplayAnalysisLoadingStepIndex(null);
      setReplayAnalysisError(null);
    }
  }, [roomState, replaySource?.kind, replaySteps.length]);

  useEffect(() => {
    setReplayAnalysisError(null);
    setReplayPuzzleError(null);
  }, [activeReplayRequestedStepIndex]);

  useEffect(() => {
    if (!isReplayMode || !isReplayAnalysisOpen) return;
    if (!activeReplayStep) return;
    const requestedStepIndex = activeReplayStep.index;
    if (replaySource?.kind === "imported") {
      const importedCached =
        importedReplayAnalysisByStepIndex[requestedStepIndex] ??
        getImportedReplayAnalysis(replaySource.file, requestedStepIndex);
      if (importedCached) return;
    } else if (replayAnalysisByStepIndex[requestedStepIndex]) {
      return;
    }
    if (replayAnalysisLoadingStepIndex === requestedStepIndex) return;
    fetchReplayAnalysisForStep(requestedStepIndex);
  }, [
    isReplayMode,
    isReplayAnalysisOpen,
    replaySource?.kind,
    replaySource,
    roomState,
    activeReplayStep,
    importedReplayAnalysisByStepIndex,
    replayAnalysisByStepIndex,
    replayAnalysisLoadingStepIndex,
    fetchReplayAnalysisForStep
  ]);

  useEffect(() => {
    if (!practiceState.active) return;
    setLobbyView("list");
    setLobbyError(null);
  }, [practiceState.active]);

  useEffect(() => {
    if (!practiceState.active) return;
    setShowPracticeStartPrompt(false);
    setPracticeStartDifficulty(null);
    setPracticeStartTimerEnabled(false);
    setPracticeStartTimerSeconds(DEFAULT_PRACTICE_TIMER_SECONDS);
  }, [practiceState.active]);

  useEffect(() => {
    if (isInGame) return;
    setShowLeaveGameConfirm(false);
  }, [isInGame]);

  useEffect(() => {
    if (!isInGame || isSpectator) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const isSpace = event.code === "Space" || event.key === " " || event.key === "Spacebar";
      if (isSpace) {
        if (isFlipRevealActive) return;
        if (gameState?.turnPlayerId !== selfPlayerId) return;
        event.preventDefault();
        handleFlip();
        return;
      }

      if (event.key === "Enter" && !isEditableTarget) {
        if (isMyClaimWindow) {
          claimInputRef.current?.focus();
          return;
        }
        if (claimWindow || isClaimCooldownActive) {
          return;
        }
        if (isFlipRevealActive) {
          return;
        }
        event.preventDefault();
        handleClaimIntent();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleFlip,
    handleClaimIntent,
    isInGame,
    isSpectator,
    gameState?.turnPlayerId,
    selfPlayerId,
    isMyClaimWindow,
    claimWindow,
    isClaimCooldownActive,
    isFlipRevealActive
  ]);

  useEffect(() => {
    const roomId = roomState?.id ?? null;
    const previousRoomId = previousRoomIdRef.current;
    const shouldReset =
      !roomId ||
      roomState?.status === "lobby" ||
      (previousRoomId !== null && previousRoomId !== roomId);

    if (shouldReset) {
      setGameLogEntries([]);
      clearClaimWordHighlights();
      previousGameStateRef.current = null;
      lastClaimFailureRef.current = null;
    }

    previousRoomIdRef.current = roomId;
  }, [clearClaimWordHighlights, roomState?.id, roomState?.status]);

  useEffect(() => {
    if (!shouldShowGameLog) return;
    const logListElement = gameLogListRef.current;
    if (!logListElement) return;
    logListElement.scrollTop = logListElement.scrollHeight;
  }, [gameLogEntries.length, shouldShowGameLog]);

  useEffect(() => {
    if (!gameState || !roomState || (roomState.status !== "in-game" && roomState.status !== "ended")) {
      previousGameStateRef.current = null;
      return;
    }

    const previousState = previousGameStateRef.current;
    const pendingEntries: PendingGameLogEntry[] = [];

    if (!previousState) {
      if (roomState.status === "in-game") {
        pendingEntries.push({ text: "Game started.", kind: "event" });
      }
      previousGameStateRef.current = gameState;
      appendGameLogEntries(pendingEntries);
      return;
    }

    const previousCenterTileIds = new Set(previousState.centerTiles.map((tile) => tile.id));
    const addedTiles = gameState.centerTiles.filter((tile) => !previousCenterTileIds.has(tile.id));
    if (addedTiles.length > 0 && gameState.bagCount < previousState.bagCount) {
      const flipperId = previousState.pendingFlip?.playerId ?? previousState.turnPlayerId;
      const flipperName = getPlayerName(previousState.players, flipperId);
      for (const tile of addedTiles) {
        pendingEntries.push({ text: `${flipperName} flipped ${tile.letter}.`, kind: "event" });
      }
    }

    if (!previousState.claimWindow && gameState.claimWindow) {
      const claimantName = getPlayerName(gameState.players, gameState.claimWindow.playerId);
      pendingEntries.push({
        text: `${claimantName} started a claim window (${roomState.claimTimer.seconds}s).`,
        kind: "event"
      });
    }

    const previousWords = getWordSnapshots(previousState.players);
    const currentWords = getWordSnapshots(gameState.players);
    const previousWordMap = new Map(previousWords.map((word) => [word.id, word]));
    const removedWords = previousWords.filter(
      (word) => !currentWords.some((currentWord) => currentWord.id === word.id)
    );
    const addedWords = currentWords
      .filter((word) => !previousWordMap.has(word.id))
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const addedWord of addedWords) {
      const claimantName = getPlayerName(gameState.players, addedWord.ownerId);
      const replacedWord = findReplacedWord(addedWord, removedWords);
      if (!replacedWord) {
        markClaimedWordForAnimation(addedWord.id, "claim");
        pendingEntries.push({
          text: appendPreStealLogContext(`${claimantName} claimed ${addedWord.text}.`, gameState, addedWord.id),
          kind: "event"
        });
        continue;
      }

      const removedWordIndex = removedWords.findIndex((word) => word.id === replacedWord.id);
      if (removedWordIndex !== -1) {
        removedWords.splice(removedWordIndex, 1);
      }

      if (replacedWord.ownerId === addedWord.ownerId) {
        markClaimedWordForAnimation(addedWord.id, "claim");
        pendingEntries.push({
          text: appendPreStealLogContext(
            `${claimantName} extended ${replacedWord.text} to ${addedWord.text}.`,
            gameState,
            addedWord.id
          ),
          kind: "event"
        });
      } else {
        markClaimedWordForAnimation(addedWord.id, "steal");
        const stolenFromName = getPlayerName(gameState.players, replacedWord.ownerId);
        pendingEntries.push({
          text: appendPreStealLogContext(
            `${claimantName} stole ${replacedWord.text} from ${stolenFromName} with ${addedWord.text}.`,
            gameState,
            addedWord.id
          ),
          kind: "event"
        });
      }
    }

    const previousCooldowns = previousState.claimCooldowns;
    const currentCooldowns = gameState.claimCooldowns;
    const startedCooldownPlayerIds = Object.keys(currentCooldowns).filter((playerId) => {
      const previousEndsAt = previousCooldowns[playerId];
      const currentEndsAt = currentCooldowns[playerId];
      return typeof currentEndsAt === "number" && previousEndsAt !== currentEndsAt;
    });
    const endedCooldownPlayerIds = Object.keys(previousCooldowns).filter(
      (playerId) => !(playerId in currentCooldowns)
    );

    const previousClaimWindow = previousState.claimWindow;
    let isClaimWindowExpired = false;
    if (previousClaimWindow && !gameState.claimWindow) {
      isClaimWindowExpired =
        previousClaimWindow.endsAt <= Date.now() &&
        previousClaimWindow.playerId in currentCooldowns;
    }
    if (isClaimWindowExpired && previousClaimWindow) {
      const claimantName = getPlayerName(gameState.players, previousClaimWindow.playerId);
      pendingEntries.push({ text: `${claimantName}'s claim window expired.`, kind: "event" });
    }

    for (const playerId of startedCooldownPlayerIds) {
      if (playerId === selfPlayerId && lastClaimFailureRef.current) {
        const elapsed = Date.now() - lastClaimFailureRef.current.at;
        if (elapsed <= CLAIM_FAILURE_WINDOW_MS) {
          pendingEntries.push({
            text: `You failed claim: ${lastClaimFailureRef.current.message} You are on cooldown.`,
            kind: "error"
          });
          lastClaimFailureRef.current = null;
          continue;
        }
      }

      const cooldownPlayerName = getPlayerName(gameState.players, playerId);
      pendingEntries.push({ text: `${cooldownPlayerName} is on cooldown.`, kind: "event" });
    }

    for (const playerId of endedCooldownPlayerIds) {
      const cooldownPlayerName = getPlayerName(gameState.players, playerId);
      pendingEntries.push({ text: `${cooldownPlayerName} is off cooldown.`, kind: "event" });
    }

    if (previousState.bagCount > 0 && gameState.bagCount === 0 && gameState.endTimerEndsAt) {
      pendingEntries.push({
        text: "Bag is empty. Final countdown started (60s).",
        kind: "event"
      });
    }

    if (previousState.status !== "ended" && gameState.status === "ended") {
      pendingEntries.push({ text: "Game ended.", kind: "event" });
    }

    previousGameStateRef.current = gameState;
    appendGameLogEntries(pendingEntries);
  }, [
    appendGameLogEntries,
    gameState,
    markClaimedWordForAnimation,
    roomState,
    selfPlayerId
  ]);

  const replayBackButtonLabel = roomState?.status === "ended" ? "Back to final scores" : "Close replay";
  const replayPanelContent =
    isReplayMode && activeReplayState ? (
      <div className="replay-panel">
        <div className="button-row">
          <button className="button-secondary" onClick={handleExitReplayView}>
            {replayBackButtonLabel}
          </button>
          {roomState && (
            <button className="button-secondary" onClick={handleLeaveRoom}>
              Return to lobby
            </button>
          )}
        </div>
        <div className="replay-controls">
          <button
            className="button-secondary"
            onClick={() => setReplayStepIndex(0)}
            disabled={clampedReplayStepIndex <= 0}
          >
            Start
          </button>
          <button
            className="button-secondary"
            onClick={() => setReplayStepIndex((current) => Math.max(0, current - 1))}
            disabled={clampedReplayStepIndex <= 0}
          >
            Prev
          </button>
          <span className="replay-step-label">
            Step {clampedReplayStepIndex + 1} / {replaySteps.length}
          </span>
          <button
            className="button-secondary"
            onClick={() => setReplayStepIndex((current) => Math.min(maxReplayStepIndex, current + 1))}
            disabled={clampedReplayStepIndex >= maxReplayStepIndex}
          >
            Next
          </button>
          <button
            className="button-secondary"
            onClick={() => setReplayStepIndex(maxReplayStepIndex)}
            disabled={clampedReplayStepIndex >= maxReplayStepIndex}
          >
            End
          </button>
          <button
            className="button-secondary"
            onClick={() => setIsReplayAnalysisOpen((current) => !current)}
          >
            {isReplayAnalysisOpen ? "Hide analysis" : "Show analysis"}
          </button>
          <button className="button-secondary" onClick={handleOpenReplayImport}>
            Import replay
          </button>
          <button className="button-secondary" onClick={handleViewReplayAsPuzzle}>
            View as Puzzle
          </button>
          {canExportReplay && (
            <button className="button-secondary" onClick={handleExportReplay}>
              Export replay (.json)
            </button>
          )}
        </div>
        {replayPuzzleError && (
          <div className="replay-import-error" role="alert">
            {replayPuzzleError}
          </div>
        )}
        {importReplayError && (
          <div className="replay-import-error" role="alert">
            {importReplayError}
          </div>
        )}
        <div className="replay-board-layout">
          <section className="replay-board">
            <div className="replay-board-header">
              <div>
                <h3>Replay Board</h3>
                <p className="muted">{activeReplayActionText}</p>
              </div>
              <div className="turn">
                <span>Turn:</span>
                <strong>{replayTurnPlayerName}</strong>
              </div>
            </div>
            <p className="muted">Bag: {activeReplayState.bagCount} tiles</p>
            {activeReplayState.pendingFlip && (
              <p className="muted">
                {getPlayerName(activeReplayState.players, activeReplayState.pendingFlip.playerId)} is revealing a
                tile...
              </p>
            )}
            <div className="tiles">
              {activeReplayState.centerTiles.length === 0 && (
                <div className="muted">No tiles flipped yet.</div>
              )}
              {activeReplayState.centerTiles.map((tile) => (
                <div key={tile.id} className="tile">
                  {tile.letter}
                </div>
              ))}
            </div>

            {activeReplayState.preStealEnabled && (
              <div className="pre-steal-panel replay-pre-steal-panel">
                <div className="pre-steal-layout">
                  <div className="pre-steal-entries-column">
                    <div className="word-header">
                      <span>Pre-steal entries</span>
                    </div>
                    {replayPreStealPlayers.map((player) => (
                      <div key={player.id} className="word-list">
                        <div className="word-header">
                          <span>{player.name}</span>
                        </div>
                        {player.preStealEntries.map((entry) => (
                          <div key={entry.id} className="pre-steal-entry">
                            <span className="pre-steal-entry-text">
                              {entry.triggerLetters}
                              {" -> "}
                              {entry.claimWord}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="pre-steal-precedence-column">
                    <div className="word-header">
                      <span>Precendence</span>
                    </div>
                    {replayPreStealPrecedencePlayers.length === 0 && (
                      <div className="muted">No precedence order available.</div>
                    )}
                    {replayPreStealPrecedencePlayers.length > 0 && (
                      <ol className="pre-steal-precedence-list">
                        {replayPreStealPrecedencePlayers.map((player) => (
                          <li key={player.id}>
                            <span>{player.name}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
          <section className="replay-scoreboard">
            <h3>Scores & Words</h3>
            <div className="player-list">
              {activeReplayState.players.map((player) => (
                <div key={player.id} className="player">
                  <div>
                    <strong>{player.name}</strong>
                    {player.id === activeReplayState.turnPlayerId && <span className="badge">turn</span>}
                  </div>
                  <span className="score">{player.score}</span>
                </div>
              ))}
            </div>
            <div className="words">
              {activeReplayState.players.map((player) => (
                <ReplayWordList key={player.id} player={player} />
              ))}
            </div>
          </section>
        </div>
        {isReplayAnalysisOpen && (
          <section className="replay-analysis-panel">
            <div className="replay-analysis-header">
              <h3>Best moves</h3>
              {activeReplayAnalysis && (
                <span className="score">Best score: {activeReplayAnalysis.bestScore}</span>
              )}
            </div>
            {isActiveReplayAnalysisLoading && <div className="muted">Analyzing this replay step...</div>}
            {!isActiveReplayAnalysisLoading && replayAnalysisError && (
              <div className="practice-submit-error" role="alert">
                {replayAnalysisError}
              </div>
            )}
            {!isActiveReplayAnalysisLoading && !replayAnalysisError && activeReplayAnalysis && (
              <>
                <p className="muted">
                  {activeReplayAnalysis.basis === "before-claim"
                    ? "Analyzed from state before this claim."
                    : "Analyzed from this revealed-tile state."}
                </p>
                <div className="practice-options">
                  {visibleReplayAnalysisOptions.map((option) => (
                    <div
                      key={`${activeReplayAnalysis.requestedStepIndex}-${option.word}-${option.source}-${option.stolenFrom ?? "center"}`}
                      className="practice-option"
                    >
                      <div>
                        <strong>{formatPracticeOptionLabel(option)}</strong>
                      </div>
                      <span className="score">{option.score}</span>
                    </div>
                  ))}
                  {hiddenReplayAnalysisOptionCount > 0 &&
                    !showAllReplayOptionsByStep[activeReplayAnalysis.requestedStepIndex] && (
                      <button
                        type="button"
                        className="practice-option-more"
                        onClick={() =>
                          setShowAllReplayOptionsByStep((current) => ({
                            ...current,
                            [activeReplayAnalysis.requestedStepIndex]: true
                          }))
                        }
                      >
                        more
                      </button>
                    )}
                  {activeReplayAnalysis.allOptions.length === 0 && (
                    <div className="muted">No valid moves from this position.</div>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    ) : null;

  if (!playerName && !isAdminPath) {
    return (
      <div className="name-gate">
        <div className="name-card">
          <h1>Choose your name</h1>
          <p className="muted">This is how other players will see you.</p>
          <input
            className="name-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && nameDraft.trim()) {
                e.preventDefault();
                handleConfirmName();
              }
            }}
            placeholder="Type your name"
            autoFocus
          />
          <button onClick={handleConfirmName} disabled={!nameDraft.trim()}>
            Enter Lobby
          </button>
        </div>
      </div>
    );
  }

  const pageClassName = shouldShowGameLog ? "page has-game-log" : "page";

  return (
    <UserSettingsContext.Provider value={userSettingsContextValue}>
      <div className={pageClassName}>
        <input
          ref={replayImportInputRef}
          type="file"
          accept={REPLAY_FILE_INPUT_ACCEPT}
          onChange={handleReplayFileInputChange}
          className="hidden-file-input"
        />
        <header className="header">
          <div>
            <h1>Anagram Thief</h1>
          </div>
          <div className="status">
            <div className="status-identity">
              <span className="status-name">{playerName}</span>
              <button className="icon-button" onClick={handleOpenSettings} aria-label="Open settings">
                ⚙
              </button>
            </div>
            <div className="status-connection">
              <span className={isConnected ? "dot online" : "dot"} />
              {isConnected ? "Connected" : "Connecting"}
            </div>
          </div>
        </header>

      {!roomState && !practiceState.active && !isReplayMode && lobbyView === "list" && (
        <div className="grid">
          <section className="panel">
            <h2>Open Games</h2>
            <div className="room-list">
              {openLobbyRooms.length === 0 && <p className="muted">No open games yet.</p>}
              {openLobbyRooms.map((room) => {
                const isFull = room.playerCount >= room.maxPlayers;
                return (
                  <div key={room.id} className="room-card">
                    <div>
                      <strong>{room.name}</strong>
                      <div className="muted">
                        {room.playerCount} / {room.maxPlayers} • {room.isPublic ? "public" : "private"}
                      </div>
                    </div>
                    <button onClick={() => handleJoinRoom(room)} disabled={isFull}>
                      {isFull ? "Full" : "Join"}
                    </button>
                  </div>
                );
              })}
            </div>
            <h2>Games in Progress</h2>
            <div className="room-list">
              {inProgressLobbyRooms.length === 0 && <p className="muted">No games in progress.</p>}
              {inProgressLobbyRooms.map((room) => (
                <div key={room.id} className="room-card">
                  <div>
                    <strong>{room.name}</strong>
                    <div className="muted">
                      {room.playerCount} / {room.maxPlayers} • in progress
                    </div>
                  </div>
                  <button className="button-secondary" onClick={() => handleSpectateRoom(room)}>
                    Spectate
                  </button>
                </div>
              ))}
            </div>
            <div className="button-row">
              <button onClick={() => setLobbyView("create")}>Create new game</button>
            </div>
          </section>

          <section className="panel">
            <h2>Practice Mode</h2>
            <p className="muted">
              Train solo on one puzzle at a time. Submit your best play, then review every possible claim
              and score.
            </p>
            {lobbyError && (
              <div className="practice-editor-error" role="alert">
                {lobbyError}
              </div>
            )}
            <div className="button-row">
              <button onClick={handleStartPractice}>Start practice</button>
              <button className="button-secondary" onClick={handleOpenPracticeEditor}>
                Create custom puzzle
              </button>
              <button className="button-secondary" onClick={handleOpenReplayImport}>
                Import replay
              </button>
            </div>
            {importReplayError && (
              <div className="replay-import-error" role="alert">
                {importReplayError}
              </div>
            )}
          </section>
        </div>
      )}

      {!roomState && !practiceState.active && !isReplayMode && lobbyView === "create" && (
        <div className="grid">
          <section className="panel panel-narrow">
            <h2>New Game</h2>
            <label>
              Room name
              <input
                value={createRoomName}
                onChange={(e) => setCreateRoomName(e.target.value)}
                placeholder="Friday Night"
              />
            </label>
            <label className="row">
              <span>Public room</span>
              <input
                type="checkbox"
                checked={createPublic}
                onChange={(e) => setCreatePublic(e.target.checked)}
              />
            </label>
            <label>
              Max players (2-8)
              <input
                type="number"
                min={2}
                max={8}
                value={createMaxPlayers}
                onChange={(e) => setCreateMaxPlayers(Number(e.target.value))}
              />
            </label>
            <label className="row">
              <span>Flip timer</span>
              <input
                type="checkbox"
                checked={createFlipTimerEnabled}
                onChange={(e) => setCreateFlipTimerEnabled(e.target.checked)}
              />
            </label>
            <label>
              Flip timer seconds (1-60)
              <input
                type="number"
                min={MIN_FLIP_TIMER_SECONDS}
                max={MAX_FLIP_TIMER_SECONDS}
                value={createFlipTimerSeconds}
                onChange={(e) => setCreateFlipTimerSeconds(Number(e.target.value))}
                onBlur={() =>
                  setCreateFlipTimerSeconds((current) => clampFlipTimerSeconds(current))
                }
                disabled={!createFlipTimerEnabled}
              />
            </label>
            <label>
              Claim timer seconds (1-10)
              <input
                type="number"
                min={MIN_CLAIM_TIMER_SECONDS}
                max={MAX_CLAIM_TIMER_SECONDS}
                value={createClaimTimerSeconds}
                onChange={(e) => setCreateClaimTimerSeconds(Number(e.target.value))}
                onBlur={() =>
                  setCreateClaimTimerSeconds((current) => clampClaimTimerSeconds(current))
                }
              />
            </label>
            <label className="row">
              <span>Enable pre-steal</span>
              <input
                type="checkbox"
                checked={createPreStealEnabled}
                onChange={(event) => setCreatePreStealEnabled(event.target.checked)}
              />
            </label>
            <div className="button-row">
              <button className="button-secondary" onClick={() => setLobbyView("list")}>
                Back to games
              </button>
              <button onClick={handleCreate}>Create game</button>
            </div>
          </section>

        </div>
      )}

      {!roomState && !practiceState.active && !isReplayMode && lobbyView === "editor" && (
        <div className="grid">
          <section className="panel panel-narrow practice-editor">
            <h2>Custom Practice Puzzle</h2>
            <p className="muted">
              Pick center tiles and existing words, then play this exact puzzle or share it as a link.
            </p>

            <div className="practice-editor-fields">
              <div className="practice-difficulty-control" aria-label="Custom puzzle difficulty">
                <span>Difficulty</span>
                <div className="practice-difficulty-segmented" role="group" aria-label="Custom puzzle difficulty">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={
                        editorDifficulty === level ? "practice-difficulty-option active" : "practice-difficulty-option"
                      }
                      onClick={() => setEditorDifficulty(level as PracticeDifficulty)}
                      aria-pressed={editorDifficulty === level}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              <label>
                Center tiles (A-Z)
                <input
                  value={editorCenterInput}
                  onChange={(event) => setEditorCenterInput(event.target.value)}
                  placeholder="TEAM"
                />
              </label>

              <label>
                Existing words (one per line)
                <textarea
                  value={editorExistingWordsInput}
                  onChange={(event) => setEditorExistingWordsInput(event.target.value)}
                  placeholder={"RATE\nALERT"}
                  rows={6}
                />
              </label>

              <p className="muted practice-editor-stats">
                Center: {editorPuzzleDraft.normalizedCenter.length}/{CUSTOM_PUZZLE_CENTER_LETTER_MAX} letters ·
                Existing words: {editorPuzzleDraft.normalizedExistingWords.length}/
                {CUSTOM_PUZZLE_EXISTING_WORD_COUNT_MAX} · Total chars: {editorTotalCharacters}/
                {CUSTOM_PUZZLE_TOTAL_CHARACTERS_MAX}
              </p>

              {(editorValidationMessage || lobbyError) && (
                <div className="practice-editor-error" role="alert">
                  {editorValidationMessage ?? lobbyError}
                </div>
              )}
            </div>

            <div className="button-row">
              <button
                className="button-secondary"
                onClick={() => {
                  setLobbyError(null);
                  setEditorValidationMessageFromServer(null);
                  setEditorShareStatus(null);
                  setIsEditorShareValidationInFlight(false);
                  setLobbyView("list");
                }}
              >
                Back to lobby
              </button>
              <button onClick={handlePlayEditorPuzzle} disabled={!isEditorPuzzleReady}>
                Play puzzle
              </button>
              <button
                className="button-secondary"
                onClick={handleShareEditorPuzzle}
                disabled={!isEditorPuzzleReady || isEditorShareValidationInFlight}
              >
                {isEditorShareValidationInFlight
                  ? "Validating..."
                  : editorShareStatus === "copied"
                    ? "Copied!"
                    : editorShareStatus === "failed"
                      ? "Copy failed"
                      : "Share link"}
              </button>
            </div>
          </section>
        </div>
      )}

      {isInPractice && (
        <div className="practice">
          <section className="panel practice-board">
            <div className="practice-header">
              <div>
                <h2>Practice Mode</h2>
                <p className="muted">Current puzzle difficulty: {practiceState.currentDifficulty}</p>
              </div>
              <div className="practice-header-actions">
                {practicePuzzle && (
                  <div className="practice-share-action">
                    <button className="button-secondary" type="button" onClick={handleSharePracticePuzzle}>
                      {practiceShareStatus === "copied"
                        ? "Copied!"
                        : practiceShareStatus === "failed"
                          ? "Copy failed"
                          : "Share"}
                    </button>
                  </div>
                )}
                {practicePuzzle &&
                  practiceState.phase === "result" &&
                  practiceResult &&
                  !practiceResult.timedOut &&
                  practiceResult.submittedWordNormalized && (
                  <div className="practice-share-action">
                    <button className="button-secondary" type="button" onClick={handleSharePracticeResult}>
                      {practiceResultShareStatus === "copied"
                        ? "Copied!"
                        : practiceResultShareStatus === "failed"
                          ? "Copy failed"
                          : "Share result"}
                    </button>
                  </div>
                )}
                {practiceState.phase === "result" && practiceResult && (
                  <>
                    <div className="practice-difficulty-control" aria-label="Next puzzle difficulty">
                      <div className="practice-difficulty-segmented" role="group">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <button
                            key={level}
                            type="button"
                            className={
                              practiceState.queuedDifficulty === level
                                ? "practice-difficulty-option active"
                                : "practice-difficulty-option"
                            }
                            onClick={() => handlePracticeDifficultyChange(level)}
                            aria-pressed={practiceState.queuedDifficulty === level}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button onClick={handlePracticeNext}>Next Puzzle</button>
                  </>
                )}
                <button className="button-secondary" onClick={handlePracticeExit}>
                  Exit Practice
                </button>
              </div>
            </div>

            {practicePuzzle ? (
              <div
                className={
                  practiceState.phase === "result" && practiceResult
                    ? "practice-content result-layout"
                    : "practice-content"
                }
              >
                <div className="practice-puzzle-panel">
                  <div>
                    <h3>Center Tiles</h3>
                  </div>
                  <div className="tiles">
                    {practicePuzzle.centerTiles.map((tile) => (
                      <div key={tile.id} className="tile">
                        {tile.letter}
                      </div>
                    ))}
                  </div>

                  <div className="word-list practice-existing-words">
                    <div className="word-header">
                      <span>Existing words</span>
                      <span className="muted">{practicePuzzle.existingWords.length}</span>
                    </div>
                    {practicePuzzle.existingWords.length === 0 && (
                      <div className="muted">No existing words in this puzzle.</div>
                    )}
                    {practicePuzzle.existingWords.map((word) => (
                      <div key={word.id} className="word-item">
                        <div className="word-tiles" aria-label={word.text}>
                          {word.text.split("").map((letter, index) => (
                            <div key={`${word.id}-${index}`} className="tile word-tile">
                              {letter.toUpperCase()}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {practiceState.phase === "puzzle" && (
                    <>
                      {practiceTimerRemainingSeconds !== null && (
                        <div
                          className={`practice-puzzle-timer ${isPracticeTimerWarning ? "warning" : ""}`}
                          role="progressbar"
                          aria-label="Practice puzzle timer"
                          aria-valuemin={0}
                          aria-valuemax={practiceState.timerSeconds}
                          aria-valuenow={practiceTimerRemainingSeconds}
                        >
                          <div className="practice-puzzle-timer-header">
                            <span>Time remaining</span>
                            <strong>{practiceTimerRemainingSeconds}s</strong>
                          </div>
                          <div className="practice-puzzle-timer-track">
                            <div
                              className="practice-puzzle-timer-progress"
                              style={{ width: `${practiceTimerProgress * 100}%` }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="claim-box">
                        <div className="claim-input">
                          <input
                            ref={practiceInputRef}
                            value={practiceWord}
                            onChange={(event) => {
                              setPracticeWord(event.target.value);
                              if (practiceSubmitError) {
                                setPracticeSubmitError(null);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                handlePracticeSubmit();
                              }
                            }}
                            placeholder="Enter your best play"
                          />
                          <button onClick={handlePracticeSubmit} disabled={!practiceWord.trim()}>
                            Submit
                          </button>
                        </div>
                        {practiceSubmitError && (
                          <div className="practice-submit-error" role="alert">
                            {practiceSubmitError}
                          </div>
                        )}
                      </div>
                      <div className="button-row">
                        <button className="button-secondary" onClick={handlePracticeSkip}>
                          Skip Puzzle
                        </button>
                        <button className="button-secondary" onClick={handlePracticeExit}>
                          Exit Practice
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {practiceState.phase === "result" && practiceResult && (
                  <div className="practice-result-panel">
                    <div className="practice-result">
                      <div className="practice-result-summary">
                        <div className="practice-result-summary-header">
                          <h3>Result</h3>
                          {practiceResultCategory && (
                            <span
                              className={`practice-result-badge practice-result-badge-${practiceResultCategory.key}`}
                            >
                              {practiceResultCategory.label}
                            </span>
                          )}
                        </div>
                        <p>
                          <strong>
                            {practiceResult.timedOut
                              ? "Time's up"
                              : practiceResult.submittedWordNormalized || "(empty)"}
                          </strong>{" "}
                          ({practiceResult.score}/{practiceResult.bestScore})
                        </p>
                      </div>

                      <div className="practice-options">
                        {visiblePracticeOptions.map((option) => (
                          <div
                            key={`${option.word}-${option.source}-${option.stolenFrom ?? "center"}`}
                            className={getPracticeOptionClassName(option, practiceResult.submittedWordNormalized)}
                          >
                            <div>
                              <strong>{formatPracticeOptionLabel(option)}</strong>
                            </div>
                            <span className="score">{option.score}</span>
                          </div>
                        ))}
                        {hiddenPracticeOptionCount > 0 && !showAllPracticeOptions && (
                          <button
                            type="button"
                            className="practice-option-more"
                            onClick={() => setShowAllPracticeOptions(true)}
                          >
                            more
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="muted">Loading puzzle...</div>
            )}
          </section>
        </div>
      )}

      {roomState && roomState.status === "lobby" && (
        <div className="grid">
          <section className="panel">
            <h2>Lobby</h2>
            <p className="muted">Room ID: {roomState.id}</p>
            <p className="muted">
              Flip timer: {roomState.flipTimer.enabled ? `${roomState.flipTimer.seconds}s` : "off"}
            </p>
            <p className="muted">Claim timer: {roomState.claimTimer.seconds}s</p>
            <p className="muted">Pre-steal: {roomState.preSteal.enabled ? "on" : "off"}</p>
            {!roomState.isPublic && roomState.code && <p className="muted">Code: {roomState.code}</p>}
            {!roomState.isPublic && roomState.code && isHost && (
              <div className="button-row">
                <button className="button-secondary" type="button" onClick={handleCopyPrivateInviteUrl}>
                  {privateInviteCopyStatus === "copied"
                    ? "Copied!"
                    : privateInviteCopyStatus === "failed"
                      ? "Copy failed"
                      : "Copy invite URL"}
                </button>
              </div>
            )}
            <div className="player-list">
              {currentPlayers.map((player) => (
                <div key={player.id} className={player.id === selfPlayerId ? "player you" : "player"}>
                  <span>{player.name}</span>
                  {!player.connected && <span className="badge">offline</span>}
                  {player.id === roomState.hostId && <span className="badge">host</span>}
                </div>
              ))}
            </div>
            <div className="button-row">
              <button className="button-secondary" onClick={handleLeaveRoom}>
                Back to lobby
              </button>
              {isHost && <button onClick={handleStart}>Start Game</button>}
            </div>
          </section>

          <section className="panel">
            <h2>How to Play</h2>
            <ul>
              <li>Flip one tile on your turn.</li>
              <li>Start claims with Enter, or switch to tile input in Settings.</li>
              <li>Steals are automatic when possible.</li>
              <li>Steals must rearrange letters (no substring extensions).</li>
              <li>Game ends 60s after bag is empty.</li>
            </ul>
          </section>
        </div>
      )}

      {isInGame && gameState && (
        <div className="game">
          <section className="panel game-board">
            <div className="game-header">
              <div>
                <h2>Center Tiles</h2>
                <p className="muted">Bag: {gameState.bagCount} tiles</p>
                {roomState?.flipTimer.enabled && (
                  <p className="muted">Auto flip: {roomState.flipTimer.seconds}s</p>
                )}
              </div>
              <div className="turn">
                <span>Turn:</span>
                <strong>
                  {gameState.players.find((p) => p.id === gameState.turnPlayerId)?.name || "Unknown"}
                </strong>
                <button
                  onClick={handleFlip}
                  disabled={isSpectator || gameState.turnPlayerId !== selfPlayerId || isFlipRevealActive}
                >
                  Flip Tile
                </button>
              </div>
            </div>

            {endTimerRemaining !== null && (
              <div className="timer">End in {formatTime(endTimerRemaining)}</div>
            )}

            <div className="tiles">
              {gameState.centerTiles.length === 0 && !pendingFlip && (
                <div className="muted">No tiles flipped yet.</div>
              )}
              {gameState.centerTiles.map((tile) => (
                <div
                  key={tile.id}
                  className={isTileSelectionEnabled ? "tile tile-selectable" : "tile"}
                  role={isTileSelectionEnabled ? "button" : undefined}
                  tabIndex={isTileSelectionEnabled ? 0 : undefined}
                  onClick={
                    isTileSelectionEnabled ? () => handleClaimTileSelect(tile.letter) : undefined
                  }
                  onKeyDown={
                    isTileSelectionEnabled
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            handleClaimTileSelect(tile.letter);
                          }
                        }
                      : undefined
                  }
                  aria-label={
                    isTileSelectionEnabled ? `Use letter ${tile.letter} for claim` : undefined
                  }
                >
                  {tile.letter}
                </div>
              ))}
              {pendingFlip && (
                <div
                  className="tile tile-reveal-card"
                  style={{
                    animationDuration: `${flipRevealDurationMs}ms`,
                    animationDelay: `-${flipRevealElapsedMs}ms`
                  }}
                  aria-live="polite"
                  aria-label={`${flipRevealPlayerName} is revealing the next tile`}
                >
                  ?
                </div>
              )}
            </div>

            <div className="claim-box">
              <div
                className={`claim-timer ${claimWindow ? "" : "placeholder"}`}
                role={claimWindow ? "progressbar" : undefined}
                aria-label={claimWindow ? "Claim timer" : undefined}
                aria-valuemin={claimWindow ? 0 : undefined}
                aria-valuemax={claimWindow ? 100 : undefined}
                aria-valuenow={claimWindow ? Math.round(claimProgress * 100) : undefined}
                aria-hidden={!claimWindow}
              >
                <div
                  className="claim-progress"
                  style={{ width: `${claimWindow ? claimProgress * 100 : 0}%` }}
                />
              </div>
              <div className="claim-input">
                <input
                  ref={claimInputRef}
                  value={claimWord}
                  onChange={(e) => setClaimWord(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (isMyClaimWindow) {
                        handleClaimSubmit();
                        return;
                      }
                      handleClaimIntent();
                    }
                  }}
                  placeholder={claimPlaceholder}
                  disabled={isClaimInputDisabled}
                />
                <button
                  onClick={isMyClaimWindow ? handleClaimSubmit : handleClaimIntent}
                  disabled={isClaimButtonDisabled}
                >
                  {claimButtonLabel}
                </button>
              </div>
            </div>

            {gameState.preStealEnabled && (
              <div className="pre-steal-panel">
                {isSpectator ? (
                  <div className="pre-steal-layout">
                    <div className="pre-steal-entries-column">
                      <div className="word-header">
                        <span>Pre-steal entries</span>
                      </div>
                      {spectatorPreStealPlayers.every((player) => player.preStealEntries.length === 0) && (
                        <div className="muted">No pre-steal entries.</div>
                      )}
                      {spectatorPreStealPlayers.map((player) => (
                        <div key={player.id} className="word-list">
                          <div className="word-header">
                            <span>{player.name}</span>
                            {!player.connected && <span className="badge">offline</span>}
                          </div>
                          {player.preStealEntries.length === 0 && (
                            <div className="muted">No entries.</div>
                          )}
                          {player.preStealEntries.map((entry) => (
                            <div key={entry.id} className="pre-steal-entry">
                              <span className="pre-steal-entry-text">
                                {entry.triggerLetters}
                                {" -> "}
                                {entry.claimWord}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>

                    <div className="pre-steal-precedence-column">
                      <div className="word-header">
                        <span>Precendence</span>
                      </div>
                      {preStealPrecedencePlayers.length === 0 && (
                        <div className="muted">No precedence order available.</div>
                      )}
                      {preStealPrecedencePlayers.length > 0 && (
                        <ol className="pre-steal-precedence-list">
                          {preStealPrecedencePlayers.map((player) => (
                            <li key={player.id}>
                              <span>{player.name}</span>
                              {!player.connected && <span className="badge">offline</span>}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="pre-steal-layout">
                    <div className="pre-steal-entries-column">
                      <div className="word-header">
                        <span>Your pre-steal entries</span>
                      </div>
                      <div className="pre-steal-entry-form">
                        <input
                          value={preStealTriggerInput}
                          onChange={(event) => setPreStealTriggerInput(event.target.value)}
                          placeholder="Trigger letters"
                        />
                        <input
                          value={preStealClaimWordInput}
                          onChange={(event) => setPreStealClaimWordInput(event.target.value)}
                          placeholder="Claim word"
                        />
                        <button
                          className="button-secondary"
                          onClick={handleAddPreStealEntry}
                          disabled={!preStealTriggerInput.trim() || !preStealClaimWordInput.trim()}
                        >
                          Add
                        </button>
                      </div>

                      {myPreStealEntries.length === 0 && (
                        <div className="muted">No pre-steal entries.</div>
                      )}
                      {myPreStealEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className="pre-steal-entry self"
                          draggable
                          onDragStart={(event) => {
                            setPreStealDraggedEntryId(entry.id);
                            event.dataTransfer.setData("text/plain", entry.id);
                          }}
                          onDragEnd={() => setPreStealDraggedEntryId(null)}
                          onDragOver={(event) => {
                            if (!preStealDraggedEntryId) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            handlePreStealEntryDrop(entry.id);
                          }}
                        >
                          <span className="pre-steal-entry-text">
                            {entry.triggerLetters}
                            {" -> "}
                            {entry.claimWord}
                          </span>
                          <button className="button-secondary" onClick={() => handleRemovePreStealEntry(entry.id)}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="pre-steal-precedence-column">
                      <div className="word-header">
                        <span>Precendence</span>
                      </div>
                      {preStealPrecedencePlayers.length === 0 && (
                        <div className="muted">No precedence order available.</div>
                      )}
                      {preStealPrecedencePlayers.length > 0 && (
                        <ol className="pre-steal-precedence-list">
                          {preStealPrecedencePlayers.map((player) => (
                            <li key={player.id}>
                              <span>{player.name}</span>
                              {!player.connected && <span className="badge">offline</span>}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="panel scoreboard">
            <div className="scoreboard-header">
              <h2>Players</h2>
              <button className="button-danger" onClick={() => setShowLeaveGameConfirm(true)}>
                {isSpectator ? "Leave Spectate" : "Leave Game"}
              </button>
            </div>
            <div className="player-list">
              {gameState.players.map((player) => (
                <div key={player.id} className={player.id === selfPlayerId ? "player you" : "player"}>
                  <div>
                    <strong>{player.name}</strong>
                    {player.id === gameState.turnPlayerId && <span className="badge">turn</span>}
                    {!player.connected && <span className="badge">offline</span>}
                  </div>
                  <span className="score">{player.score}</span>
                </div>
              ))}
            </div>

            <div className="words">
              {gameState.players.map((player) => (
                <WordList
                  key={player.id}
                  player={player}
                  highlightedWordIds={claimedWordHighlights}
                  onTileLetterSelect={handleClaimTileSelect}
                />
              ))}
            </div>
          </section>
        </div>
      )}

      {roomState?.status === "ended" && gameState && (
        <div className="panel">
          {!isReplayMode && (
            <>
              <h2>Game Over</h2>
              <p className="muted">Final scores</p>
              <div className="player-list">
                {gameOverStandings.players.map((player) => {
                  const isWinner =
                    gameOverStandings.winningScore !== null && player.score === gameOverStandings.winningScore;
                  return (
                    <div key={player.id} className={isWinner ? "player winner" : "player"}>
                      <div>
                        <span>{player.name}</span>
                        {isWinner && <span className="badge winner-badge">winner</span>}
                      </div>
                      <span className="score">{player.score}</span>
                    </div>
                  );
                })}
              </div>
              <div className="button-row">
                <button className="button-secondary" onClick={handleLeaveRoom}>
                  Return to lobby
                </button>
                <button onClick={handleEnterReplay} disabled={roomReplaySteps.length === 0}>
                  Watch replay
                </button>
              </div>
              {roomReplaySteps.length === 0 && <p className="muted">Replay unavailable for this game.</p>}
            </>
          )}
          {replayPanelContent}
        </div>
      )}

      {!roomState && replaySource?.kind === "imported" && replayPanelContent && (
        <div className="panel">
          {replayPanelContent}
        </div>
      )}

      {shouldShowGameLog && (
        <section className="game-log">
          <div ref={gameLogListRef} className="game-log-list">
            {gameLogEntries.length === 0 && (
              <div className="game-log-empty muted">No gameplay events yet.</div>
            )}
            {gameLogEntries.map((entry) => (
              <div
                key={entry.id}
                className={`game-log-row ${entry.kind === "error" ? "error" : ""}`}
              >
                <span className="game-log-time">{formatLogTime(entry.timestamp)}</span>
                <span className="game-log-text">{entry.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {showPracticeStartPrompt && !practiceState.active && !roomState && (
        <div className="join-overlay">
          <div className="panel join-modal practice-start-modal">
            <h2>Start Practice Mode</h2>
            <p className="muted">Choose difficulty and optional puzzle timer settings.</p>
            <div className="practice-start-difficulty-picker" role="group" aria-label="Practice difficulty">
              <div className="practice-difficulty-segmented">
                {[1, 2, 3, 4, 5].map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={
                      practiceStartDifficulty === level
                        ? "practice-difficulty-option active"
                        : "practice-difficulty-option"
                    }
                    onClick={() => setPracticeStartDifficulty(level as PracticeDifficulty)}
                    aria-pressed={practiceStartDifficulty === level}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
            <label className="practice-start-timer-toggle">
              <input
                type="checkbox"
                checked={practiceStartTimerEnabled}
                onChange={(event) => setPracticeStartTimerEnabled(event.target.checked)}
              />
              <span>Enable puzzle timer</span>
            </label>
            <label className="practice-start-timer-seconds">
              <span>
                Timer seconds ({MIN_PRACTICE_TIMER_SECONDS}-{MAX_PRACTICE_TIMER_SECONDS})
              </span>
              <div className="practice-start-timer-input-row">
                <input
                  type="range"
                  min={MIN_PRACTICE_TIMER_SECONDS}
                  max={MAX_PRACTICE_TIMER_SECONDS}
                  step={1}
                  value={practiceStartTimerSeconds}
                  disabled={!practiceStartTimerEnabled}
                  onChange={(event) => setPracticeStartTimerSeconds(clampPracticeTimerSeconds(Number(event.target.value)))}
                />
                <input
                  type="number"
                  min={MIN_PRACTICE_TIMER_SECONDS}
                  max={MAX_PRACTICE_TIMER_SECONDS}
                  value={practiceStartTimerSeconds}
                  disabled={!practiceStartTimerEnabled}
                  onChange={(event) => setPracticeStartTimerSeconds(clampPracticeTimerSeconds(Number(event.target.value)))}
                  onBlur={() =>
                    setPracticeStartTimerSeconds((current) => clampPracticeTimerSeconds(current))
                  }
                />
              </div>
            </label>
            <div className="button-row">
              <button className="button-secondary" onClick={handleCancelPracticeStart}>
                Cancel
              </button>
              <button onClick={handleConfirmPracticeStart} disabled={practiceStartDifficulty === null}>
                Start practice
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdminPath && (
        <div className="join-overlay">
          <div className="panel join-modal admin-modal" role="dialog" aria-modal="true">
            <div className="admin-modal-header">
              <h2>Admin Mode</h2>
              <button className="button-secondary" onClick={handleCloseAdminPanel}>
                Close
              </button>
            </div>
            {!adminSessionToken ? (
              <div className="admin-login">
                <p className="muted">
                  Enter your admin token. Session is stored in memory only and expires automatically.
                </p>
                <label>
                  Admin token
                  <input
                    type="password"
                    value={adminTokenDraft}
                    onChange={(event) => setAdminTokenDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void handleAdminLogin();
                      }
                    }}
                    placeholder="Paste admin token"
                    autoFocus
                  />
                </label>
                <div className="button-row">
                  <button
                    onClick={() => {
                      void handleAdminLogin();
                    }}
                    disabled={!adminTokenDraft.trim() || adminLoginLoading}
                  >
                    {adminLoginLoading ? "Signing in..." : "Sign in"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="admin-content">
                <p className="muted">Session expires: {formatDateTime(adminSessionExpiresAt)}</p>
                <div className="button-row">
                  <button
                    className="button-secondary"
                    onClick={() => {
                      void fetchAdminGames();
                    }}
                    disabled={adminGamesLoading}
                  >
                    {adminGamesLoading ? "Refreshing..." : "Refresh"}
                  </button>
                  <button
                    className="button-secondary"
                    onClick={() => {
                      void handleAdminRedisCleanup();
                    }}
                    disabled={adminCleanupLoading}
                  >
                    {adminCleanupLoading ? "Cleaning..." : "Clean Redis Snapshot"}
                  </button>
                  <button className="button-secondary" onClick={handleAdminLogout}>
                    Sign out
                  </button>
                </div>

                <h3>All Active Games</h3>
                <div className="admin-games-list">
                  {adminGames.length === 0 && <p className="muted">No active games.</p>}
                  {adminGames.map((summary) => (
                    <div key={summary.roomId} className="admin-game-card">
                      <div className="admin-game-top">
                        <div>
                          <strong>{summary.roomName}</strong>
                          <div className="muted">
                            {summary.roomId} • {summary.isPublic ? "public" : "private"}
                          </div>
                        </div>
                        <div className="admin-game-badges">
                          <span className="badge">{summary.roomStatus}</span>
                          {summary.stuck && <span className="badge badge-stuck">stuck</span>}
                          {summary.allPlayersOffline && <span className="badge">all players offline</span>}
                        </div>
                      </div>
                      <div className="muted admin-game-meta">
                        Players online: {summary.onlinePlayerCount}/{summary.playerCount} • Spectators online:{" "}
                        {summary.onlineSpectatorCount}/{summary.spectatorCount}
                      </div>
                      <div className="muted admin-game-meta">
                        Players:{" "}
                        {summary.players.length > 0
                          ? summary.players
                              .map((player) => `${player.name}${player.connected ? "" : " (offline)"}`)
                              .join(", ")
                          : "none"}
                      </div>
                      <div className="muted admin-game-meta">
                        Spectators:{" "}
                        {summary.spectators.length > 0
                          ? summary.spectators
                              .map((spectator) => `${spectator.name}${spectator.connected ? "" : " (offline)"}`)
                              .join(", ")
                          : "none"}
                      </div>
                      <div className="muted admin-game-meta">
                        Bag: {summary.bagCount ?? "n/a"} • Center: {summary.centerTileCount ?? "n/a"} • Last
                        activity: {formatDateTime(summary.lastActivityAt)}
                      </div>
                      <div className="button-row">
                        <button
                          className="button-danger"
                          onClick={() => {
                            void handleAdminEndGame(summary);
                          }}
                          disabled={summary.gameStatus !== "in-game" || adminEndingRoomId === summary.roomId}
                        >
                          {adminEndingRoomId === summary.roomId ? "Ending..." : "End Game"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <h3>All Players Offline</h3>
                <div className="admin-games-list">
                  {adminOfflineGames.length === 0 && <p className="muted">No games with all players offline.</p>}
                  {adminOfflineGames.map((summary) => (
                    <div key={`offline-${summary.roomId}`} className="admin-game-card">
                      <strong>{summary.roomName}</strong>
                      <div className="muted">
                        {summary.roomId} • {summary.gameStatus ?? summary.roomStatus} • Last activity:{" "}
                        {formatDateTime(summary.lastActivityAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {adminError && (
              <div className="practice-editor-error" role="alert">
                {adminError}
              </div>
            )}
            {adminStatusMessage && <div className="admin-status-message">{adminStatusMessage}</div>}
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="join-overlay">
          <div className="panel join-modal settings-modal" role="dialog" aria-modal="true">
            <h2>Settings</h2>
            <label>
              Display name
              <input
                value={editNameDraft}
                onChange={(event) => setEditNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    handleSaveSettings();
                  }
                }}
                placeholder="Player name"
                autoFocus
              />
            </label>
            <div className="settings-section">
              <span>Input method</span>
              <label className="settings-option">
                <input
                  type="checkbox"
                  checked={userSettingsDraft.inputMethod === "tile"}
                  onChange={(event) =>
                    setUserSettingsDraft((current) => ({
                      ...current,
                      inputMethod: event.target.checked ? "tile" : "typing"
                    }))
                  }
                />
                <span>
                  <strong>Enable click/tap letter tiles</strong>
                </span>
              </label>
            </div>
            <div className="settings-section">
              <span>Appearance</span>
              <label className="settings-option">
                <input
                  type="checkbox"
                  checked={userSettingsDraft.theme === "dark"}
                  onChange={(event) =>
                    setUserSettingsDraft((current) => ({
                      ...current,
                      theme: event.target.checked ? "dark" : "light"
                    }))
                  }
                />
                <span>
                  <strong>Dark mode</strong>
                </span>
              </label>
            </div>
            <div className="button-row">
              <button className="button-secondary" onClick={handleCloseSettings}>
                Cancel
              </button>
              <button onClick={handleSaveSettings} disabled={!editNameDraft.trim()}>
                Save settings
              </button>
            </div>
          </div>
        </div>
      )}

      {showLeaveGameConfirm && (
        <div className="join-overlay">
          <div className="panel join-modal leave-confirm-modal">
            <h2>Leave this game?</h2>
            <p className="muted">
              This removes you from the current game, and you will not be able to rejoin by reloading.
            </p>
            <div className="button-row">
              <button className="button-secondary" onClick={() => setShowLeaveGameConfirm(false)}>
                Stay in game
              </button>
              <button className="button-danger" onClick={handleConfirmLeaveGame}>
                Leave game
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </UserSettingsContext.Provider>
  );
}

function WordList({
  player,
  highlightedWordIds,
  onTileLetterSelect
}: {
  player: Player;
  highlightedWordIds: Record<string, WordHighlightKind>;
  onTileLetterSelect: (letter: string) => void;
}) {
  const { isTileInputMethodEnabled } = useUserSettings();

  return (
    <div className="word-list">
      <div className="word-header">
        <span>{player.name}'s words</span>
        <span className="muted">{player.words.length}</span>
      </div>
      {player.words.length === 0 && <div className="muted">No words yet.</div>}
      {player.words.map((word) => (
        <div key={word.id} className={getWordItemClassName(highlightedWordIds[word.id])}>
          <div className="word-tiles" aria-label={word.text}>
            {word.text.split("").map((letter, index) => (
              <div
                key={`${word.id}-${index}`}
                className={isTileInputMethodEnabled ? "tile word-tile tile-selectable" : "tile word-tile"}
                role={isTileInputMethodEnabled ? "button" : undefined}
                tabIndex={isTileInputMethodEnabled ? 0 : undefined}
                onClick={
                  isTileInputMethodEnabled ? () => onTileLetterSelect(letter.toUpperCase()) : undefined
                }
                onKeyDown={
                  isTileInputMethodEnabled
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          onTileLetterSelect(letter.toUpperCase());
                        }
                      }
                    : undefined
                }
                aria-label={
                  isTileInputMethodEnabled
                    ? `Use letter ${letter.toUpperCase()} from ${player.name}'s word`
                    : undefined
                }
              >
                {letter.toUpperCase()}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReplayWordList({ player }: { player: ReplayPlayerSnapshot }) {
  return (
    <div className="word-list">
      <div className="word-header">
        <span>{player.name}'s words</span>
        <span className="muted">{player.words.length}</span>
      </div>
      {player.words.length === 0 && <div className="muted">No words yet.</div>}
      {player.words.map((word) => (
        <div key={word.id} className="word-item">
          <div className="word-tiles" aria-label={word.text}>
            {word.text.split("").map((letter, index) => (
              <div key={`${word.id}-${index}`} className="tile word-tile">
                {letter.toUpperCase()}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function getWordItemClassName(highlightKind: WordHighlightKind | undefined) {
  if (highlightKind === "steal") {
    return "word-item word-item-steal";
  }
  if (highlightKind === "claim") {
    return "word-item word-item-claim";
  }
  return "word-item";
}

function getPracticeOptionClassName(
  option: PracticeScoredWord,
  submittedWordNormalized: string
) {
  if (option.word === submittedWordNormalized) {
    return "practice-option submitted";
  }
  return "practice-option";
}

function formatPracticeOptionLabel(option: PracticeScoredWord): string {
  if (option.source !== "steal" || !option.stolenFrom) {
    return option.word;
  }

  const addedLetters = getAddedLettersForSteal(option.word, option.stolenFrom);
  return `${option.word} (${option.stolenFrom} + ${addedLetters})`;
}

function getAddedLettersForSteal(word: string, stolenWord: string): string {
  const remainingCounts: Record<string, number> = {};
  for (const letter of stolenWord) {
    remainingCounts[letter] = (remainingCounts[letter] ?? 0) + 1;
  }

  let addedLetters = "";
  for (const letter of word) {
    if ((remainingCounts[letter] ?? 0) > 0) {
      remainingCounts[letter] -= 1;
      continue;
    }
    addedLetters += letter;
  }

  return addedLetters;
}
