import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Server, Socket } from "socket.io";
import type {
  ClaimEventMeta,
  GameState,
  PendingFlipState,
  Player,
  PreStealEntry,
  PracticeDifficulty,
  PracticeModeState,
  PracticePuzzle,
  PracticeResult,
  PracticeStartRequest,
  PracticeValidateCustomRequest,
  PracticeValidateCustomResponse,
  RoomState,
  RoomSummary,
  Tile,
  Word
} from "../../shared/types.js";
import { createTileBag } from "../../shared/tileBag.js";
import { isValidWord, loadWordSet, normalizeWord } from "../../shared/wordValidation.js";
import {
  clampPracticeDifficulty,
  createPracticeEngine,
  DEFAULT_PRACTICE_DIFFICULTY
} from "./practice.js";
import { resolvePracticeStartRequest, validateCustomPracticePuzzle } from "./practiceShare.js";
import { createTimedOutPracticeResult } from "./practiceTimer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const END_TIMER_MS = 60_000;
const DEFAULT_FLIP_TIMER_SECONDS = 15;
const MIN_FLIP_TIMER_SECONDS = 1;
const MAX_FLIP_TIMER_SECONDS = 60;
const DEFAULT_CLAIM_TIMER_SECONDS = 3;
const MIN_CLAIM_TIMER_SECONDS = 1;
const MAX_CLAIM_TIMER_SECONDS = 10;
const DEFAULT_PRACTICE_TIMER_SECONDS = 60;
const MIN_PRACTICE_TIMER_SECONDS = 10;
const MAX_PRACTICE_TIMER_SECONDS = 120;
const FLIP_REVEAL_MS = 1_000;
const CLAIM_COOLDOWN_MS = 10_000;
const MAX_PLAYERS = 8;

function resolveWordListPath(): string {
  const envPath = process.env.WORD_LIST_PATH ? path.resolve(process.env.WORD_LIST_PATH) : null;
  const candidates = [
    envPath,
    // Prefer the full TWL dictionary in both dev (server/src) and build (server/dist/server/src).
    path.resolve(process.cwd(), "server", "TWL06 Wordlist.txt"),
    path.resolve(process.cwd(), "TWL06 Wordlist.txt"),
    path.resolve(__dirname, "..", "TWL06 Wordlist.txt"),
    path.resolve(__dirname, "..", "..", "..", "TWL06 Wordlist.txt"),
    // Fallback word list.
    path.resolve(process.cwd(), "server", "wordlist.txt"),
    path.resolve(process.cwd(), "wordlist.txt"),
    path.resolve(__dirname, "..", "wordlist.txt"),
    path.resolve(__dirname, "..", "..", "..", "wordlist.txt")
  ].filter((candidate): candidate is string => Boolean(candidate));

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;

  throw new Error(
    `Word list not found. Checked: ${candidates.join(", ")}`
  );
}

const wordListPath = resolveWordListPath();
const wordSet = loadWordSet(wordListPath);
console.log(`[dictionary] Loaded ${wordSet.size} words from ${wordListPath}`);
const practiceEngine = createPracticeEngine(wordSet);

const app = express();
app.use(cors());
app.use(express.json());

const clientDist = path.join(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("/", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

type GameStateInternal = {
  roomId: string;
  status: "in-game" | "ended";
  bag: Tile[];
  centerTiles: Tile[];
  players: Player[];
  turnOrder: string[];
  turnIndex: number;
  turnPlayerId: string;
  lastClaimAt: number | null;
  endTimer?: NodeJS.Timeout;
  endTimerEndsAt?: number;
  flipTimer: {
    enabled: boolean;
    seconds: number;
  };
  flipTimerTimeout?: NodeJS.Timeout;
  flipTimerEndsAt?: number;
  flipTimerToken?: string;
  pendingFlip: (PendingFlipState & { token: string }) | null;
  pendingFlipTimeout?: NodeJS.Timeout;
  claimTimer: {
    seconds: number;
  };
  claimWindow: {
    playerId: string;
    endsAt: number;
    token: string;
  } | null;
  claimWindowTimeout?: NodeJS.Timeout;
  claimCooldowns: Record<string, number>;
  claimCooldownTimeouts: Map<string, NodeJS.Timeout>;
  preStealEnabled: boolean;
  preStealPrecedenceOrder: string[];
  lastClaimEvent: ClaimEventMeta | null;
};

type SessionRecord = {
  sessionId: string;
  playerId: string;
  name: string;
  roomId: string | null;
  socketId: string | null;
};

type SocketData = {
  sessionId?: string;
  playerId?: string;
  roomId?: string;
};

type PracticeModeStateInternal = PracticeModeState & {
  puzzle: PracticePuzzle;
  puzzleTimerTimeout?: NodeJS.Timeout;
  puzzleTimerToken?: string;
};

type PersistedRoomState = RoomState & { maxPlayers?: number };

type PersistedGameState = {
  roomId: string;
  status: "in-game" | "ended";
  bag: Tile[];
  centerTiles: Tile[];
  players: Player[];
  turnOrder: string[];
  turnIndex: number;
  turnPlayerId: string;
  lastClaimAt: number | null;
  endTimerEndsAt?: number;
  flipTimer: {
    enabled: boolean;
    seconds: number;
  };
  flipTimerEndsAt?: number;
  flipTimerToken?: string;
  pendingFlip: (PendingFlipState & { token: string }) | null;
  claimTimer: {
    seconds: number;
  };
  claimWindow: {
    playerId: string;
    endsAt: number;
    token: string;
  } | null;
  claimCooldowns: Record<string, number>;
  preStealEnabled: boolean;
  preStealPrecedenceOrder: string[];
  lastClaimEvent: ClaimEventMeta | null;
};

type PersistedSessionRecord = Omit<SessionRecord, "socketId">;

type PersistedSnapshotV1 = {
  version: 1;
  savedAt: number;
  rooms: PersistedRoomState[];
  games: PersistedGameState[];
  sessions: PersistedSessionRecord[];
};

const rooms = new Map<string, RoomState>();
const games = new Map<string, GameStateInternal>();
const roomQueues = new Map<string, Promise<void>>();
const sessionsById = new Map<string, SessionRecord>();
const sessionsByPlayerId = new Map<string, SessionRecord>();
const socketToSessionId = new Map<string, string>();
const practiceBySessionId = new Map<string, PracticeModeStateInternal>();

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";
const UPSTASH_STATE_KEY = process.env.UPSTASH_REDIS_STATE_KEY?.trim() || "anagram:active-state:v1";
const redisPersistenceEnabled = Boolean(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);

if ((UPSTASH_REDIS_REST_URL || UPSTASH_REDIS_REST_TOKEN) && !redisPersistenceEnabled) {
  console.warn(
    "[persistence] Redis persistence disabled. Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
  );
}

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

function getPracticeStateForSession(sessionId: string): PracticeModeState {
  const existing = practiceBySessionId.get(sessionId);
  if (!existing) {
    return createInactivePracticeState();
  }
  return {
    active: existing.active,
    phase: existing.phase,
    currentDifficulty: existing.currentDifficulty,
    queuedDifficulty: existing.queuedDifficulty,
    timerEnabled: existing.timerEnabled,
    timerSeconds: existing.timerSeconds,
    puzzleTimerEndsAt: existing.puzzleTimerEndsAt,
    puzzle: existing.puzzle,
    result: existing.result
  };
}

function emitPracticeState(socket: Socket, sessionId: string) {
  socket.emit("practice:state", getPracticeStateForSession(sessionId));
}

function emitPracticeStateForSessionId(sessionId: string) {
  const session = sessionsById.get(sessionId);
  if (!session?.socketId) return;
  const sessionSocket = io.sockets.sockets.get(session.socketId);
  if (!sessionSocket) return;
  emitPracticeState(sessionSocket, sessionId);
}

function sanitizeName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 24) : "Player";
}

function sanitizeRoomName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 36) : "New Room";
}

function clampFlipTimerSeconds(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_FLIP_TIMER_SECONDS;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_FLIP_TIMER_SECONDS, Math.max(MIN_FLIP_TIMER_SECONDS, rounded));
}

function clampClaimTimerSeconds(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_CLAIM_TIMER_SECONDS;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_CLAIM_TIMER_SECONDS, Math.max(MIN_CLAIM_TIMER_SECONDS, rounded));
}

function clampPracticeTimerSeconds(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_PRACTICE_TIMER_SECONDS;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_PRACTICE_TIMER_SECONDS, Math.max(MIN_PRACTICE_TIMER_SECONDS, rounded));
}

function clearPracticePuzzleTimer(practiceState: PracticeModeStateInternal) {
  if (practiceState.puzzleTimerTimeout) {
    clearTimeout(practiceState.puzzleTimerTimeout);
    practiceState.puzzleTimerTimeout = undefined;
  }
  practiceState.puzzleTimerToken = undefined;
  practiceState.puzzleTimerEndsAt = null;
}

function startPracticePuzzleTimer(sessionId: string, practiceState: PracticeModeStateInternal) {
  clearPracticePuzzleTimer(practiceState);
  if (!practiceState.timerEnabled) return;
  if (practiceState.phase !== "puzzle") return;

  const token = randomUUID();
  const timeoutMs = practiceState.timerSeconds * 1000;
  practiceState.puzzleTimerToken = token;
  practiceState.puzzleTimerEndsAt = Date.now() + timeoutMs;
  practiceState.puzzleTimerTimeout = setTimeout(() => {
    const currentPracticeState = practiceBySessionId.get(sessionId);
    if (!currentPracticeState || !currentPracticeState.active) return;
    if (currentPracticeState.phase !== "puzzle") return;
    if (currentPracticeState.puzzleTimerToken !== token) return;

    currentPracticeState.phase = "result";
    currentPracticeState.result = createTimedOutPracticeResult(currentPracticeState.puzzle, (candidatePuzzle) =>
      practiceEngine.solvePuzzle(candidatePuzzle)
    );
    clearPracticePuzzleTimer(currentPracticeState);
    emitPracticeStateForSessionId(sessionId);
  }, timeoutMs);
}

function emitError(socket: { emit: Function }, message: string, code?: string) {
  socket.emit("error", { message, code });
}

function getSocketData(socket: Socket): SocketData {
  return socket.data as SocketData;
}

function normalizeSessionId(value: unknown): string {
  if (typeof value !== "string") return randomUUID();
  const trimmed = value.trim();
  if (!trimmed) return randomUUID();
  return trimmed.slice(0, 128);
}

function emitSessionSelf(socket: Socket, session: SessionRecord) {
  socket.emit("session:self", {
    playerId: session.playerId,
    name: session.name,
    roomId: session.roomId
  });
  scheduleStatePersist();
}

function getSessionBySocket(socket: Socket): SessionRecord | null {
  const data = getSocketData(socket);
  const sessionId = data.sessionId ?? socketToSessionId.get(socket.id);
  if (!sessionId) return null;
  return sessionsById.get(sessionId) ?? null;
}

function getActiveSocketForPlayer(playerId: string): Socket | null {
  const session = sessionsByPlayerId.get(playerId);
  if (!session?.socketId) return null;
  return io.sockets.sockets.get(session.socketId) ?? null;
}

function setSessionRoom(session: SessionRecord, roomId: string | null) {
  session.roomId = roomId;
  if (!session.socketId) return;
  const socket = io.sockets.sockets.get(session.socketId);
  if (!socket) return;
  const socketData = getSocketData(socket);
  socketData.roomId = roomId ?? undefined;
}

function bindSocketToSession(socket: Socket, session: SessionRecord) {
  const previousSocketId = session.socketId;
  session.socketId = socket.id;
  socketToSessionId.set(socket.id, session.sessionId);

  const data = getSocketData(socket);
  data.sessionId = session.sessionId;
  data.playerId = session.playerId;
  data.roomId = session.roomId ?? undefined;

  if (previousSocketId && previousSocketId !== socket.id) {
    const previousSocket = io.sockets.sockets.get(previousSocketId);
    if (previousSocket) {
      previousSocket.disconnect(true);
    }
  }
}

let isHydratingState = false;
let persistScheduled = false;
let persistQueue = Promise.resolve();

function isPersistedSnapshotV1(value: unknown): value is PersistedSnapshotV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedSnapshotV1>;
  if (candidate.version !== 1) return false;
  if (!Array.isArray(candidate.rooms)) return false;
  if (!Array.isArray(candidate.games)) return false;
  if (!Array.isArray(candidate.sessions)) return false;
  return true;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getPersistedSnapshot(): PersistedSnapshotV1 {
  const activeRooms = Array.from(rooms.values()).filter((room) => room.status !== "ended");
  const activeRoomIds = new Set(activeRooms.map((room) => room.id));
  const persistedRooms = activeRooms.map((room) => clone(room as PersistedRoomState));
  const persistedGames = Array.from(games.values())
    .filter((game) => game.status !== "ended" && activeRoomIds.has(game.roomId))
    .map((game) =>
    clone({
      roomId: game.roomId,
      status: game.status,
      bag: game.bag,
      centerTiles: game.centerTiles,
      players: game.players,
      turnOrder: game.turnOrder,
      turnIndex: game.turnIndex,
      turnPlayerId: game.turnPlayerId,
      lastClaimAt: game.lastClaimAt,
      endTimerEndsAt: game.endTimerEndsAt,
      flipTimer: game.flipTimer,
      flipTimerEndsAt: game.flipTimerEndsAt,
      flipTimerToken: game.flipTimerToken,
      pendingFlip: game.pendingFlip,
      claimTimer: game.claimTimer,
      claimWindow: game.claimWindow,
      claimCooldowns: game.claimCooldowns,
      preStealEnabled: game.preStealEnabled,
      preStealPrecedenceOrder: game.preStealPrecedenceOrder,
      lastClaimEvent: game.lastClaimEvent
    } satisfies PersistedGameState)
    );
  const persistedSessions = Array.from(sessionsById.values()).map((session) =>
    clone({
      sessionId: session.sessionId,
      playerId: session.playerId,
      name: session.name,
      roomId: session.roomId && activeRoomIds.has(session.roomId) ? session.roomId : null
    } satisfies PersistedSessionRecord)
  );

  return {
    version: 1,
    savedAt: Date.now(),
    rooms: persistedRooms,
    games: persistedGames,
    sessions: persistedSessions
  };
}

function getUpstashHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`
  };
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  return headers;
}

async function upstashGetValue(key: string): Promise<string | null> {
  if (!redisPersistenceEnabled) return null;
  const endpoint = `${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: getUpstashHeaders()
  });
  if (!response.ok) {
    throw new Error(`GET ${endpoint} failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) {
    throw new Error(`GET ${endpoint} returned error: ${payload.error}`);
  }
  if (typeof payload.result !== "string") return null;
  return payload.result;
}

async function upstashSetValue(key: string, value: string): Promise<void> {
  if (!redisPersistenceEnabled) return;
  const endpoint = `${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: getUpstashHeaders("text/plain; charset=utf-8"),
    body: value
  });
  if (!response.ok) {
    throw new Error(`SET ${endpoint} failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) {
    throw new Error(`SET ${endpoint} returned error: ${payload.error}`);
  }
}

async function persistSnapshotNow() {
  if (!redisPersistenceEnabled || isHydratingState) return;
  const snapshot = getPersistedSnapshot();
  await upstashSetValue(UPSTASH_STATE_KEY, JSON.stringify(snapshot));
}

function scheduleStatePersist() {
  if (!redisPersistenceEnabled || isHydratingState) return;
  if (persistScheduled) return;
  persistScheduled = true;
  setTimeout(() => {
    persistScheduled = false;
    persistQueue = persistQueue
      .then(() => persistSnapshotNow())
      .catch((error) => {
        console.error("[persistence] Failed to persist state snapshot", error);
      });
  }, 0);
}

function getRoomSummary(room: RoomState): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    isPublic: room.isPublic,
    playerCount: room.players.length,
    maxPlayers: (room as RoomState & { maxPlayers?: number }).maxPlayers ?? MAX_PLAYERS,
    status: room.status
  };
}

function broadcastRoomList() {
  const summaries = Array.from(rooms.values()).map(getRoomSummary);
  io.emit("room:list", summaries);
  scheduleStatePersist();
}

function emitRoomState(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("room:state", room);
  scheduleStatePersist();
}

function emitGameState(roomId: string) {
  const game = games.get(roomId);
  if (!game) return;
  const buildPublicState = (viewerPlayerId: string | null): GameState => ({
    roomId: game.roomId,
    status: game.status,
    bagCount: game.bag.length,
    centerTiles: game.centerTiles,
    players: game.players.map((player) => ({
      ...player,
      preStealEntries: viewerPlayerId === player.id ? player.preStealEntries : []
    })),
    turnPlayerId: game.turnPlayerId,
    lastClaimAt: game.lastClaimAt,
    endTimerEndsAt: game.endTimerEndsAt,
    claimWindow: game.claimWindow
      ? { playerId: game.claimWindow.playerId, endsAt: game.claimWindow.endsAt }
      : null,
    claimCooldowns: game.claimCooldowns,
    pendingFlip: game.pendingFlip
      ? {
          playerId: game.pendingFlip.playerId,
          startedAt: game.pendingFlip.startedAt,
          revealsAt: game.pendingFlip.revealsAt
        }
      : null,
    preStealEnabled: game.preStealEnabled,
    preStealPrecedenceOrder: game.preStealPrecedenceOrder,
    lastClaimEvent: game.lastClaimEvent
  });

  for (const player of game.players) {
    const activeSocket = getActiveSocketForPlayer(player.id);
    if (!activeSocket) continue;
    activeSocket.emit("game:state", buildPublicState(player.id));
  }
  scheduleStatePersist();
}

function clearEndTimer(game: GameStateInternal) {
  if (game.endTimer) {
    clearTimeout(game.endTimer);
    game.endTimer = undefined;
  }
  game.endTimerEndsAt = undefined;
}

function enqueue(roomId: string, task: () => Promise<void> | void) {
  const current = roomQueues.get(roomId) ?? Promise.resolve();
  const next = current
    .then(async () => {
      await task();
    })
    .catch((error) => {
      console.error(`Room ${roomId} task failed`, error);
    });
  roomQueues.set(roomId, next);
  return next;
}

function countLetters(word: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const letter of word) {
    counts[letter] = (counts[letter] ?? 0) + 1;
  }
  return counts;
}

function addLetterCounts(
  left: Record<string, number>,
  right: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = { ...left };
  for (const [letter, count] of Object.entries(right)) {
    result[letter] = (result[letter] ?? 0) + count;
  }
  return result;
}

function hasAllLetterCounts(
  available: Record<string, number>,
  required: Record<string, number>
): boolean {
  for (const [letter, count] of Object.entries(required)) {
    if ((available[letter] ?? 0) < count) {
      return false;
    }
  }
  return true;
}

function areLetterCountsEqual(
  first: Record<string, number>,
  second: Record<string, number>
): boolean {
  const letters = new Set([...Object.keys(first), ...Object.keys(second)]);
  for (const letter of letters) {
    if ((first[letter] ?? 0) !== (second[letter] ?? 0)) {
      return false;
    }
  }
  return true;
}

function normalizePreStealInput(value: unknown): string {
  if (typeof value !== "string") return "";
  return normalizeWord(value);
}

function selectTilesForWord(word: string, tiles: Tile[]): Tile[] | null {
  const remaining = [...tiles];
  const selected: Tile[] = [];
  for (const letter of word) {
    const index = remaining.findIndex((tile) => tile.letter === letter);
    if (index === -1) return null;
    selected.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return selected;
}

type ClaimTargetCandidate = {
  target: Word;
  owner: Player;
  selectedTiles: Tile[];
  required: Record<string, number>;
  requiredTotal: number;
};

type ClaimSelection = {
  selectedTiles: Tile[];
  combinedTileIds: string[];
  replacedWordOwner: Player | null;
  replacedWord: Word | null;
};

type ClaimSelectionOptions = {
  requiredFromCenterExact?: Record<string, number>;
};

function getClaimSelection(
  game: GameStateInternal,
  player: Player,
  normalizedWord: string,
  options: ClaimSelectionOptions = {}
): ClaimSelection | null {
  const wordCounts = countLetters(normalizedWord);
  const stealCandidates: ClaimTargetCandidate[] = [];
  const extendCandidates: ClaimTargetCandidate[] = [];

  for (const owner of game.players) {
    for (const target of owner.words) {
      const targetCounts = countLetters(target.text);
      if (!hasAllLetterCounts(wordCounts, targetCounts)) continue;

      const required: Record<string, number> = {};
      let requiredTotal = 0;
      for (const [letter, count] of Object.entries(wordCounts)) {
        const diff = count - (targetCounts[letter] ?? 0);
        if (diff > 0) {
          required[letter] = diff;
          requiredTotal += diff;
        }
      }

      if (requiredTotal < 1) continue;
      if (
        options.requiredFromCenterExact &&
        !areLetterCountsEqual(required, options.requiredFromCenterExact)
      ) {
        continue;
      }

      if (normalizedWord.includes(target.text)) continue;

      const selectedTiles = selectTilesForCounts(required, game.centerTiles);
      if (!selectedTiles) continue;

      const candidate: ClaimTargetCandidate = {
        target,
        owner,
        selectedTiles,
        required,
        requiredTotal
      };
      if (owner.id === player.id) {
        extendCandidates.push(candidate);
      } else {
        stealCandidates.push(candidate);
      }
    }
  }

  const sortCandidates = (a: ClaimTargetCandidate, b: ClaimTargetCandidate) => {
    if (a.requiredTotal !== b.requiredTotal) {
      return a.requiredTotal - b.requiredTotal;
    }
    if (a.target.createdAt !== b.target.createdAt) {
      return a.target.createdAt - b.target.createdAt;
    }
    return a.target.text.localeCompare(b.target.text);
  };
  stealCandidates.sort(sortCandidates);
  extendCandidates.sort(sortCandidates);

  if (stealCandidates.length > 0) {
    const chosen = stealCandidates[0];
    return {
      selectedTiles: chosen.selectedTiles,
      combinedTileIds: [...chosen.target.tileIds, ...chosen.selectedTiles.map((tile) => tile.id)],
      replacedWordOwner: chosen.owner,
      replacedWord: chosen.target
    };
  }

  if (extendCandidates.length > 0) {
    const chosen = extendCandidates[0];
    return {
      selectedTiles: chosen.selectedTiles,
      combinedTileIds: [...chosen.target.tileIds, ...chosen.selectedTiles.map((tile) => tile.id)],
      replacedWordOwner: chosen.owner,
      replacedWord: chosen.target
    };
  }

  if (options.requiredFromCenterExact) {
    return null;
  }

  const selectedTiles = selectTilesForWord(normalizedWord, game.centerTiles);
  if (!selectedTiles) return null;

  return {
    selectedTiles,
    combinedTileIds: selectedTiles.map((tile) => tile.id),
    replacedWordOwner: null,
    replacedWord: null
  };
}

function entryMatchesExistingWord(entry: PreStealEntry, targetWord: Word): boolean {
  if (entry.claimWord.includes(targetWord.text)) return false;
  const claimCounts = countLetters(entry.claimWord);
  const targetCounts = countLetters(targetWord.text);
  const triggerCounts = countLetters(entry.triggerLetters);
  return areLetterCountsEqual(claimCounts, addLetterCounts(targetCounts, triggerCounts));
}

function isPreStealEntryValid(game: GameStateInternal, entry: PreStealEntry): boolean {
  if (!entry.triggerLetters || !/^[A-Z]+$/.test(entry.triggerLetters)) return false;
  if (!entry.claimWord || !/^[A-Z]+$/.test(entry.claimWord)) return false;
  if (!isValidWord(entry.claimWord, wordSet)) return false;

  for (const owner of game.players) {
    for (const target of owner.words) {
      if (entryMatchesExistingWord(entry, target)) {
        return true;
      }
    }
  }

  return false;
}

function revalidateAllPreStealEntries(game: GameStateInternal) {
  if (!game.preStealEnabled) return;
  for (const player of game.players) {
    player.preStealEntries = player.preStealEntries.filter((entry) => isPreStealEntryValid(game, entry));
  }
}

type ClaimSource = "manual" | "pre-steal";

type ClaimExecutionResult = {
  newWord: Word;
  replacedWord: Word | null;
};

function executeClaim(
  game: GameStateInternal,
  player: Player,
  normalizedWord: string,
  source: ClaimSource,
  options: ClaimSelectionOptions = {}
): ClaimExecutionResult | null {
  const selection = getClaimSelection(game, player, normalizedWord, options);
  if (!selection) return null;

  const now = Date.now();
  const newWord: Word = {
    id: randomUUID(),
    text: normalizedWord,
    tileIds: selection.combinedTileIds,
    ownerId: player.id,
    createdAt: now
  };

  if (selection.replacedWordOwner && selection.replacedWord) {
    selection.replacedWordOwner.words = selection.replacedWordOwner.words.filter(
      (entry) => entry.id !== selection.replacedWord!.id
    );
  }

  player.words.push(newWord);
  removeTilesFromCenter(game, selection.selectedTiles.map((tile) => tile.id));
  updateScores(game);
  revalidateAllPreStealEntries(game);

  game.lastClaimAt = now;
  game.lastClaimEvent = {
    eventId: randomUUID(),
    wordId: newWord.id,
    claimantId: player.id,
    replacedWordId: selection.replacedWord?.id ?? null,
    source,
    movedToBottomOfPreStealPrecedence: false
  };

  if (game.bag.length === 0) {
    scheduleEndTimer(game);
  }

  return {
    newWord,
    replacedWord: selection.replacedWord
  };
}

function maybeRunAutoPreSteal(game: GameStateInternal): boolean {
  if (!game.preStealEnabled) return false;
  const centerCounts = countLetters(game.centerTiles.map((tile) => tile.letter).join(""));

  for (const playerId of game.preStealPrecedenceOrder) {
    const player = game.players.find((entry) => entry.id === playerId);
    if (!player || !player.connected) continue;

    for (const entry of player.preStealEntries) {
      const triggerCounts = countLetters(entry.triggerLetters);
      if (!hasAllLetterCounts(centerCounts, triggerCounts)) continue;
      if (!isPreStealEntryValid(game, entry)) continue;

      const claimResult = executeClaim(game, player, entry.claimWord, "pre-steal", {
        requiredFromCenterExact: triggerCounts
      });
      if (!claimResult) continue;

      game.preStealPrecedenceOrder = game.preStealPrecedenceOrder.filter((id) => id !== player.id);
      game.preStealPrecedenceOrder.push(player.id);
      if (game.lastClaimEvent) {
        game.lastClaimEvent.movedToBottomOfPreStealPrecedence = true;
      }
      return true;
    }
  }

  return false;
}

function selectTilesForCounts(required: Record<string, number>, tiles: Tile[]): Tile[] | null {
  const remaining = [...tiles];
  const selected: Tile[] = [];
  for (const [letter, count] of Object.entries(required)) {
    for (let i = 0; i < count; i += 1) {
      const index = remaining.findIndex((tile) => tile.letter === letter);
      if (index === -1) return null;
      selected.push(remaining[index]);
      remaining.splice(index, 1);
    }
  }
  return selected;
}

function updateScores(game: GameStateInternal) {
  game.players.forEach((player) => {
    player.score = player.words.reduce((sum, word) => sum + word.text.length, 0);
  });
}

function clearFlipTimer(game: GameStateInternal) {
  if (game.flipTimerTimeout) {
    clearTimeout(game.flipTimerTimeout);
    game.flipTimerTimeout = undefined;
  }
  game.flipTimerEndsAt = undefined;
  game.flipTimerToken = undefined;
}

function clearPendingFlip(game: GameStateInternal) {
  if (game.pendingFlipTimeout) {
    clearTimeout(game.pendingFlipTimeout);
    game.pendingFlipTimeout = undefined;
  }
  game.pendingFlip = null;
}

function handleFlipTimerElapsed(roomId: string, token: string, turnPlayerId: string) {
  enqueue(roomId, () => {
    const current = games.get(roomId);
    if (!current) return;
    if (current.status !== "in-game") return;
    if (!current.flipTimer.enabled) return;
    if (current.flipTimerToken !== token) return;
    if (current.turnPlayerId !== turnPlayerId) return;
    if (!beginPendingFlip(current, turnPlayerId)) return;
    emitGameState(current.roomId);
  });
}

function startFlipTimerCountdown(
  game: GameStateInternal,
  token: string,
  turnPlayerId: string,
  endsAt: number
) {
  game.flipTimerToken = token;
  game.flipTimerEndsAt = endsAt;
  const delayMs = Math.max(0, endsAt - Date.now());
  game.flipTimerTimeout = setTimeout(() => {
    handleFlipTimerElapsed(game.roomId, token, turnPlayerId);
  }, delayMs);
}

function scheduleFlipTimer(game: GameStateInternal) {
  clearFlipTimer(game);
  if (!game.flipTimer.enabled) return;
  if (game.status !== "in-game") return;
  if (game.bag.length === 0) return;
  if (game.pendingFlip) return;

  const token = randomUUID();
  const turnPlayerId = game.turnPlayerId;
  const endsAt = Date.now() + game.flipTimer.seconds * 1000;
  startFlipTimerCountdown(game, token, turnPlayerId, endsAt);
}

function startPendingFlipRevealCountdown(
  game: GameStateInternal,
  pendingFlip: PendingFlipState & { token: string }
) {
  const delayMs = Math.max(0, pendingFlip.revealsAt - Date.now());
  game.pendingFlipTimeout = setTimeout(() => {
    enqueue(game.roomId, () => {
      const current = games.get(game.roomId);
      if (!current) return;
      if (!current.pendingFlip || current.pendingFlip.token !== pendingFlip.token) return;
      if (!revealPendingFlip(current, pendingFlip.token)) return;
      emitGameState(current.roomId);
    });
  }, delayMs);
}

function emitErrorToPlayer(playerId: string, message: string) {
  const socket = getActiveSocketForPlayer(playerId);
  if (!socket) return;
  socket.emit("error", { message });
}

function clearClaimWindow(game: GameStateInternal) {
  if (game.claimWindowTimeout) {
    clearTimeout(game.claimWindowTimeout);
    game.claimWindowTimeout = undefined;
  }
  game.claimWindow = null;
}

function clearGameTimers(game: GameStateInternal) {
  clearFlipTimer(game);
  clearPendingFlip(game);
  clearClaimWindow(game);
  clearAllClaimCooldowns(game);
  clearEndTimer(game);
}

function clearClaimCooldown(game: GameStateInternal, playerId: string) {
  const timeout = game.claimCooldownTimeouts.get(playerId);
  if (timeout) {
    clearTimeout(timeout);
  }
  game.claimCooldownTimeouts.delete(playerId);
  delete game.claimCooldowns[playerId];
}

function clearAllClaimCooldowns(game: GameStateInternal) {
  Object.keys(game.claimCooldowns).forEach((playerId) => clearClaimCooldown(game, playerId));
}

function startClaimCooldownAt(game: GameStateInternal, playerId: string, endsAt: number) {
  clearClaimCooldown(game, playerId);
  game.claimCooldowns[playerId] = endsAt;
  const delayMs = Math.max(0, endsAt - Date.now());
  const timeout = setTimeout(() => {
    enqueue(game.roomId, () => {
      const current = games.get(game.roomId);
      if (!current) return;
      if (current.claimCooldowns[playerId] !== endsAt) return;
      clearClaimCooldown(current, playerId);
      emitGameState(current.roomId);
    });
  }, delayMs);
  game.claimCooldownTimeouts.set(playerId, timeout);
}

function startClaimCooldown(game: GameStateInternal, playerId: string) {
  startClaimCooldownAt(game, playerId, Date.now() + CLAIM_COOLDOWN_MS);
}

function isClaimCooldownActive(game: GameStateInternal, playerId: string): boolean {
  const endsAt = game.claimCooldowns[playerId];
  if (!endsAt) return false;
  if (endsAt <= Date.now()) {
    clearClaimCooldown(game, playerId);
    return false;
  }
  return true;
}

function scheduleClaimWindowTimeout(
  game: GameStateInternal,
  claimWindow: { playerId: string; endsAt: number; token: string }
) {
  const delayMs = Math.max(0, claimWindow.endsAt - Date.now());
  game.claimWindowTimeout = setTimeout(() => {
    enqueue(game.roomId, () => {
      const current = games.get(game.roomId);
      if (!current) return;
      if (!current.claimWindow || current.claimWindow.token !== claimWindow.token) return;
      const claimantId = current.claimWindow.playerId;
      clearClaimWindow(current);
      startClaimCooldown(current, claimantId);
      emitErrorToPlayer(claimantId, "Claim window expired.");
      emitGameState(current.roomId);
    });
  }, delayMs);
}

function openClaimWindow(game: GameStateInternal, playerId: string) {
  clearClaimWindow(game);
  const token = randomUUID();
  const durationMs = game.claimTimer.seconds * 1000;
  const endsAt = Date.now() + durationMs;
  game.claimWindow = { playerId, endsAt, token };
  scheduleClaimWindowTimeout(game, game.claimWindow);
}

function finalizeEndedGame(roomId: string) {
  const game = games.get(roomId);
  if (!game) return;
  clearEndTimer(game);
  clearClaimWindow(game);
  clearAllClaimCooldowns(game);
  clearPendingFlip(game);
  clearFlipTimer(game);
  game.status = "ended";
  const room = rooms.get(roomId);
  if (room) {
    room.status = "ended";
    emitRoomState(room.id);
    broadcastRoomList();
  }
  emitGameState(roomId);
}

function scheduleEndTimerAt(game: GameStateInternal, endsAt: number) {
  if (game.endTimer) {
    clearTimeout(game.endTimer);
  }
  clearFlipTimer(game);
  clearPendingFlip(game);
  game.endTimerEndsAt = endsAt;
  const delayMs = Math.max(0, endsAt - Date.now());
  game.endTimer = setTimeout(() => {
    finalizeEndedGame(game.roomId);
  }, delayMs);
}

function scheduleEndTimer(game: GameStateInternal) {
  scheduleEndTimerAt(game, Date.now() + END_TIMER_MS);
}

function beginPendingFlip(game: GameStateInternal, playerId: string): boolean {
  if (game.status !== "in-game") return false;
  if (game.pendingFlip) return false;
  if (game.bag.length === 0) return false;
  clearFlipTimer(game);

  const token = randomUUID();
  const startedAt = Date.now();
  const revealsAt = startedAt + FLIP_REVEAL_MS;
  game.pendingFlip = {
    token,
    playerId,
    startedAt,
    revealsAt
  };

  startPendingFlipRevealCountdown(game, game.pendingFlip);

  return true;
}

function revealPendingFlip(game: GameStateInternal, token: string): boolean {
  if (!game.pendingFlip || game.pendingFlip.token !== token) return false;
  const pendingFlip = game.pendingFlip;
  clearPendingFlip(game);
  if (game.status !== "in-game") return false;
  if (game.bag.length === 0) return false;

  const tile = game.bag.shift();
  if (!tile) return false;
  game.centerTiles.push(tile);
  game.lastClaimEvent = null;
  clearAllClaimCooldowns(game);
  maybeRunAutoPreSteal(game);
  if (game.turnPlayerId === pendingFlip.playerId) {
    advanceTurn(game);
  }

  if (game.bag.length === 0) {
    scheduleEndTimer(game);
  } else {
    scheduleFlipTimer(game);
  }
  return true;
}

function advanceTurn(game: GameStateInternal) {
  const total = game.turnOrder.length;
  if (total === 0) return;
  let nextIndex = game.turnIndex;
  for (let i = 0; i < total; i += 1) {
    nextIndex = (nextIndex + 1) % total;
    const nextPlayerId = game.turnOrder[nextIndex];
    const nextPlayer = game.players.find((player) => player.id === nextPlayerId);
    if (nextPlayer?.connected) {
      game.turnIndex = nextIndex;
      game.turnPlayerId = nextPlayerId;
      return;
    }
  }
}

function removeTilesFromCenter(game: GameStateInternal, tileIds: string[]) {
  const removeSet = new Set(tileIds);
  game.centerTiles = game.centerTiles.filter((tile) => !removeSet.has(tile.id));
}

function selectNextHost(room: RoomState) {
  const nextHost = room.players.find((player) => player.connected) ?? room.players[0];
  if (nextHost) {
    room.hostId = nextHost.id;
  }
}

function cleanupRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (room) {
    room.players.forEach((player) => {
      const session = sessionsByPlayerId.get(player.id);
      if (!session) return;
      if (session.roomId !== roomId) return;
      setSessionRoom(session, null);
      if (session.socketId) {
        const socket = io.sockets.sockets.get(session.socketId);
        if (socket) {
          emitSessionSelf(socket, session);
        }
      }
    });
  }

  const game = games.get(roomId);
  if (game) {
    clearGameTimers(game);
    games.delete(roomId);
  }
  rooms.delete(roomId);
  roomQueues.delete(roomId);
  broadcastRoomList();
  scheduleStatePersist();
}

function removePlayerFromGame(game: GameStateInternal, playerId: string) {
  const previousTurnPlayerId = game.turnPlayerId;
  clearClaimCooldown(game, playerId);
  game.players = game.players.filter((player) => player.id !== playerId);
  game.turnOrder = game.turnOrder.filter((id) => id !== playerId);
  game.preStealPrecedenceOrder = game.preStealPrecedenceOrder.filter((id) => id !== playerId);

  if (game.players.length === 0) {
    game.turnPlayerId = "";
    game.turnIndex = 0;
    return { turnPlayerChanged: previousTurnPlayerId !== game.turnPlayerId };
  }

  if (game.claimWindow?.playerId === playerId) {
    clearClaimWindow(game);
  }

  if (game.turnOrder.length === 0) {
    game.turnPlayerId = "";
    return { turnPlayerChanged: previousTurnPlayerId !== game.turnPlayerId };
  }

  if (game.turnPlayerId === playerId || !game.turnOrder.includes(game.turnPlayerId)) {
    game.turnIndex = 0;
    game.turnPlayerId = game.turnOrder[0];
  } else {
    game.turnIndex = Math.max(0, game.turnOrder.indexOf(game.turnPlayerId));
  }

  revalidateAllPreStealEntries(game);

  return { turnPlayerChanged: previousTurnPlayerId !== game.turnPlayerId };
}

function handlePlayerLeave(roomId: string, playerId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const session = sessionsByPlayerId.get(playerId);
  if (session && session.roomId === roomId) {
    setSessionRoom(session, null);
    if (session.socketId) {
      const socket = io.sockets.sockets.get(session.socketId);
      if (socket) {
        emitSessionSelf(socket, session);
      }
    }
  }

  room.players = room.players.filter((player) => player.id !== playerId);
  if (room.hostId === playerId) {
    selectNextHost(room);
  }

  const game = games.get(roomId);
  if (game) {
    const { turnPlayerChanged } = removePlayerFromGame(game, playerId);
    if (game.players.length === 0) {
      cleanupRoom(roomId);
      return;
    }
    if (game.status === "in-game" && turnPlayerChanged) {
      scheduleFlipTimer(game);
    }
    emitGameState(roomId);
  }

  if (room.players.length === 0) {
    cleanupRoom(roomId);
    return;
  }

  emitRoomState(roomId);
  broadcastRoomList();
}

function markPlayerDisconnectedInGame(game: GameStateInternal, playerId: string) {
  const player = game.players.find((entry) => entry.id === playerId);
  if (!player) {
    return { turnPlayerChanged: false };
  }

  const previousTurnPlayerId = game.turnPlayerId;
  player.connected = false;

  if (game.claimWindow?.playerId === playerId) {
    clearClaimWindow(game);
    startClaimCooldown(game, playerId);
  }

  if (game.turnPlayerId === playerId) {
    advanceTurn(game);
  }

  return { turnPlayerChanged: previousTurnPlayerId !== game.turnPlayerId };
}

function handlePlayerDisconnect(roomId: string, playerId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const roomPlayer = room.players.find((player) => player.id === playerId);
  if (!roomPlayer) return;
  roomPlayer.connected = false;
  if (room.hostId === playerId) {
    selectNextHost(room);
  }

  const game = games.get(roomId);
  if (game) {
    const { turnPlayerChanged } = markPlayerDisconnectedInGame(game, playerId);
    if (game.status === "in-game" && turnPlayerChanged) {
      scheduleFlipTimer(game);
    }
    emitGameState(roomId);
  }

  if (room.status !== "in-game") {
    const connectedCount = room.players.filter((player) => player.connected).length;
    if (connectedCount === 0) {
      cleanupRoom(roomId);
      return;
    }
  }

  emitRoomState(roomId);
  broadcastRoomList();
}

function hydrateGameState(persistedGame: PersistedGameState): GameStateInternal {
  return {
    roomId: persistedGame.roomId,
    status: persistedGame.status,
    bag: clone(persistedGame.bag),
    centerTiles: clone(persistedGame.centerTiles),
    players: clone(persistedGame.players).map((player) => ({
      ...player,
      connected: false,
      preStealEntries: player.preStealEntries ?? []
    })),
    turnOrder: [...persistedGame.turnOrder],
    turnIndex: persistedGame.turnIndex,
    turnPlayerId: persistedGame.turnPlayerId,
    lastClaimAt: persistedGame.lastClaimAt,
    endTimerEndsAt: persistedGame.endTimerEndsAt,
    flipTimer: { ...persistedGame.flipTimer },
    flipTimerEndsAt: persistedGame.flipTimerEndsAt,
    flipTimerToken: persistedGame.flipTimerToken,
    pendingFlip: persistedGame.pendingFlip ? { ...persistedGame.pendingFlip } : null,
    claimTimer: { ...persistedGame.claimTimer },
    claimWindow: persistedGame.claimWindow ? { ...persistedGame.claimWindow } : null,
    claimCooldowns: { ...persistedGame.claimCooldowns },
    claimCooldownTimeouts: new Map(),
    preStealEnabled: persistedGame.preStealEnabled,
    preStealPrecedenceOrder: [...persistedGame.preStealPrecedenceOrder],
    lastClaimEvent: persistedGame.lastClaimEvent ? { ...persistedGame.lastClaimEvent } : null
  };
}

function restoreGameTimers(game: GameStateInternal) {
  if (game.status === "ended") {
    clearGameTimers(game);
    return;
  }

  const now = Date.now();

  if (game.pendingFlip) {
    if (game.pendingFlip.revealsAt <= now) {
      const token = game.pendingFlip.token;
      revealPendingFlip(game, token);
    } else {
      startPendingFlipRevealCountdown(game, game.pendingFlip);
    }
  }

  if (game.claimWindow) {
    if (game.claimWindow.endsAt <= now) {
      const claimantId = game.claimWindow.playerId;
      clearClaimWindow(game);
      startClaimCooldown(game, claimantId);
    } else {
      scheduleClaimWindowTimeout(game, game.claimWindow);
    }
  }

  for (const [playerId, endsAt] of Object.entries({ ...game.claimCooldowns })) {
    if (endsAt <= now) {
      clearClaimCooldown(game, playerId);
      continue;
    }
    startClaimCooldownAt(game, playerId, endsAt);
  }

  if (typeof game.endTimerEndsAt === "number") {
    if (game.endTimerEndsAt <= now) {
      finalizeEndedGame(game.roomId);
      return;
    }
    scheduleEndTimerAt(game, game.endTimerEndsAt);
    return;
  }

  if (!game.flipTimer.enabled || game.pendingFlip || game.bag.length === 0) {
    return;
  }

  if (
    game.flipTimerToken &&
    typeof game.flipTimerEndsAt === "number" &&
    game.flipTimerEndsAt > now
  ) {
    startFlipTimerCountdown(game, game.flipTimerToken, game.turnPlayerId, game.flipTimerEndsAt);
    return;
  }

  if (
    game.flipTimerToken &&
    typeof game.flipTimerEndsAt === "number" &&
    game.flipTimerEndsAt <= now
  ) {
    handleFlipTimerElapsed(game.roomId, game.flipTimerToken, game.turnPlayerId);
    return;
  }

  scheduleFlipTimer(game);
}

async function hydrateStateFromRedis() {
  if (!redisPersistenceEnabled) {
    console.log("[persistence] Redis persistence disabled");
    return;
  }

  try {
    const snapshotRaw = await upstashGetValue(UPSTASH_STATE_KEY);
    if (!snapshotRaw) {
      console.log("[persistence] No snapshot found");
      return;
    }
    const parsed = JSON.parse(snapshotRaw) as unknown;
    if (!isPersistedSnapshotV1(parsed)) {
      console.warn("[persistence] Snapshot format is invalid, skipping hydration");
      return;
    }

    isHydratingState = true;
    rooms.clear();
    games.clear();
    roomQueues.clear();
    sessionsById.clear();
    sessionsByPlayerId.clear();
    socketToSessionId.clear();

    for (const persistedRoom of parsed.rooms) {
      const room = clone(persistedRoom);
      room.players = room.players.map((player) => ({
        ...player,
        connected: false,
        preStealEntries: player.preStealEntries ?? []
      }));
      rooms.set(room.id, room);
    }

    for (const persistedSession of parsed.sessions) {
      const session: SessionRecord = {
        sessionId: persistedSession.sessionId,
        playerId: persistedSession.playerId,
        name: persistedSession.name,
        roomId: persistedSession.roomId,
        socketId: null
      };
      if (session.roomId && !rooms.has(session.roomId)) {
        session.roomId = null;
      }
      sessionsById.set(session.sessionId, session);
      sessionsByPlayerId.set(session.playerId, session);
    }

    for (const persistedGame of parsed.games) {
      if (!rooms.has(persistedGame.roomId)) continue;
      const game = hydrateGameState(persistedGame);
      games.set(game.roomId, game);
    }

    for (const game of games.values()) {
      const room = rooms.get(game.roomId);
      if (!room) continue;
      if (room.status !== game.status) {
        room.status = game.status;
      }
      restoreGameTimers(game);
    }

    console.log(
      `[persistence] Hydrated ${rooms.size} rooms, ${games.size} games, ${sessionsById.size} sessions`
    );
  } catch (error) {
    console.error("[persistence] Failed to hydrate state from Redis", error);
  } finally {
    isHydratingState = false;
    scheduleStatePersist();
  }
}

io.on("connection", (socket) => {
  const socketData = getSocketData(socket);
  const auth = socket.handshake.auth as { sessionId?: unknown } | undefined;
  const incomingSessionId = normalizeSessionId(auth?.sessionId);

  let session = sessionsById.get(incomingSessionId);
  if (!session) {
    session = {
      sessionId: incomingSessionId,
      playerId: randomUUID(),
      name: "Player",
      roomId: null,
      socketId: null
    };
    sessionsById.set(session.sessionId, session);
    sessionsByPlayerId.set(session.playerId, session);
  }
  bindSocketToSession(socket, session);

  const restoreRoomId = session.roomId;
  if (restoreRoomId) {
    const room = rooms.get(restoreRoomId);
    if (!room) {
      setSessionRoom(session, null);
    } else {
      const roomPlayer = room.players.find((player) => player.id === session.playerId);
      if (!roomPlayer) {
        setSessionRoom(session, null);
      } else {
        roomPlayer.connected = true;
        roomPlayer.name = sanitizeName(session.name);
        socket.join(restoreRoomId);
        socketData.roomId = restoreRoomId;

        const game = games.get(restoreRoomId);
        if (game) {
          const gamePlayer = game.players.find((player) => player.id === session.playerId);
          if (gamePlayer) {
            gamePlayer.connected = true;
            gamePlayer.name = roomPlayer.name;
          }
          emitGameState(restoreRoomId);
        }
        emitRoomState(restoreRoomId);
        broadcastRoomList();
      }
    }
  }
  emitSessionSelf(socket, session);
  emitPracticeState(socket, session.sessionId);

  socket.on("room:list", () => {
    socket.emit("room:list", Array.from(rooms.values()).map(getRoomSummary));
  });

  socket.on("practice:start", (request: PracticeStartRequest = {}) => {
    const currentSession = getSessionBySocket(socket);
    if (!currentSession) {
      emitError(socket, "Session not found.");
      return;
    }
    if (getSocketData(socket).roomId) {
      emitError(socket, "Leave your room before entering practice mode.");
      return;
    }

    const startResolution = resolvePracticeStartRequest(request, {
      generatePuzzle: (difficulty) => practiceEngine.generatePuzzle(difficulty),
      solvePuzzle: (candidatePuzzle) => practiceEngine.solvePuzzle(candidatePuzzle)
    });
    if (!startResolution.ok) {
      emitError(socket, startResolution.message);
      return;
    }
    const {
      difficulty: resolvedDifficulty,
      puzzle,
      timerEnabled: resolvedTimerEnabled,
      timerSeconds: resolvedTimerSeconds
    } = startResolution;

    const existingPracticeState = practiceBySessionId.get(currentSession.sessionId);
    if (existingPracticeState) {
      clearPracticePuzzleTimer(existingPracticeState);
    }
    const nextState: PracticeModeStateInternal = {
      active: true,
      phase: "puzzle",
      currentDifficulty: resolvedDifficulty,
      queuedDifficulty: resolvedDifficulty,
      timerEnabled: resolvedTimerEnabled,
      timerSeconds: clampPracticeTimerSeconds(resolvedTimerSeconds),
      puzzleTimerEndsAt: null,
      puzzle,
      result: null
    };
    practiceBySessionId.set(currentSession.sessionId, nextState);
    startPracticePuzzleTimer(currentSession.sessionId, nextState);
    emitPracticeState(socket, currentSession.sessionId);
  });

  socket.on(
    "practice:validate-custom",
    (
      request: PracticeValidateCustomRequest | undefined,
      callback?: (response: PracticeValidateCustomResponse) => void
    ) => {
      const response = validateCustomPracticePuzzle(request?.sharedPuzzle, (candidatePuzzle) =>
        practiceEngine.solvePuzzle(candidatePuzzle)
      );
      if (typeof callback === "function") {
        callback(response);
      }
    }
  );

  socket.on("practice:set-difficulty", ({ difficulty }: { difficulty: PracticeDifficulty }) => {
    const currentSession = getSessionBySocket(socket);
    if (!currentSession) {
      emitError(socket, "Session not found.");
      return;
    }

    const practiceState = practiceBySessionId.get(currentSession.sessionId);
    if (!practiceState || !practiceState.active) {
      emitError(socket, "Start practice mode first.");
      return;
    }

    practiceState.queuedDifficulty = clampPracticeDifficulty(difficulty);
    emitPracticeState(socket, currentSession.sessionId);
  });

  function advancePracticePuzzle(sessionId: string) {
    const practiceState = practiceBySessionId.get(sessionId);
    if (!practiceState || !practiceState.active) return false;

    clearPracticePuzzleTimer(practiceState);
    const nextDifficulty = practiceState.queuedDifficulty;
    practiceState.currentDifficulty = nextDifficulty;
    practiceState.phase = "puzzle";
    practiceState.puzzle = practiceEngine.generatePuzzle(nextDifficulty);
    practiceState.result = null;
    startPracticePuzzleTimer(sessionId, practiceState);
    return true;
  }

  socket.on("practice:submit", ({ word }: { word: string }) => {
    const currentSession = getSessionBySocket(socket);
    if (!currentSession) {
      emitError(socket, "Session not found.");
      return;
    }

    const practiceState = practiceBySessionId.get(currentSession.sessionId);
    if (!practiceState || !practiceState.active || practiceState.phase !== "puzzle") {
      emitError(socket, "No active puzzle to score.");
      return;
    }

    const submittedWord = typeof word === "string" ? word : "";
    const result: PracticeResult = practiceEngine.evaluateSubmission(practiceState.puzzle, submittedWord);
    if (!result.isValid) {
      emitError(socket, result.invalidReason ?? "Word is not valid.");
      return;
    }
    clearPracticePuzzleTimer(practiceState);
    practiceState.phase = "result";
    practiceState.result = result;
    emitPracticeState(socket, currentSession.sessionId);
  });

  socket.on("practice:next", () => {
    const currentSession = getSessionBySocket(socket);
    if (!currentSession) {
      emitError(socket, "Session not found.");
      return;
    }
    if (!advancePracticePuzzle(currentSession.sessionId)) {
      emitError(socket, "Start practice mode first.");
      return;
    }
    emitPracticeState(socket, currentSession.sessionId);
  });

  socket.on("practice:skip", () => {
    const currentSession = getSessionBySocket(socket);
    if (!currentSession) {
      emitError(socket, "Session not found.");
      return;
    }
    if (!advancePracticePuzzle(currentSession.sessionId)) {
      emitError(socket, "Start practice mode first.");
      return;
    }
    emitPracticeState(socket, currentSession.sessionId);
  });

  socket.on("practice:exit", () => {
    const currentSession = getSessionBySocket(socket);
    if (!currentSession) {
      emitError(socket, "Session not found.");
      return;
    }
    const practiceState = practiceBySessionId.get(currentSession.sessionId);
    if (practiceState) {
      clearPracticePuzzleTimer(practiceState);
    }
    practiceBySessionId.delete(currentSession.sessionId);
    emitPracticeState(socket, currentSession.sessionId);
  });

  socket.on("session:update-name", ({ name }: { name: string }) => {
    const currentSession = getSessionBySocket(socket);
    if (!currentSession) return;

    const resolvedName = sanitizeName(typeof name === "string" ? name : "");
    currentSession.name = resolvedName;
    emitSessionSelf(socket, currentSession);

    const roomId = getSocketData(socket).roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) {
      setSessionRoom(currentSession, null);
      emitSessionSelf(socket, currentSession);
      return;
    }

    const roomPlayer = room.players.find((player) => player.id === currentSession.playerId);
    if (roomPlayer) {
      roomPlayer.name = resolvedName;
      roomPlayer.connected = true;
    }

    const game = games.get(roomId);
    if (game) {
      const gamePlayer = game.players.find((player) => player.id === currentSession.playerId);
      if (gamePlayer) {
        gamePlayer.name = resolvedName;
        gamePlayer.connected = true;
      }
      emitGameState(roomId);
    }

    emitRoomState(roomId);
    broadcastRoomList();
  });

  socket.on(
    "room:create",
    ({
      roomName,
      playerName,
      name,
      isPublic,
      maxPlayers,
      flipTimerEnabled,
      flipTimerSeconds,
      claimTimerSeconds,
      preStealEnabled
    }: {
      roomName?: string;
      playerName?: string;
      name?: string;
      isPublic: boolean;
      maxPlayers: number;
      flipTimerEnabled?: boolean;
      flipTimerSeconds?: number;
      claimTimerSeconds?: number;
      preStealEnabled?: boolean;
    }) => {
      const currentSession = getSessionBySocket(socket);
      if (!currentSession) {
        emitError(socket, "Session not found.");
        return;
      }
      if (getPracticeStateForSession(currentSession.sessionId).active) {
        emitError(socket, "Exit practice mode before creating a room.");
        return;
      }

      if (getSocketData(socket).roomId) {
        emitError(socket, "You are already in a room.");
        return;
      }

      const resolvedRoomName = typeof roomName === "string" ? roomName : name ?? "";
      const resolvedPlayerName =
        typeof playerName === "string"
          ? playerName
          : typeof name === "string"
            ? name
            : currentSession.name;
      const resolvedFlipTimerEnabled = Boolean(flipTimerEnabled);
      const resolvedFlipTimerSeconds = clampFlipTimerSeconds(flipTimerSeconds);
      const resolvedClaimTimerSeconds = clampClaimTimerSeconds(claimTimerSeconds);
      const resolvedPreStealEnabled = Boolean(preStealEnabled);
      const roomId = randomUUID();
      const code = isPublic ? undefined : Math.random().toString(36).slice(2, 6).toUpperCase();
      const sanitizedPlayerName = sanitizeName(resolvedPlayerName);
      const player: Player = {
        id: currentSession.playerId,
        name: sanitizedPlayerName,
        connected: true,
        words: [],
        preStealEntries: [],
        score: 0
      };

      const room: RoomState & { maxPlayers: number } = {
        id: roomId,
        name: sanitizeRoomName(resolvedRoomName),
        isPublic,
        code,
        hostId: currentSession.playerId,
        players: [player],
        status: "lobby",
        createdAt: Date.now(),
        maxPlayers: Math.min(MAX_PLAYERS, Math.max(2, maxPlayers || MAX_PLAYERS)),
        flipTimer: {
          enabled: resolvedFlipTimerEnabled,
          seconds: resolvedFlipTimerSeconds
        },
        claimTimer: {
          seconds: resolvedClaimTimerSeconds
        },
        preSteal: {
          enabled: resolvedPreStealEnabled
        }
      };

      rooms.set(roomId, room);
      currentSession.name = sanitizedPlayerName;
      setSessionRoom(currentSession, roomId);
      getSocketData(socket).roomId = roomId;
      socket.join(roomId);
      emitSessionSelf(socket, currentSession);

      emitRoomState(roomId);
      broadcastRoomList();
    }
  );

  socket.on("room:join", ({ roomId, name, code }: { roomId: string; name: string; code?: string }) => {
    const currentSession = getSessionBySocket(socket);
    if (!currentSession) {
      emitError(socket, "Session not found.");
      return;
    }
    if (getPracticeStateForSession(currentSession.sessionId).active) {
      emitError(socket, "Exit practice mode before joining a room.");
      return;
    }

    if (getSocketData(socket).roomId) {
      emitError(socket, "You are already in a room.");
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      emitError(socket, "Room not found.");
      return;
    }
    if (room.status !== "lobby") {
      emitError(socket, "Game already started.");
      return;
    }
    if (!room.isPublic && room.code && room.code !== code) {
      emitError(socket, "Invalid room code.");
      return;
    }

    const resolvedName = sanitizeName(typeof name === "string" ? name : currentSession.name);
    const existingPlayer = room.players.find((player) => player.id === currentSession.playerId);
    if (existingPlayer) {
      existingPlayer.name = resolvedName;
      existingPlayer.connected = true;
    } else {
      const maxPlayers = (room as RoomState & { maxPlayers?: number }).maxPlayers ?? MAX_PLAYERS;
      if (room.players.length >= maxPlayers) {
        emitError(socket, "Room is full.");
        return;
      }
      const player: Player = {
        id: currentSession.playerId,
        name: resolvedName,
        connected: true,
        words: [],
        preStealEntries: [],
        score: 0
      };
      room.players.push(player);
    }

    currentSession.name = resolvedName;
    setSessionRoom(currentSession, roomId);
    getSocketData(socket).roomId = roomId;
    socket.join(roomId);
    emitSessionSelf(socket, currentSession);

    emitRoomState(roomId);
    broadcastRoomList();
  });

  socket.on("player:update-name", ({ name }: { name: string }) => {
    const currentSession = getSessionBySocket(socket);
    if (!currentSession) {
      emitError(socket, "Session not found.");
      return;
    }

    const roomId = getSocketData(socket).roomId;
    const resolvedName = sanitizeName(typeof name === "string" ? name : "");
    currentSession.name = resolvedName;
    emitSessionSelf(socket, currentSession);

    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) {
      setSessionRoom(currentSession, null);
      emitSessionSelf(socket, currentSession);
      return;
    }

    const roomPlayer = room.players.find((player) => player.id === currentSession.playerId);
    if (roomPlayer) {
      roomPlayer.name = resolvedName;
    }

    const game = games.get(roomId);
    if (game) {
      const gamePlayer = game.players.find((player) => player.id === currentSession.playerId);
      if (gamePlayer) {
        gamePlayer.name = resolvedName;
      }
      emitGameState(roomId);
    }

    emitRoomState(roomId);
  });

  socket.on("room:start", ({ roomId }: { roomId: string }) => {
    const playerId = getSocketData(socket).playerId;
    if (!playerId) {
      emitError(socket, "Player not found.");
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      emitError(socket, "Room not found.");
      return;
    }
    if (room.hostId !== playerId) {
      emitError(socket, "Only the host can start the game.");
      return;
    }
    if (room.status !== "lobby") {
      emitError(socket, "Game already started.");
      return;
    }

    room.status = "in-game";
    const players = room.players.map((player) => ({
      ...player,
      words: [],
      preStealEntries: [],
      score: 0
    }));
    const turnOrder = players.map((player) => player.id);
    const bag = createTileBag();
    const flipTimer = room.flipTimer ?? {
      enabled: false,
      seconds: DEFAULT_FLIP_TIMER_SECONDS
    };
    const claimTimer = room.claimTimer ?? {
      seconds: DEFAULT_CLAIM_TIMER_SECONDS
    };

    const game: GameStateInternal = {
      roomId: room.id,
      status: "in-game",
      bag,
      centerTiles: [],
      players,
      turnOrder,
      turnIndex: 0,
      turnPlayerId: turnOrder[0],
      lastClaimAt: null,
      flipTimer: {
        enabled: flipTimer.enabled,
        seconds: clampFlipTimerSeconds(flipTimer.seconds)
      },
      claimTimer: {
        seconds: clampClaimTimerSeconds(claimTimer.seconds)
      },
      pendingFlip: null,
      claimWindow: null,
      claimCooldowns: {},
      claimCooldownTimeouts: new Map(),
      preStealEnabled: room.preSteal?.enabled ?? false,
      preStealPrecedenceOrder: [...turnOrder],
      lastClaimEvent: null
    };

    games.set(roomId, game);
    scheduleFlipTimer(game);
    emitRoomState(roomId);
    emitGameState(roomId);
    broadcastRoomList();
  });

  socket.on("room:leave", () => {
    const data = getSocketData(socket);
    const roomId = data.roomId;
    const playerId = data.playerId;
    if (!roomId) {
      emitError(socket, "You are not in a room.");
      return;
    }
    if (!playerId) {
      emitError(socket, "Player not found.");
      return;
    }

    data.roomId = undefined;
    socket.leave(roomId);
    handlePlayerLeave(roomId, playerId);
  });

  socket.on("game:flip", ({ roomId }: { roomId: string }) => {
    const playerId = getSocketData(socket).playerId;
    if (!playerId) {
      emitError(socket, "Player not found.");
      return;
    }

    enqueue(roomId, () => {
      const game = games.get(roomId);
      if (!game) {
        emitError(socket, "Game not found.");
        return;
      }
      if (game.status !== "in-game") {
        emitError(socket, "Game has ended.");
        return;
      }
      if (game.pendingFlip) {
        emitError(socket, "A tile is already being revealed.");
        return;
      }
      if (game.turnPlayerId !== playerId) {
        emitError(socket, "Not your turn to flip.");
        return;
      }
      if (!beginPendingFlip(game, playerId)) {
        emitError(socket, "No tiles left to flip.");
        return;
      }

      emitGameState(roomId);
    });
  });

  socket.on(
    "game:pre-steal:add",
    ({
      roomId,
      triggerLetters,
      claimWord
    }: {
      roomId: string;
      triggerLetters: string;
      claimWord: string;
    }) => {
      const playerId = getSocketData(socket).playerId;
      if (!playerId) {
        emitError(socket, "Player not found.");
        return;
      }

      enqueue(roomId, () => {
        const game = games.get(roomId);
        if (!game) {
          emitError(socket, "Game not found.");
          return;
        }
        if (game.status !== "in-game") {
          emitError(socket, "Game has ended.");
          return;
        }
        if (!game.preStealEnabled) {
          emitError(socket, "Pre-steal mode is disabled.");
          return;
        }

        const player = game.players.find((entry) => entry.id === playerId);
        if (!player) {
          emitError(socket, "Player not found.");
          return;
        }

        const normalizedTriggerLetters = normalizePreStealInput(triggerLetters);
        const normalizedClaimWord = normalizePreStealInput(claimWord);
        if (!normalizedTriggerLetters) {
          emitError(socket, "Enter trigger letters.");
          return;
        }
        if (!/^[A-Z]+$/.test(normalizedTriggerLetters)) {
          emitError(socket, "Trigger letters must contain only letters A-Z.");
          return;
        }
        if (!normalizedClaimWord) {
          emitError(socket, "Enter a claim word.");
          return;
        }
        if (!/^[A-Z]+$/.test(normalizedClaimWord)) {
          emitError(socket, "Claim word must contain only letters A-Z.");
          return;
        }
        if (!isValidWord(normalizedClaimWord, wordSet)) {
          emitError(socket, "Claim word is not valid.");
          return;
        }

        const entry: PreStealEntry = {
          id: randomUUID(),
          triggerLetters: normalizedTriggerLetters,
          claimWord: normalizedClaimWord,
          createdAt: Date.now()
        };
        if (!isPreStealEntryValid(game, entry)) {
          emitError(socket, "Pre-steal entry is not valid for current words.");
          return;
        }

        player.preStealEntries.push(entry);
        emitGameState(roomId);
      });
    }
  );

  socket.on(
    "game:pre-steal:remove",
    ({ roomId, entryId }: { roomId: string; entryId: string }) => {
      const playerId = getSocketData(socket).playerId;
      if (!playerId) {
        emitError(socket, "Player not found.");
        return;
      }

      enqueue(roomId, () => {
        const game = games.get(roomId);
        if (!game) {
          emitError(socket, "Game not found.");
          return;
        }
        if (game.status !== "in-game") {
          emitError(socket, "Game has ended.");
          return;
        }
        if (!game.preStealEnabled) {
          emitError(socket, "Pre-steal mode is disabled.");
          return;
        }

        const player = game.players.find((entry) => entry.id === playerId);
        if (!player) {
          emitError(socket, "Player not found.");
          return;
        }

        const nextEntries = player.preStealEntries.filter((entry) => entry.id !== entryId);
        if (nextEntries.length === player.preStealEntries.length) {
          emitError(socket, "Pre-steal entry not found.");
          return;
        }
        player.preStealEntries = nextEntries;
        emitGameState(roomId);
      });
    }
  );

  socket.on(
    "game:pre-steal:reorder",
    ({ roomId, orderedEntryIds }: { roomId: string; orderedEntryIds: string[] }) => {
      const playerId = getSocketData(socket).playerId;
      if (!playerId) {
        emitError(socket, "Player not found.");
        return;
      }

      enqueue(roomId, () => {
        const game = games.get(roomId);
        if (!game) {
          emitError(socket, "Game not found.");
          return;
        }
        if (game.status !== "in-game") {
          emitError(socket, "Game has ended.");
          return;
        }
        if (!game.preStealEnabled) {
          emitError(socket, "Pre-steal mode is disabled.");
          return;
        }

        const player = game.players.find((entry) => entry.id === playerId);
        if (!player) {
          emitError(socket, "Player not found.");
          return;
        }

        if (!Array.isArray(orderedEntryIds)) {
          emitError(socket, "Invalid pre-steal entry order.");
          return;
        }

        const existingIds = player.preStealEntries.map((entry) => entry.id);
        if (orderedEntryIds.length !== existingIds.length) {
          emitError(socket, "Invalid pre-steal entry order.");
          return;
        }
        const existingIdSet = new Set(existingIds);
        const orderedIdSet = new Set(orderedEntryIds);
        if (orderedIdSet.size !== orderedEntryIds.length || existingIdSet.size !== existingIds.length) {
          emitError(socket, "Invalid pre-steal entry order.");
          return;
        }
        for (const entryId of orderedEntryIds) {
          if (!existingIdSet.has(entryId)) {
            emitError(socket, "Invalid pre-steal entry order.");
            return;
          }
        }

        const entriesById = new Map(player.preStealEntries.map((entry) => [entry.id, entry]));
        player.preStealEntries = orderedEntryIds
          .map((entryId) => entriesById.get(entryId))
          .filter((entry): entry is PreStealEntry => Boolean(entry));
        emitGameState(roomId);
      });
    }
  );

  socket.on("game:claim-intent", ({ roomId }: { roomId: string }) => {
    const playerId = getSocketData(socket).playerId;
    if (!playerId) {
      emitError(socket, "Player not found.");
      return;
    }

    enqueue(roomId, () => {
      const game = games.get(roomId);
      if (!game) {
        emitError(socket, "Game not found.");
        return;
      }
      if (game.status !== "in-game") {
        emitError(socket, "Game has ended.");
        return;
      }
      if (game.pendingFlip) {
        emitError(socket, "Wait for the current tile reveal to finish.");
        return;
      }

      const player = game.players.find((entry) => entry.id === playerId);
      if (!player) {
        emitError(socket, "Player not found.");
        return;
      }

      if (game.claimWindow && game.claimWindow.endsAt <= Date.now()) {
        const claimantId = game.claimWindow.playerId;
        clearClaimWindow(game);
        startClaimCooldown(game, claimantId);
        emitErrorToPlayer(claimantId, "Claim window expired.");
        emitGameState(roomId);
      }

      if (game.claimWindow) {
        if (game.claimWindow.playerId === playerId) {
          return;
        }
        emitError(socket, "Another player is claiming a word.");
        return;
      }

      if (isClaimCooldownActive(game, playerId)) {
        emitError(socket, "Claim cooldown active. Wait for the next tile flip or 10 seconds.");
        return;
      }

      openClaimWindow(game, playerId);
      emitGameState(roomId);
    });
  });

  socket.on(
    "game:claim",
    ({ roomId, word }: { roomId: string; word: string; targetWordId?: string }) => {
      const playerId = getSocketData(socket).playerId;
      if (!playerId) {
        emitError(socket, "Player not found.");
        return;
      }

      enqueue(roomId, () => {
        const game = games.get(roomId);
        if (!game) {
          emitError(socket, "Game not found.");
          return;
        }
        if (game.status !== "in-game") {
          emitError(socket, "Game has ended.");
          return;
        }
        if (game.pendingFlip) {
          emitError(socket, "Wait for the current tile reveal to finish.");
          return;
        }

        const player = game.players.find((entry) => entry.id === playerId);
        if (!player) {
          emitError(socket, "Player not found.");
          return;
        }

        if (!game.claimWindow || game.claimWindow.playerId !== playerId) {
          emitError(socket, "Press Enter to start a claim.");
          return;
        }
        if (game.claimWindow.endsAt <= Date.now()) {
          clearClaimWindow(game);
          startClaimCooldown(game, player.id);
          emitError(socket, "Claim window expired.");
          emitGameState(roomId);
          return;
        }

        const rawWord = typeof word === "string" ? word : "";
        const normalized = normalizeWord(rawWord);
        if (!normalized) {
          clearClaimWindow(game);
          startClaimCooldown(game, player.id);
          emitError(socket, "Enter a word to claim.");
          emitGameState(roomId);
          return;
        }
        if (!/^[A-Z]+$/.test(normalized)) {
          clearClaimWindow(game);
          startClaimCooldown(game, player.id);
          emitError(socket, "Word must contain only letters A-Z.");
          emitGameState(roomId);
          return;
        }
        if (!isValidWord(normalized, wordSet)) {
          clearClaimWindow(game);
          startClaimCooldown(game, player.id);
          emitError(socket, "Word is not valid.");
          emitGameState(roomId);
          return;
        }

        const claimResult = executeClaim(game, player, normalized, "manual");
        if (!claimResult) {
          clearClaimWindow(game);
          startClaimCooldown(game, player.id);
          emitError(socket, "Not enough tiles in the center to make that word.");
          emitGameState(roomId);
          return;
        }

        clearClaimWindow(game);
        emitGameState(roomId);
      });
    }
  );

  socket.on("disconnect", () => {
    const data = getSocketData(socket);
    const roomId = data.roomId;
    const playerId = data.playerId;
    const sessionId = data.sessionId ?? socketToSessionId.get(socket.id);

    socketToSessionId.delete(socket.id);
    if (!sessionId) return;

    const currentSession = sessionsById.get(sessionId);
    if (!currentSession) return;
    if (currentSession.socketId !== socket.id) {
      return;
    }

    currentSession.socketId = null;
    if (!roomId || !playerId) return;
    handlePlayerDisconnect(roomId, playerId);
  });
});

if (process.env.NODE_ENV !== "test") {
  void (async () => {
    await hydrateStateFromRedis();
    httpServer.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })();
}

export {
  areLetterCountsEqual,
  countLetters,
  entryMatchesExistingWord,
  executeClaim,
  getClaimSelection,
  hasAllLetterCounts,
  isPreStealEntryValid,
  maybeRunAutoPreSteal,
  revalidateAllPreStealEntries
};
