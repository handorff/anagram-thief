import assert from "node:assert/strict";
import test from "node:test";
import type { GameReplay, Player, PreStealEntry, Tile } from "../../shared/types.js";
import { buildGameStateForViewer } from "./index.js";

function makeTile(letter: string, id: string): Tile {
  return { id, letter };
}

function makeEntry(id: string, triggerLetters: string, claimWord: string): PreStealEntry {
  return {
    id,
    triggerLetters,
    claimWord,
    createdAt: Date.now()
  };
}

function makePlayer(id: string, name: string, entries: PreStealEntry[]): Player {
  return {
    id,
    name,
    connected: true,
    words: [],
    preStealEntries: entries,
    score: 0
  };
}

function makeGame(players: Player[], options: { status?: "in-game" | "ended"; replay?: GameReplay } = {}) {
  const status = options.status ?? "in-game";
  return {
    roomId: "room-1",
    status,
    bag: [makeTile("T", "bag-1"), makeTile("E", "bag-2")],
    centerTiles: [makeTile("A", "center-1")],
    players,
    turnOrder: players.map((player) => player.id),
    turnIndex: 0,
    turnPlayerId: players[0]?.id ?? "",
    lastClaimAt: null,
    endTimer: undefined,
    endTimerEndsAt: undefined,
    flipTimer: {
      enabled: false,
      seconds: 15
    },
    flipTimerTimeout: undefined,
    flipTimerEndsAt: undefined,
    flipTimerToken: undefined,
    pendingFlip: null,
    pendingFlipTimeout: undefined,
    claimTimer: {
      seconds: 3
    },
    claimWindow: null,
    claimWindowTimeout: undefined,
    claimCooldowns: {},
    claimCooldownTimeouts: new Map<string, NodeJS.Timeout>(),
    preStealEnabled: true,
    preStealPrecedenceOrder: players.map((player) => player.id),
    lastClaimEvent: null,
    replay: options.replay ?? { steps: [] },
    lastReplaySnapshotHash: null
  };
}

test("buildGameStateForViewer hides other players pre-steal entries for players", () => {
  const alice = makePlayer("p-alice", "Alice", [makeEntry("a-1", "S", "STARE")]);
  const bob = makePlayer("p-bob", "Bob", [makeEntry("b-1", "M", "TAME")]);
  const game = makeGame([alice, bob]);

  const state = buildGameStateForViewer(game as any, "player", "p-alice");
  const aliceState = state.players.find((player) => player.id === "p-alice");
  const bobState = state.players.find((player) => player.id === "p-bob");

  assert.ok(aliceState);
  assert.ok(bobState);
  assert.equal(state.bagLetterCounts?.A, 0);
  assert.equal(state.bagLetterCounts?.E, 1);
  assert.equal(state.bagLetterCounts?.T, 1);
  assert.equal(aliceState.preStealEntries.length, 1);
  assert.equal(bobState.preStealEntries.length, 0);
});

test("buildGameStateForViewer exposes all pre-steal entries for spectators", () => {
  const alice = makePlayer("p-alice", "Alice", [makeEntry("a-1", "S", "STARE")]);
  const bob = makePlayer("p-bob", "Bob", [makeEntry("b-1", "M", "TAME")]);
  const game = makeGame([alice, bob]);

  const state = buildGameStateForViewer(game as any, "spectator", "s-1");
  const aliceState = state.players.find((player) => player.id === "p-alice");
  const bobState = state.players.find((player) => player.id === "p-bob");

  assert.ok(aliceState);
  assert.ok(bobState);
  assert.equal(aliceState.preStealEntries.length, 1);
  assert.equal(bobState.preStealEntries.length, 1);
});

test("buildGameStateForViewer includes replay for ended games with full pre-steal visibility", () => {
  const alice = makePlayer("p-alice", "Alice", [makeEntry("a-1", "S", "STARE")]);
  const bob = makePlayer("p-bob", "Bob", [makeEntry("b-1", "M", "TAME")]);
  const replay: GameReplay = {
    steps: [
      {
        index: 0,
        at: Date.now(),
        kind: "game-start",
        state: {
          roomId: "room-1",
          status: "in-game",
          bagCount: 2,
          centerTiles: [makeTile("A", "center-1")],
          players: [
            {
              id: "p-alice",
              name: "Alice",
              score: 0,
              words: [],
              preStealEntries: [makeEntry("a-1", "S", "STARE")]
            },
            {
              id: "p-bob",
              name: "Bob",
              score: 0,
              words: [],
              preStealEntries: [makeEntry("b-1", "M", "TAME")]
            }
          ],
          turnPlayerId: "p-alice",
          claimWindow: null,
          claimCooldowns: {},
          pendingFlip: null,
          preStealEnabled: true,
          preStealPrecedenceOrder: ["p-alice", "p-bob"],
          lastClaimEvent: null
        }
      }
    ]
  };

  const game = makeGame([alice, bob], { status: "ended", replay });

  const playerView = buildGameStateForViewer(game as any, "player", "p-alice");
  const spectatorView = buildGameStateForViewer(game as any, "spectator", "s-1");

  assert.ok(playerView.replay);
  assert.ok(spectatorView.replay);
  assert.equal(playerView.replay.steps.length, 1);
  assert.equal(spectatorView.replay.steps.length, 1);
  assert.equal(playerView.replay.steps[0].state.players[0].preStealEntries.length, 1);
  assert.equal(playerView.replay.steps[0].state.players[1].preStealEntries.length, 1);
  assert.equal(spectatorView.replay.steps[0].state.players[0].preStealEntries.length, 1);
  assert.equal(spectatorView.replay.steps[0].state.players[1].preStealEntries.length, 1);
});
