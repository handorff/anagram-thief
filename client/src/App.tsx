import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import type {
  GameState,
  Player,
  PracticeDifficulty,
  PracticeModeState,
  PracticeResultSharePayload,
  PracticeResult,
  PracticeScoredWord,
  PracticeSharePayload,
  PracticeValidateCustomResponse,
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

function getPlayerName(players: Player[], playerId: string | null | undefined) {
  if (!playerId) return "Unknown";
  return players.find((player) => player.id === playerId)?.name ?? "Unknown";
}

function getWordSnapshots(players: Player[]): WordSnapshot[] {
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

function appendPreStealLogContext(text: string, gameState: GameState, wordId: string): string {
  const claimEvent = gameState.lastClaimEvent;
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

export default function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [selfPlayerId, setSelfPlayerId] = useState<string | null>(null);
  const [roomList, setRoomList] = useState<RoomSummary[]>([]);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [practiceState, setPracticeState] = useState<PracticeModeState>(() =>
    createInactivePracticeState()
  );
  const [pendingSharedLaunch, setPendingSharedLaunch] = useState<PendingSharedLaunch | null>(() =>
    readPendingSharedLaunchFromUrl()
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
  const [joinPrompt, setJoinPrompt] = useState<{ roomId: string; roomName: string } | null>(null);

  const [createRoomName, setCreateRoomName] = useState("");
  const [createPublic, setCreatePublic] = useState(true);
  const [createMaxPlayers, setCreateMaxPlayers] = useState(8);
  const [createFlipTimerEnabled, setCreateFlipTimerEnabled] = useState(false);
  const [createFlipTimerSeconds, setCreateFlipTimerSeconds] = useState(DEFAULT_FLIP_TIMER_SECONDS);
  const [createClaimTimerSeconds, setCreateClaimTimerSeconds] = useState(DEFAULT_CLAIM_TIMER_SECONDS);
  const [createPreStealEnabled, setCreatePreStealEnabled] = useState(false);

  const [joinCode, setJoinCode] = useState("");
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

  const lobbyRooms = useMemo(() => roomList.filter((room) => room.status === "lobby"), [roomList]);
  const userSettingsContextValue = useMemo(
    () => buildUserSettingsContextValue(userSettings),
    [userSettings]
  );
  const isTileInputMethodEnabled = userSettingsContextValue.isTileInputMethodEnabled;

  const endTimerRemaining = useMemo(() => {
    if (!gameState?.endTimerEndsAt) return null;
    const remaining = Math.max(0, Math.ceil((gameState.endTimerEndsAt - now) / 1000));
    return remaining;
  }, [gameState?.endTimerEndsAt, now]);

  const isHost = roomState?.hostId === selfPlayerId;
  const isInGame = roomState?.status === "in-game" && gameState;
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
  const claimButtonLabel = isMyClaimWindow ? "Submit Claim" : "Start Claim";
  const isClaimButtonDisabled = isMyClaimWindow
    ? !claimWord.trim() || isFlipRevealActive
    : Boolean(claimWindow) || isClaimCooldownActive || isFlipRevealActive;
  const isClaimInputDisabled = !isMyClaimWindow || isClaimCooldownActive || isFlipRevealActive;
  const shouldShowGameLog =
    Boolean(gameState) && (roomState?.status === "in-game" || roomState?.status === "ended");
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

  const editorValidationMessage = editorPuzzleDraft.validationMessage ?? editorValidationMessageFromServer;
  const isEditorPuzzleReady = editorPuzzleDraft.payload !== null;
  const editorTotalCharacters = useMemo(() => {
    return (
      editorPuzzleDraft.normalizedCenter.length +
      editorPuzzleDraft.normalizedExistingWords.reduce((sum, word) => sum + word.length, 0)
    );
  }, [editorPuzzleDraft.normalizedCenter.length, editorPuzzleDraft.normalizedExistingWords]);

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
    if (room.playerCount >= room.maxPlayers) return;
    if (room.isPublic) {
      setLobbyError(null);
      socket.emit("room:join", {
        roomId: room.id,
        name: playerName
      });
      return;
    }
    setJoinCode("");
    setJoinPrompt({ roomId: room.id, roomName: room.name });
  };

  const handleJoinWithCode = () => {
    if (!playerName || !joinPrompt) return;
    setLobbyError(null);
    socket.emit("room:join", {
      roomId: joinPrompt.roomId,
      name: playerName,
      code: joinCode.trim() || undefined
    });
  };

  const handleStart = () => {
    if (!roomState) return;
    socket.emit("room:start", { roomId: roomState.id });
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

  const handleLeaveRoom = () => {
    if (!roomState) return;
    socket.emit("room:leave");
    setRoomState(null);
    setGameState(null);
    setGameLogEntries([]);
    setQueuedTileClaimLetters("");
    clearClaimWordHighlights();
    previousGameStateRef.current = null;
    lastClaimFailureRef.current = null;
  };

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
    if (isFlipRevealActive) return;
    socket.emit("game:flip", { roomId });
  }, [roomId, isFlipRevealActive]);

  const handleClaimIntent = useCallback(() => {
    if (!roomId) return;
    if (isFlipRevealActive) return;
    if (claimWindow || isClaimCooldownActive) return;
    claimInputRef.current?.focus();
    socket.emit("game:claim-intent", { roomId });
  }, [roomId, isFlipRevealActive, claimWindow, isClaimCooldownActive]);

  const handleClaimTileSelect = useCallback(
    (letter: string) => {
      if (!roomId) return;
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
    if (!isMyClaimWindow) return;
    if (!claimWord.trim()) return;
    socket.emit("game:claim", {
      roomId: roomState.id,
      word: claimWord
    });
    setClaimWord("");
    requestAnimationFrame(() => claimInputRef.current?.focus());
  }, [roomState, isMyClaimWindow, claimWord]);

  const handleAddPreStealEntry = useCallback(() => {
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
  }, [roomState, gameState?.preStealEnabled, preStealTriggerInput, preStealClaimWordInput]);

  const handleRemovePreStealEntry = useCallback(
    (entryId: string) => {
      if (!roomState || !gameState?.preStealEnabled) return;
      socket.emit("game:pre-steal:remove", {
        roomId: roomState.id,
        entryId
      });
    },
    [roomState, gameState?.preStealEnabled]
  );

  const handleReorderPreStealEntries = useCallback(
    (orderedEntryIds: string[]) => {
      if (!roomState || !gameState?.preStealEnabled) return;
      socket.emit("game:pre-steal:reorder", {
        roomId: roomState.id,
        orderedEntryIds
      });
    },
    [roomState, gameState?.preStealEnabled]
  );

  const handlePreStealEntryDrop = useCallback(
    (targetEntryId: string) => {
      if (!preStealDraggedEntryId) return;
      const nextEntries = reorderEntriesById(myPreStealEntries, preStealDraggedEntryId, targetEntryId);
      const nextOrder = nextEntries.map((entry) => entry.id);
      const currentOrder = myPreStealEntries.map((entry) => entry.id);
      if (nextOrder.join(",") !== currentOrder.join(",")) {
        handleReorderPreStealEntries(nextOrder);
      }
      setPreStealDraggedEntryId(null);
    },
    [preStealDraggedEntryId, myPreStealEntries, handleReorderPreStealEntries]
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
      setJoinPrompt(null);
      setLobbyError(null);
      setPendingResultAutoSubmit(null);
      return;
    }
    setLobbyView("list");
  }, [roomState]);

  useEffect(() => {
    if (roomState) return;
    setQueuedTileClaimLetters("");
    setPreStealTriggerInput("");
    setPreStealClaimWordInput("");
    setPreStealDraggedEntryId(null);
  }, [roomState]);

  useEffect(() => {
    if (!practiceState.active) return;
    setJoinPrompt(null);
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
    if (!isInGame) return;

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

  if (!playerName) {
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

      {!roomState && !practiceState.active && lobbyView === "list" && (
        <div className="grid">
          <section className="panel">
            <h2>Open Games</h2>
            <div className="room-list">
              {lobbyRooms.length === 0 && <p className="muted">No open games yet.</p>}
              {lobbyRooms.map((room) => {
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
            </div>
          </section>
        </div>
      )}

      {!roomState && !practiceState.active && lobbyView === "create" && (
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

      {!roomState && !practiceState.active && lobbyView === "editor" && (
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
                  disabled={gameState.turnPlayerId !== selfPlayerId || isFlipRevealActive}
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
                  className={isTileInputMethodEnabled ? "tile tile-selectable" : "tile"}
                  role={isTileInputMethodEnabled ? "button" : undefined}
                  tabIndex={isTileInputMethodEnabled ? 0 : undefined}
                  onClick={
                    isTileInputMethodEnabled ? () => handleClaimTileSelect(tile.letter) : undefined
                  }
                  onKeyDown={
                    isTileInputMethodEnabled
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
                    isTileInputMethodEnabled ? `Use letter ${tile.letter} for claim` : undefined
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
              </div>
            )}
          </section>

          <section className="panel scoreboard">
            <div className="scoreboard-header">
              <h2>Players</h2>
              <button className="button-danger" onClick={() => setShowLeaveGameConfirm(true)}>
                Leave Game
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
          </div>
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

      {joinPrompt && (
        <div className="join-overlay">
          <div className="panel join-modal">
            <h2>Enter room code</h2>
            <p className="muted">{joinPrompt.roomName} is private.</p>
            <input
              type="password"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && joinCode.trim()) {
                  e.preventDefault();
                  handleJoinWithCode();
                }
              }}
              placeholder="Room code"
            />
            <div className="button-row">
              <button
                className="button-secondary"
                onClick={() => {
                  setJoinPrompt(null);
                  setJoinCode("");
                }}
              >
                Cancel
              </button>
              <button onClick={handleJoinWithCode} disabled={!joinCode.trim()}>
                Join game
              </button>
            </div>
          </div>
        </div>
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
