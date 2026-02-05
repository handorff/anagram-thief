import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import type { GameState, Player, RoomState, RoomSummary, Tile, Word } from "../../shared/types.js";
import { createTileBag } from "../../shared/tileBag.js";
import { isValidWord, loadWordSet, normalizeWord } from "../../shared/wordValidation.js";

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
};

const rooms = new Map<string, RoomState>();
const games = new Map<string, GameStateInternal>();
const roomQueues = new Map<string, Promise<void>>();

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

function emitError(socket: { emit: Function }, message: string, code?: string) {
  socket.emit("error", { message, code });
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
}

function emitRoomState(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("room:state", room);
}

function emitGameState(roomId: string) {
  const game = games.get(roomId);
  if (!game) return;
  const publicState: GameState = {
    roomId: game.roomId,
    status: game.status,
    bagCount: game.bag.length,
    centerTiles: game.centerTiles,
    players: game.players,
    turnPlayerId: game.turnPlayerId,
    lastClaimAt: game.lastClaimAt,
    endTimerEndsAt: game.endTimerEndsAt,
    claimWindow: game.claimWindow
      ? { playerId: game.claimWindow.playerId, endsAt: game.claimWindow.endsAt }
      : null,
    claimCooldowns: game.claimCooldowns
  };
  io.to(roomId).emit("game:state", publicState);
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

function scheduleFlipTimer(game: GameStateInternal) {
  clearFlipTimer(game);
  if (!game.flipTimer.enabled) return;
  if (game.status !== "in-game") return;
  if (game.bag.length === 0) return;

  const token = randomUUID();
  const turnPlayerId = game.turnPlayerId;
  const durationMs = game.flipTimer.seconds * 1000;
  game.flipTimerToken = token;
  game.flipTimerEndsAt = Date.now() + durationMs;

  game.flipTimerTimeout = setTimeout(() => {
    enqueue(game.roomId, () => {
      const current = games.get(game.roomId);
      if (!current) return;
      if (current.status !== "in-game") return;
      if (!current.flipTimer.enabled) return;
      if (current.flipTimerToken !== token) return;
      if (current.turnPlayerId !== turnPlayerId) return;
      if (!performFlip(current)) return;
      emitGameState(current.roomId);
    });
  }, durationMs);
}

function emitErrorToPlayer(playerId: string, message: string) {
  io.to(playerId).emit("error", { message });
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

function startClaimCooldown(game: GameStateInternal, playerId: string) {
  clearClaimCooldown(game, playerId);
  const endsAt = Date.now() + CLAIM_COOLDOWN_MS;
  game.claimCooldowns[playerId] = endsAt;
  const timeout = setTimeout(() => {
    enqueue(game.roomId, () => {
      const current = games.get(game.roomId);
      if (!current) return;
      if (current.claimCooldowns[playerId] !== endsAt) return;
      clearClaimCooldown(current, playerId);
      emitGameState(current.roomId);
    });
  }, CLAIM_COOLDOWN_MS);
  game.claimCooldownTimeouts.set(playerId, timeout);
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

function openClaimWindow(game: GameStateInternal, playerId: string) {
  clearClaimWindow(game);
  const token = randomUUID();
  const durationMs = game.claimTimer.seconds * 1000;
  const endsAt = Date.now() + durationMs;
  game.claimWindow = { playerId, endsAt, token };
  game.claimWindowTimeout = setTimeout(() => {
    enqueue(game.roomId, () => {
      const current = games.get(game.roomId);
      if (!current) return;
      if (!current.claimWindow || current.claimWindow.token !== token) return;
      const claimantId = current.claimWindow.playerId;
      clearClaimWindow(current);
      startClaimCooldown(current, claimantId);
      emitErrorToPlayer(claimantId, "Claim window expired.");
      emitGameState(current.roomId);
    });
  }, durationMs);
}

function scheduleEndTimer(game: GameStateInternal) {
  if (game.endTimer) {
    clearTimeout(game.endTimer);
  }
  clearFlipTimer(game);
  game.endTimerEndsAt = Date.now() + END_TIMER_MS;
  game.endTimer = setTimeout(() => {
    clearClaimWindow(game);
    clearAllClaimCooldowns(game);
    game.status = "ended";
    const room = rooms.get(game.roomId);
    if (room) {
      room.status = "ended";
      emitRoomState(room.id);
      broadcastRoomList();
    }
    emitGameState(game.roomId);
  }, END_TIMER_MS);
}

function performFlip(game: GameStateInternal): boolean {
  if (game.bag.length === 0) return false;
  const tile = game.bag.shift();
  if (!tile) return false;
  game.centerTiles.push(tile);
  clearAllClaimCooldowns(game);
  advanceTurn(game);

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
  const game = games.get(roomId);
  if (game) {
    clearGameTimers(game);
    games.delete(roomId);
  }
  rooms.delete(roomId);
  roomQueues.delete(roomId);
  broadcastRoomList();
}

function removePlayerFromGame(game: GameStateInternal, playerId: string) {
  const previousTurnPlayerId = game.turnPlayerId;
  clearClaimCooldown(game, playerId);
  game.players = game.players.filter((player) => player.id !== playerId);
  game.turnOrder = game.turnOrder.filter((id) => id !== playerId);

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

  return { turnPlayerChanged: previousTurnPlayerId !== game.turnPlayerId };
}

function handlePlayerDeparture(roomId: string, playerId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

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

io.on("connection", (socket) => {
  socket.on("room:list", () => {
    socket.emit("room:list", Array.from(rooms.values()).map(getRoomSummary));
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
      claimTimerSeconds
    }: {
      roomName?: string;
      playerName?: string;
      name?: string;
      isPublic: boolean;
      maxPlayers: number;
      flipTimerEnabled?: boolean;
      flipTimerSeconds?: number;
      claimTimerSeconds?: number;
    }) => {
      if (socket.data.roomId) {
        emitError(socket, "You are already in a room.");
        return;
      }

      const resolvedRoomName = typeof roomName === "string" ? roomName : name ?? "";
      const resolvedPlayerName = typeof playerName === "string" ? playerName : name ?? "";
      const resolvedFlipTimerEnabled = Boolean(flipTimerEnabled);
      const resolvedFlipTimerSeconds = clampFlipTimerSeconds(flipTimerSeconds);
      const resolvedClaimTimerSeconds = clampClaimTimerSeconds(claimTimerSeconds);
      const roomId = randomUUID();
      const code = isPublic ? undefined : Math.random().toString(36).slice(2, 6).toUpperCase();
      const player: Player = {
        id: socket.id,
        name: sanitizeName(resolvedPlayerName),
        connected: true,
        words: [],
        score: 0
      };

      const room: RoomState & { maxPlayers: number } = {
        id: roomId,
        name: sanitizeRoomName(resolvedRoomName),
        isPublic,
        code,
        hostId: socket.id,
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
        }
      };

      rooms.set(roomId, room);
      socket.data.roomId = roomId;
      socket.join(roomId);

      emitRoomState(roomId);
      broadcastRoomList();
    }
  );

  socket.on("room:join", ({ roomId, name, code }: { roomId: string; name: string; code?: string }) => {
    if (socket.data.roomId) {
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
    const maxPlayers = (room as RoomState & { maxPlayers?: number }).maxPlayers ?? MAX_PLAYERS;
    if (room.players.length >= maxPlayers) {
      emitError(socket, "Room is full.");
      return;
    }
    if (!room.isPublic && room.code && room.code !== code) {
      emitError(socket, "Invalid room code.");
      return;
    }

    const player: Player = {
      id: socket.id,
      name: sanitizeName(name),
      connected: true,
      words: [],
      score: 0
    };

    room.players.push(player);
    socket.data.roomId = roomId;
    socket.join(roomId);

    emitRoomState(roomId);
    broadcastRoomList();
  });

  socket.on("player:update-name", ({ name }: { name: string }) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      emitError(socket, "You are not in a room.");
      return;
    }
    const room = rooms.get(roomId);
    if (!room) {
      emitError(socket, "Room not found.");
      return;
    }
    const resolvedName = sanitizeName(typeof name === "string" ? name : "");
    const roomPlayer = room.players.find((player) => player.id === socket.id);
    if (roomPlayer) {
      roomPlayer.name = resolvedName;
    }
    const game = games.get(roomId);
    if (game) {
      const gamePlayer = game.players.find((player) => player.id === socket.id);
      if (gamePlayer) {
        gamePlayer.name = resolvedName;
      }
      emitGameState(roomId);
    }
    emitRoomState(roomId);
  });

  socket.on("room:start", ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId);
    if (!room) {
      emitError(socket, "Room not found.");
      return;
    }
    if (room.hostId !== socket.id) {
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
      claimWindow: null,
      claimCooldowns: {},
      claimCooldownTimeouts: new Map()
    };

    games.set(roomId, game);
    scheduleFlipTimer(game);
    emitRoomState(roomId);
    emitGameState(roomId);
    broadcastRoomList();
  });

  socket.on("room:leave", () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) {
      emitError(socket, "You are not in a room.");
      return;
    }
    socket.data.roomId = undefined;
    socket.leave(roomId);
    handlePlayerDeparture(roomId, socket.id);
  });

  socket.on("game:flip", ({ roomId }: { roomId: string }) => {
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
      if (game.turnPlayerId !== socket.id) {
        emitError(socket, "Not your turn to flip.");
        return;
      }
      if (!performFlip(game)) {
        emitError(socket, "No tiles left to flip.");
        return;
      }

      emitGameState(roomId);
    });
  });

  socket.on("game:claim-intent", ({ roomId }: { roomId: string }) => {
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

      const player = game.players.find((entry) => entry.id === socket.id);
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
        if (game.claimWindow.playerId === socket.id) {
          return;
        }
        emitError(socket, "Another player is claiming a word.");
        return;
      }

      if (isClaimCooldownActive(game, socket.id)) {
        emitError(socket, "Claim cooldown active. Wait for the next tile flip or 10 seconds.");
        return;
      }

      openClaimWindow(game, socket.id);
      emitGameState(roomId);
    });
  });

  socket.on(
    "game:claim",
    ({ roomId, word }: { roomId: string; word: string; targetWordId?: string }) => {
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

        const player = game.players.find((entry) => entry.id === socket.id);
        if (!player) {
          emitError(socket, "Player not found.");
          return;
        }

        if (!game.claimWindow || game.claimWindow.playerId !== socket.id) {
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

        const wordCounts = countLetters(normalized);
        const stealCandidates: Array<{
          target: Word;
          owner: Player;
          selectedTiles: Tile[];
          requiredTotal: number;
        }> = [];
        const extendCandidates: Array<{
          target: Word;
          owner: Player;
          selectedTiles: Tile[];
          requiredTotal: number;
        }> = [];

        for (const owner of game.players) {
          for (const target of owner.words) {
            const targetCounts = countLetters(target.text);
            let isSubset = true;
            for (const [letter, count] of Object.entries(targetCounts)) {
              if ((wordCounts[letter] ?? 0) < count) {
                isSubset = false;
                break;
              }
            }
            if (!isSubset) continue;

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

            const selectedTiles = selectTilesForCounts(required, game.centerTiles);
            if (!selectedTiles) continue;

            const candidate = {
              target,
              owner,
              selectedTiles,
              requiredTotal
            };
            if (owner.id === player.id) {
              extendCandidates.push(candidate);
            } else {
              if (normalized.includes(target.text)) {
                continue;
              }
              stealCandidates.push(candidate);
            }
          }
        }

        let selectedTiles: Tile[] | null = null;
        let combinedTileIds: string[] = [];
        let replacedWordOwner: Player | null = null;
        let replacedWordId: string | null = null;

        if (stealCandidates.length > 0) {
          stealCandidates.sort((a, b) => {
            if (a.requiredTotal !== b.requiredTotal) {
              return a.requiredTotal - b.requiredTotal;
            }
            if (a.target.createdAt !== b.target.createdAt) {
              return a.target.createdAt - b.target.createdAt;
            }
            return a.target.text.localeCompare(b.target.text);
          });

          const chosen = stealCandidates[0];
          selectedTiles = chosen.selectedTiles;
          combinedTileIds = [...chosen.target.tileIds, ...selectedTiles.map((tile) => tile.id)];

          replacedWordOwner = chosen.owner;
          replacedWordId = chosen.target.id;
        } else if (extendCandidates.length > 0) {
          extendCandidates.sort((a, b) => {
            if (a.requiredTotal !== b.requiredTotal) {
              return a.requiredTotal - b.requiredTotal;
            }
            if (a.target.createdAt !== b.target.createdAt) {
              return a.target.createdAt - b.target.createdAt;
            }
            return a.target.text.localeCompare(b.target.text);
          });

          const chosen = extendCandidates[0];
          selectedTiles = chosen.selectedTiles;
          combinedTileIds = [...chosen.target.tileIds, ...selectedTiles.map((tile) => tile.id)];

          replacedWordOwner = chosen.owner;
          replacedWordId = chosen.target.id;
        } else {
          selectedTiles = selectTilesForWord(normalized, game.centerTiles);
          if (!selectedTiles) {
            clearClaimWindow(game);
            startClaimCooldown(game, player.id);
            emitError(socket, "Not enough tiles in the center to make that word.");
            emitGameState(roomId);
            return;
          }
          combinedTileIds = selectedTiles.map((tile) => tile.id);
        }

        const newWord: Word = {
          id: randomUUID(),
          text: normalized,
          tileIds: combinedTileIds,
          ownerId: player.id,
          createdAt: Date.now()
        };

        if (replacedWordOwner && replacedWordId) {
          replacedWordOwner.words = replacedWordOwner.words.filter(
            (entry) => entry.id !== replacedWordId
          );
          updateScores(game);
        }

        player.words.push(newWord);
        removeTilesFromCenter(game, selectedTiles.map((tile) => tile.id));
        updateScores(game);

        game.lastClaimAt = Date.now();
        if (game.bag.length === 0) {
          scheduleEndTimer(game);
        }

        clearClaimWindow(game);
        emitGameState(roomId);
      });
    }
  );

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    handlePlayerDeparture(roomId, socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
