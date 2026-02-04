import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import type { GameState, Player, RoomState, RoomSummary, Tile, Word } from "../../shared/types";
import { createTileBag } from "../../shared/tileBag.js";
import { isValidWord, loadWordSet, normalizeWord } from "../../shared/wordValidation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const END_TIMER_MS = 60_000;
const MAX_PLAYERS = 8;

const wordListCandidates = [
  path.join(__dirname, "../TWL06 Wordlist.txt"),
  path.join(__dirname, "../wordlist.txt"),
  path.join(__dirname, "../../../wordlist.txt"),
  path.join(process.cwd(), "server/wordlist.txt")
];

const wordListPath = wordListCandidates.find((candidate) => fs.existsSync(candidate));
if (!wordListPath) {
    throw new Error("Word list not found. Expected server/TWL06 Wordlist.txt or server/wordlist.txt.");
}

const wordSet = loadWordSet(wordListPath);

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
    endTimerEndsAt: game.endTimerEndsAt
  };
  io.to(roomId).emit("game:state", publicState);
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

function scheduleEndTimer(game: GameStateInternal) {
  if (game.endTimer) {
    clearTimeout(game.endTimer);
  }
  game.endTimerEndsAt = Date.now() + END_TIMER_MS;
  game.endTimer = setTimeout(() => {
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
      maxPlayers
    }: {
      roomName?: string;
      playerName?: string;
      name?: string;
      isPublic: boolean;
      maxPlayers: number;
    }) => {
      if (socket.data.roomId) {
        emitError(socket, "You are already in a room.");
        return;
      }

      const resolvedRoomName = typeof roomName === "string" ? roomName : name ?? "";
      const resolvedPlayerName = typeof playerName === "string" ? playerName : name ?? "";
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
        maxPlayers: Math.min(MAX_PLAYERS, Math.max(2, maxPlayers || MAX_PLAYERS))
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

    const game: GameStateInternal = {
      roomId: room.id,
      status: "in-game",
      bag,
      centerTiles: [],
      players,
      turnOrder,
      turnIndex: 0,
      turnPlayerId: turnOrder[0],
      lastClaimAt: null
    };

    games.set(roomId, game);
    emitRoomState(roomId);
    emitGameState(roomId);
    broadcastRoomList();
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
      if (game.bag.length === 0) {
        emitError(socket, "No tiles left to flip.");
        return;
      }

      const tile = game.bag.shift();
      if (!tile) return;
      game.centerTiles.push(tile);
      advanceTurn(game);

      if (game.bag.length === 0) {
        scheduleEndTimer(game);
      }

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

        const normalized = normalizeWord(word);
        if (!/^[A-Z]+$/.test(normalized)) {
          emitError(socket, "Word must contain only letters A-Z.");
          return;
        }
        if (!isValidWord(normalized, wordSet)) {
          emitError(socket, "Word is not valid.");
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
            emitError(socket, "Not enough tiles in the center to make that word.");
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

        emitGameState(roomId);
      });
    }
  );

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.find((entry) => entry.id === socket.id);
    if (player) {
      player.connected = false;
    }

    const game = games.get(roomId);
    if (game) {
      const gamePlayer = game.players.find((entry) => entry.id === socket.id);
      if (gamePlayer) {
        gamePlayer.connected = false;
        if (game.turnPlayerId === socket.id) {
          advanceTurn(game);
        }
      }
      emitGameState(roomId);
    }

    emitRoomState(roomId);
    broadcastRoomList();
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
